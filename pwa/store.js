'use strict';

// Feature: mobile-workout-logger
// pwa/store.js — Lớp I/O Cache_Offline bằng IndexedDB (chỉ chạy trong trình duyệt).
// Bọc IndexedDB API thành Promise; không phụ thuộc thư viện ngoài, không bước build.
// Tham chiếu: design.md > Data Models (Cache_Offline) + Components > pwa/store.js
// Requirements: 2.2 (ghi cục bộ tức thời), 2.4 (khôi phục từ cache),
//               8.3 (hàng đợi bền vững khi offline), 11.3 (xoá khi đăng xuất).
//
// Object stores (theo design.md):
//   - meta     keyPath "key"        → { key, value } (folderId, weekPackLoadedAt, connection, uỷ quyền…)
//   - weekPack keyPath "id"         → một bản ghi duy nhất (id cố định = "current")
//   - logs     keyPath "sessionId"  → Nhật_Ký_Buổi_Tập (gồm rev, baseDriveModifiedTime)
//   - queue    keyPath "id"         → mục Hàng_Đợi_Đồng_Bộ { id, sessionId, op, payloadRef, attempts, ... }

const DB_NAME = 'mwl';
const DB_VERSION = 1;

const STORE_META = 'meta';
const STORE_WEEKPACK = 'weekPack';
const STORE_LOGS = 'logs';
const STORE_QUEUE = 'queue';

// Khóa cố định cho bản ghi Gói_Lịch_Tuần duy nhất.
const WEEKPACK_ID = 'current';

// Tiền tố khóa meta thuộc về phiên/khách — bị xoá khi đăng xuất (YC11.3).
// folderId được coi là cấu hình thiết bị-ứng dụng (không phải dữ liệu khách) nên GIỮ lại.
const CLIENT_META_KEYS = Object.freeze([
  'connection',
  'weekPackLoadedAt',
  'auth',
  'refreshToken',
  'accessToken',
  'tokenExpiry',
]);

// ---- Lấy đối tượng indexedDB của môi trường --------------------------------

function getIDB() {
  // self bao phủ cả window và service worker scope.
  const g =
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    (typeof globalThis !== 'undefined' && globalThis) ||
    null;
  const idb = g && (g.indexedDB || g.mozIndexedDB || g.webkitIndexedDB || g.msIndexedDB);
  if (!idb) {
    throw new Error('IndexedDB không khả dụng trong môi trường này (chỉ chạy trong trình duyệt).');
  }
  return idb;
}

// ---- Mở DB (singleton Promise) --------------------------------------------

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = getIDB().open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_WEEKPACK)) {
        db.createObjectStore(STORE_WEEKPACK, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_LOGS)) {
        db.createObjectStore(STORE_LOGS, { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        // Index phụ để truy vấn theo sessionId khi cần (không bắt buộc cho API hiện tại).
        try {
          queueStore.createIndex('bySession', 'sessionId', { unique: false });
        } catch (_) {
          /* index là tùy chọn */
        }
      }
      // event không dùng trực tiếp nhưng giữ tham chiếu cho rõ ràng.
      void event;
    };
    req.onsuccess = () => {
      const db = req.result;
      // Nếu phiên bản bị nâng ở tab khác, đóng để tránh chặn.
      db.onversionchange = () => {
        try {
          db.close();
        } catch (_) {
          /* noop */
        }
        _dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Không mở được IndexedDB'));
    req.onblocked = () => {
      // Một kết nối khác đang chặn nâng cấp; chờ nó đóng.
      // Không reject ngay — onsuccess vẫn có thể được gọi sau đó.
    };
  });
  return _dbPromise;
}

// ---- Bọc transaction/request thành Promise --------------------------------

// Chạy một thao tác trên một store trong transaction; phân giải khi transaction
// hoàn tất (oncomplete) để bảo đảm dữ liệu đã được ghi bền vững.
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const store = tx.objectStore(storeName);
    let result;
    let settled = false;

    Promise.resolve()
      .then(() => fn(store))
      .then((value) => {
        result = value;
      })
      .catch((err) => {
        settled = true;
        try {
          tx.abort();
        } catch (_) {
          /* noop */
        }
        reject(err);
      });

    tx.oncomplete = () => {
      if (!settled) resolve(result);
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(tx.error || new Error('Transaction lỗi'));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error || new Error('Transaction bị huỷ'));
      }
    };
  });
}

// Bọc một IDBRequest đơn lẻ thành Promise (giá trị khi request thành công).
function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Request IndexedDB lỗi'));
  });
}

// ---- META ------------------------------------------------------------------

// getMeta(key) → value đã lưu, hoặc undefined nếu không có.
async function getMeta(key) {
  return withStore(STORE_META, 'readonly', async (store) => {
    const row = await reqPromise(store.get(key));
    return row ? row.value : undefined;
  });
}

// setMeta(key, value) → ghi { key, value }.
async function setMeta(key, value) {
  return withStore(STORE_META, 'readwrite', async (store) => {
    store.put({ key, value });
    return value;
  });
}

// ---- WEEK PACK -------------------------------------------------------------

// getWeekPack() → Gói_Lịch_Tuần đã cache, hoặc null nếu chưa có.
async function getWeekPack() {
  return withStore(STORE_WEEKPACK, 'readonly', async (store) => {
    const row = await reqPromise(store.get(WEEKPACK_ID));
    if (!row) return null;
    return row.pack !== undefined ? row.pack : null;
  });
}

// putWeekPack(pack) → lưu (ghi đè) bản Gói_Lịch_Tuần duy nhất.
async function putWeekPack(pack) {
  return withStore(STORE_WEEKPACK, 'readwrite', async (store) => {
    store.put({ id: WEEKPACK_ID, pack });
    return pack;
  });
}

// ---- LOGS ------------------------------------------------------------------

// getLog(sessionId) → Nhật_Ký theo sessionId, hoặc null nếu chưa có.
async function getLog(sessionId) {
  return withStore(STORE_LOGS, 'readonly', async (store) => {
    const row = await reqPromise(store.get(sessionId));
    return row || null;
  });
}

// putLog(log) → ghi (ghi đè) Nhật_Ký theo sessionId (keyPath).
async function putLog(log) {
  if (!log || log.sessionId == null || log.sessionId === '') {
    throw new Error('putLog: log thiếu sessionId');
  }
  return withStore(STORE_LOGS, 'readwrite', async (store) => {
    store.put(log);
    return log;
  });
}

// allLogs() → mảng tất cả Nhật_Ký đã lưu.
async function allLogs() {
  return withStore(STORE_LOGS, 'readonly', async (store) => {
    if (typeof store.getAll === 'function') {
      const rows = await reqPromise(store.getAll());
      return rows || [];
    }
    // Dự phòng cho trình duyệt không có getAll: duyệt cursor.
    return new Promise((resolve, reject) => {
      const out = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          out.push(cursor.value);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error || new Error('Cursor logs lỗi'));
    });
  });
}

// ---- QUEUE (Hàng_Đợi_Đồng_Bộ) ---------------------------------------------

// Sinh id duy nhất cho mục hàng đợi nếu mục chưa có sẵn id.
function genQueueId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `q_${Date.now().toString(36)}_${rand}`;
}

// enqueue(item) → thêm mục vào hàng đợi; trả về mục đã lưu (gồm id, attempts mặc định).
async function enqueue(item) {
  const record = Object.assign({}, item);
  if (record.id == null || record.id === '') {
    record.id = genQueueId();
  }
  if (!Number.isFinite(Number(record.attempts))) {
    record.attempts = 0;
  }
  return withStore(STORE_QUEUE, 'readwrite', async (store) => {
    store.put(record);
    return record;
  });
}

// dequeue(id) → xoá mục theo id; trả về true.
async function dequeue(id) {
  return withStore(STORE_QUEUE, 'readwrite', async (store) => {
    store.delete(id);
    return true;
  });
}

// peekQueue() → mảng tất cả mục hàng đợi (FIFO theo thứ tự khóa).
async function peekQueue() {
  return withStore(STORE_QUEUE, 'readonly', async (store) => {
    if (typeof store.getAll === 'function') {
      const rows = await reqPromise(store.getAll());
      return rows || [];
    }
    return new Promise((resolve, reject) => {
      const out = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          out.push(cursor.value);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error || new Error('Cursor queue lỗi'));
    });
  });
}

// updateQueueItem(id, patch) → gộp patch vào mục hiện có; trả mục đã cập nhật
// hoặc null nếu không tìm thấy. Dùng để tăng attempts, đặt nextAttemptAt, lastError…
async function updateQueueItem(id, patch) {
  return withStore(STORE_QUEUE, 'readwrite', async (store) => {
    const current = await reqPromise(store.get(id));
    if (!current) return null;
    const updated = Object.assign({}, current, patch || {}, { id: current.id });
    store.put(updated);
    return updated;
  });
}

// ---- CLEAR (đăng xuất — YC11.3) -------------------------------------------

// Xoá toàn bộ một store (dùng nội bộ).
function clearStore(store) {
  return reqPromise(store.clear());
}

// clearClientData() → xoá dữ liệu khách khi đăng xuất:
//   - weekPack: xoá toàn bộ
//   - logs: xoá toàn bộ
//   - queue: xoá toàn bộ
//   - meta: chỉ xoá các khóa liên quan khách/phiên (giữ folderId cấu hình thiết bị)
async function clearClientData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction([STORE_WEEKPACK, STORE_LOGS, STORE_QUEUE, STORE_META], 'readwrite');
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;

    Promise.resolve()
      .then(async () => {
        await clearStore(tx.objectStore(STORE_WEEKPACK));
        await clearStore(tx.objectStore(STORE_LOGS));
        await clearStore(tx.objectStore(STORE_QUEUE));
        const metaStore = tx.objectStore(STORE_META);
        for (const key of CLIENT_META_KEYS) {
          metaStore.delete(key);
        }
      })
      .catch((err) => {
        settled = true;
        try {
          tx.abort();
        } catch (_) {
          /* noop */
        }
        reject(err);
      });

    tx.oncomplete = () => {
      if (!settled) resolve(true);
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(tx.error || new Error('clearClientData lỗi'));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error || new Error('clearClientData bị huỷ'));
      }
    };
  });
}

// ---- Tiện ích vòng đời (tùy chọn) -----------------------------------------

// closeDB() → đóng kết nối hiện tại (chủ yếu cho test/dọn dẹp).
async function closeDB() {
  if (!_dbPromise) return;
  try {
    const db = await _dbPromise;
    db.close();
  } catch (_) {
    /* noop */
  } finally {
    _dbPromise = null;
  }
}

// ---- Phơi API --------------------------------------------------------------

const api = {
  // hằng số / cấu hình
  DB_NAME,
  DB_VERSION,
  WEEKPACK_ID,
  CLIENT_META_KEYS,
  // meta
  getMeta,
  setMeta,
  // weekPack
  getWeekPack,
  putWeekPack,
  // logs
  getLog,
  putLog,
  allLogs,
  // queue
  enqueue,
  dequeue,
  peekQueue,
  updateQueueItem,
  // lifecycle / logout
  clearClientData,
  closeDB,
};

// Phơi cho trình duyệt (window/self) theo quy ước script thuần của PWA.
(function exposeGlobal() {
  const g =
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    (typeof globalThis !== 'undefined' && globalThis) ||
    null;
  if (g) {
    g.MWLStore = api;
  }
})();

// Guarded CommonJS export để có thể nạp trong Node (chỉ phục vụ kiểm tra cú pháp /
// import; IndexedDB không tồn tại trong Node nên các hàm I/O sẽ ném lỗi nếu gọi).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
