'use strict';

// Feature: mobile-workout-logger
// pwa/sync.js — Bộ_Đồng_Bộ: điều phối đồng bộ hai chiều Nhật_Ký_Buổi_Tập với
// Google_Drive (đọc-so-gộp-ghi), hàng đợi + thử lại có backoff, poll Gói_Lịch_Tuần.
//
// Web/JS thuần, KHÔNG bước build, KHÔNG thư viện ngoài. Hướng trình duyệt nhưng
// phần điều phối được viết "thuần-ish" để chạy/test trong Node bằng mock (task 8.2).
//
// Tham chiếu: design.md
//   > Components > pwa/sync.js (hợp đồng hàm)
//   > Sync & Conflict Flow (sơ đồ đọc-so-gộp-ghi)
//   > Error Handling (offline, mất mạng giữa chừng, quá maxAttempts, AuthExpired, xung đột)
//
// Phụ thuộc (xem SEAM TIÊM PHỤ THUỘC bên dưới):
//   - drive-client.js  : readJson(name) → {data,modifiedTime}|null,
//                        writeJson(name,obj,expectedModifiedTime?) → {ok,modifiedTime}
//                                                | {conflict:true, drive:{data,modifiedTime}},
//                        resolveDataFolder(), ensureAccessToken(), AuthExpired.
//   - store.js         : getLog/putLog, peekQueue/dequeue/updateQueueItem,
//                        getWeekPack/putWeekPack, getMeta/setMeta.
//   - merge.js         : mergeLogs(localLog, driveLog).
//   - backoff.js       : computeBackoff(attempts, baseMs, maxMs, jitter?) — TÁI SỬ DỤNG,
//                        KHÔNG cài lại ở đây (chỉ re-export cho tiện).
//
// Requirements: 7.2 (auto đẩy), 7.3 (online ≤30s), 7.4 (xoá khỏi queue khi xong),
//               7.5 (trạng thái đồng bộ), 7.6 (poll week-pack), 8.1 (giữ mục khi lỗi),
//               8.4 (quá maxAttempts → cần thủ công + thông báo), 8.5 (manual sync),
//               9.1/9.2 (kiểm phiên bản + gộp), 10.4 (AuthExpired surface, không drop).

// ============================================================================
// SEAM TIÊM PHỤ THUỘC (DEPENDENCY-INJECTION SEAM) — cho test (task 8.2)
// ----------------------------------------------------------------------------
// Mặc định các phụ thuộc được PHÂN GIẢI LƯỜI lúc gọi:
//   1) bản đã tiêm qua setDependencies({...})  (ưu tiên cao nhất — dùng cho test),
//   2) biến toàn cục trình duyệt (window/self): MWLDrive, MWLStore, MWLMerge,
//   3) require('./drive-client' | './store' | './merge' | './backoff') khi ở Node.
// Nhờ vậy task 8.2 chỉ cần gọi setDependencies({ drive: mockDrive, store: mockStore,
// merge, computeBackoff, now }) là lái được toàn bộ flushQueue mà không đụng IndexedDB
// hay mạng thật. Gọi resetSync() để khôi phục mặc định giữa các test.
// ============================================================================

const _injected = {
  drive: null,        // { readJson, writeJson, resolveDataFolder?, ensureAccessToken?, AuthExpired? }
  store: null,        // { getLog, putLog, peekQueue, dequeue, updateQueueItem, getWeekPack, putWeekPack, getMeta, setMeta }
  merge: null,        // { mergeLogs }
  computeBackoff: null, // (attempts, baseMs, maxMs, jitter?) => number
  now: null,          // () => epoch ms
  notify: null,       // (event) => void  (thông báo UI: needsManual, authExpired…)
  setTimeoutFn: null, // (fn, ms) => handle
  clearTimeoutFn: null,
  setIntervalFn: null,
  clearIntervalFn: null,
};

// Cấu hình có thể chỉnh (backoff, maxAttempts, chu kỳ poll, độ trễ flush khi online…).
const _config = {
  maxAttempts: 5,                 // quá số này ⇒ needsManual (YC8.4)
  baseMs: 1000,                   // backoff cơ sở
  maxMs: 5 * 60 * 1000,           // trần backoff
  maxConflictLoops: 5,            // số vòng đọc-gộp-ghi tối đa khi xung đột liên tục
  onlineFlushDelayMs: 1000,       // onOnline: flush trong vòng ≤30s (YC7.3)
  pollIntervalMs: 5 * 60 * 1000,  // chu kỳ poll Gói_Lịch_Tuần (YC7.6)
  logsDir: 'logs',                // thư mục con chứa nhật ký
  weekPackName: 'week-pack.json', // tên file Gói_Lịch_Tuần
};

// Trạng thái nội bộ.
let _flushing = false;     // đang chạy flushQueue?
let _onlineTimer = null;   // handle hẹn giờ onOnline
let _pollTimer = null;     // handle interval poll
let _onlineHandler = null; // listener 'online' đã gắn

// ============================================================================
// Phân giải phụ thuộc (lười)
// ============================================================================

function getGlobal() {
  return (
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    (typeof globalThis !== 'undefined' && globalThis) ||
    null
  );
}

function tryRequire(name) {
  if (typeof require === 'function') {
    try {
      // eslint-disable-next-line global-require
      return require(name);
    } catch (_) {
      /* không sẵn — bỏ qua */
    }
  }
  return null;
}

function resolveDrive() {
  if (_injected.drive) return _injected.drive;
  const g = getGlobal();
  if (g && g.MWLDrive) return g.MWLDrive;
  const mod = tryRequire('./drive-client');
  if (mod) return mod;
  throw new Error('sync: drive-client không khả dụng (nạp drive-client.js hoặc setDependencies).');
}

function resolveStore() {
  if (_injected.store) return _injected.store;
  const g = getGlobal();
  if (g && g.MWLStore) return g.MWLStore;
  const mod = tryRequire('./store');
  if (mod) return mod;
  throw new Error('sync: store không khả dụng (nạp store.js hoặc setDependencies).');
}

function resolveMerge() {
  if (_injected.merge) return _injected.merge;
  const g = getGlobal();
  if (g && g.MWLMerge) return g.MWLMerge;
  const mod = tryRequire('./merge');
  if (mod) return mod;
  throw new Error('sync: merge không khả dụng (nạp merge.js hoặc setDependencies).');
}

function resolveComputeBackoff() {
  if (typeof _injected.computeBackoff === 'function') return _injected.computeBackoff;
  const g = getGlobal();
  if (g && g.MWLBackoff && typeof g.MWLBackoff.computeBackoff === 'function') {
    return g.MWLBackoff.computeBackoff;
  }
  const mod = tryRequire('./backoff');
  if (mod && typeof mod.computeBackoff === 'function') return mod.computeBackoff;
  throw new Error('sync: computeBackoff không khả dụng (nạp backoff.js hoặc setDependencies).');
}

function nowMs() {
  if (typeof _injected.now === 'function') return _injected.now();
  return Date.now();
}

function notify(event) {
  try {
    if (typeof _injected.notify === 'function') {
      _injected.notify(event);
      return;
    }
    const g = getGlobal();
    // Phát một CustomEvent để UI lắng nghe (không bắt buộc).
    if (g && typeof g.dispatchEvent === 'function' && typeof g.CustomEvent === 'function') {
      g.dispatchEvent(new g.CustomEvent('mwl-sync', { detail: event }));
    }
  } catch (_) {
    /* thông báo là best-effort — không được làm hỏng luồng đồng bộ */
  }
}

function getTimer(kind) {
  const g = getGlobal();
  if (kind === 'set') return _injected.setTimeoutFn || (g && g.setTimeout) || setTimeout;
  if (kind === 'clear') return _injected.clearTimeoutFn || (g && g.clearTimeout) || clearTimeout;
  if (kind === 'setInterval') return _injected.setIntervalFn || (g && g.setInterval) || setInterval;
  if (kind === 'clearInterval') return _injected.clearIntervalFn || (g && g.clearInterval) || clearInterval;
  return null;
}

function isOnline() {
  const g = getGlobal();
  if (g && g.navigator && typeof g.navigator.onLine === 'boolean') return g.navigator.onLine;
  return true; // môi trường không có navigator (Node test) ⇒ coi như online
}

// Nhận diện lỗi AuthExpired (theo instanceof drive.AuthExpired hoặc .code/.name).
function isAuthExpired(err) {
  if (!err) return false;
  if (err.code === 'AuthExpired' || err.name === 'AuthExpired') return true;
  try {
    const drive = resolveDrive();
    if (drive && drive.AuthExpired && err instanceof drive.AuthExpired) return true;
  } catch (_) {
    /* bỏ qua */
  }
  return false;
}

// Quy ước tên file nhật ký: logs/<sessionId>.json
function logFileName(sessionId) {
  return `${_config.logsDir}/${sessionId}.json`;
}

// ============================================================================
// flushOne — đồng bộ một mục hàng đợi (đọc-so-gộp-ghi, có vòng lặp xung đột)
// ============================================================================

// Trả { status: 'success'|'dropped', modifiedTime?, reason? }.
// Ném lỗi (mạng/ghi/AuthExpired/ConflictLoopExceeded) để gọi viên xử lý backoff.
async function flushOne(item) {
  const store = resolveStore();
  const drive = resolveDrive();
  const merge = resolveMerge();

  const sessionId = item && item.sessionId;
  if (sessionId == null || sessionId === '') {
    await store.dequeue(item.id); // mục hỏng, không có gì để gửi
    return { status: 'dropped', reason: 'no-sessionId' };
  }

  const name = logFileName(sessionId);
  const local = await store.getLog(sessionId);
  if (!local) {
    await store.dequeue(item.id); // không còn log cục bộ ⇒ bỏ mục
    return { status: 'dropped', reason: 'no-local-log' };
  }

  const base = local.baseDriveModifiedTime != null ? local.baseDriveModifiedTime : null;

  // 1) Đọc bản Drive (lấy modifiedTime). Có thể ném AuthExpired/mạng.
  const driveRes = await drive.readJson(name); // {data, modifiedTime} | null

  let toWrite;
  let expected;
  if (driveRes == null) {
    // Chưa có trên Drive ⇒ ghi mới (không kỳ vọng modifiedTime).
    toWrite = local;
    expected = undefined;
  } else if (driveRes.modifiedTime === base) {
    // Drive chưa đổi kể từ lần đọc gần nhất ⇒ ghi thẳng với kỳ vọng = base (YC9.1).
    toWrite = local;
    expected = base;
  } else {
    // Drive đã đổi ⇒ gộp rồi ghi với kỳ vọng = modifiedTime Drive (YC9.2).
    toWrite = merge.mergeLogs(local, driveRes.data);
    expected = driveRes.modifiedTime;
  }

  // 2) Ghi với kiểm phiên bản; nếu Conflict ⇒ đọc-lại-gộp-lại (vòng lặp có chặn).
  for (let i = 0; i < _config.maxConflictLoops; i += 1) {
    const writeRes = await drive.writeJson(name, toWrite, expected); // có thể ném

    if (writeRes && writeRes.conflict) {
      // Drive đổi tiếp giữa chừng ⇒ gộp với bản mới nhất rồi thử lại (Sync & Conflict Flow).
      const d = writeRes.drive || {};
      toWrite = merge.mergeLogs(toWrite, d.data);
      expected = d.modifiedTime;
      continue;
    }

    // Thành công ⇒ cập nhật baseDriveModifiedTime, lưu cục bộ, gỡ khỏi hàng đợi (YC7.4).
    const newBase = writeRes && writeRes.modifiedTime != null ? writeRes.modifiedTime : expected;
    const updatedLocal = Object.assign({}, toWrite, { baseDriveModifiedTime: newBase });
    await store.putLog(updatedLocal);
    await store.dequeue(item.id);
    return { status: 'success', modifiedTime: newBase };
  }

  // Xung đột liên tục vượt số vòng cho phép ⇒ ném để rơi vào nhánh backoff.
  const e = new Error('Vượt số vòng đọc-gộp-ghi do xung đột Drive liên tục.');
  e.code = 'ConflictLoopExceeded';
  throw e;
}

// Xử lý một mục thất bại: giữ trong queue, tăng attempts, đặt nextAttemptAt theo
// backoff; quá maxAttempts ⇒ đánh dấu needsManual + thông báo (YC8.1, 8.2, 8.4).
async function handleFailure(item, err) {
  const store = resolveStore();
  const computeBackoff = resolveComputeBackoff();
  const attempts = (Number(item && item.attempts) || 0) + 1;
  const lastError = err && err.message ? String(err.message) : 'unknown';

  const patch = { attempts, lastError };

  if (attempts > _config.maxAttempts) {
    patch.needsManual = true; // giữ lại để thử thủ công (YC8.4, 8.5)
    await store.updateQueueItem(item.id, patch);
    notify({ type: 'needsManual', sessionId: item && item.sessionId, attempts, error: lastError });
  } else {
    const delay = computeBackoff(attempts, _config.baseMs, _config.maxMs);
    patch.nextAttemptAt = nowMs() + delay;
    await store.updateQueueItem(item.id, patch);
  }
  return patch;
}

// ============================================================================
// flushQueue — duyệt toàn bộ Hàng_Đợi_Đồng_Bộ
// ============================================================================

// flushQueue({ force }) — với mỗi mục: nếu chưa tới hạn (nextAttemptAt) và không
// force ⇒ bỏ qua; ngược lại flushOne. Lỗi thường ⇒ backoff (giữ mục). AuthExpired
// ⇒ DỪNG và surface (không drop mục, không tăng attempts) (YC10.4).
// Trả tóm tắt { ok, flushed, failed, skipped, manual, pending, authExpired }.
async function flushQueue(opts) {
  const options = opts || {};
  const force = !!options.force;
  const store = resolveStore();

  const summary = { ok: true, flushed: 0, failed: 0, skipped: 0, manual: 0, pending: 0, authExpired: false };

  let items = await store.peekQueue();
  items = Array.isArray(items) ? items : [];

  _flushing = true;
  try {
    for (const item of items) {
      const due = force || !item.nextAttemptAt || nowMs() >= Number(item.nextAttemptAt);
      if (!due) {
        summary.skipped += 1;
        continue;
      }
      try {
        const r = await flushOne(item);
        if (r && (r.status === 'success' || r.status === 'dropped')) summary.flushed += 1;
      } catch (err) {
        if (isAuthExpired(err)) {
          // Surface AuthExpired: KHÔNG drop mục, KHÔNG tăng attempts. Dừng flush.
          summary.ok = false;
          summary.authExpired = true;
          notify({ type: 'authExpired' });
          _flushing = false;
          throw err;
        }
        const patch = await handleFailure(item, err);
        summary.failed += 1;
        if (patch && patch.needsManual) summary.manual += 1;
        summary.ok = false;
      }
    }
  } finally {
    _flushing = false;
  }

  // Số mục còn lại đang chờ.
  try {
    const rest = await store.peekQueue();
    summary.pending = Array.isArray(rest) ? rest.length : 0;
  } catch (_) {
    /* bỏ qua — pending là thông tin phụ */
  }
  return summary;
}

// manualSync — ép gửi lại TOÀN BỘ hàng đợi, bỏ qua nextAttemptAt (YC8.5).
async function manualSync() {
  return flushQueue({ force: true });
}

// ============================================================================
// onOnline — flush trong vòng ≤30s khi có mạng trở lại (YC7.3)
// ============================================================================

function onOnline() {
  const setT = getTimer('set');
  const clearT = getTimer('clear');
  if (_onlineTimer && clearT) {
    try { clearT(_onlineTimer); } catch (_) { /* noop */ }
  }
  const delay = Math.min(Math.max(0, Number(_config.onlineFlushDelayMs) || 0), 30000);
  _onlineTimer = setT(() => {
    _onlineTimer = null;
    Promise.resolve()
      .then(() => flushQueue())
      .catch(() => { /* lỗi đã được xử lý/thông báo bên trong flushQueue */ });
  }, delay);
  return _onlineTimer;
}

// ============================================================================
// pollWeekPack — kiểm Gói_Lịch_Tuần mới theo chu kỳ khi online (YC7.6)
// ============================================================================

// Trả { updated, modifiedTime?, reason? }. Cập nhật cache khi modifiedTime đổi.
async function pollWeekPack() {
  if (!isOnline()) return { updated: false, reason: 'offline' };
  const drive = resolveDrive();
  const store = resolveStore();

  const res = await drive.readJson(_config.weekPackName); // {data, modifiedTime} | null
  if (!res) return { updated: false, reason: 'not-found' };

  let lastMt;
  try {
    lastMt = await store.getMeta('weekPackModifiedTime');
  } catch (_) {
    lastMt = undefined;
  }
  if (lastMt && lastMt === res.modifiedTime) {
    return { updated: false, reason: 'unchanged', modifiedTime: res.modifiedTime };
  }

  await store.putWeekPack(res.data);
  await store.setMeta('weekPackModifiedTime', res.modifiedTime);
  await store.setMeta('weekPackLoadedAt', new Date(nowMs()).toISOString());
  return { updated: true, modifiedTime: res.modifiedTime };
}

// ============================================================================
// syncStatus — trạng thái cho UI (YC2.5, 7.5)
// ============================================================================

// Trả { state: 'synced'|'syncing'|'offline', pending: N }.
async function syncStatus() {
  const store = resolveStore();
  let pending = 0;
  try {
    const q = await store.peekQueue();
    pending = Array.isArray(q) ? q.length : 0;
  } catch (_) {
    /* bỏ qua */
  }

  let state;
  if (!isOnline()) {
    state = 'offline';
  } else if (_flushing || pending > 0) {
    state = 'syncing';
  } else {
    state = 'synced';
  }
  return { state, pending };
}

// ============================================================================
// Tự động hoá vòng đời (tuỳ chọn — gắn listener + interval poll)
// ============================================================================

// startAutoSync() — gắn listener 'online' (gọi onOnline) và bắt đầu interval
// poll Gói_Lịch_Tuần. Gọi stopAutoSync() để gỡ.
function startAutoSync() {
  const g = getGlobal();
  if (g && typeof g.addEventListener === 'function' && !_onlineHandler) {
    _onlineHandler = () => onOnline();
    g.addEventListener('online', _onlineHandler);
  }
  const setI = getTimer('setInterval');
  if (setI && !_pollTimer) {
    _pollTimer = setI(() => {
      Promise.resolve().then(() => pollWeekPack()).catch(() => { /* noop */ });
    }, Math.max(1000, Number(_config.pollIntervalMs) || 0));
  }
  return { online: !!_onlineHandler, polling: !!_pollTimer };
}

function stopAutoSync() {
  const g = getGlobal();
  if (g && typeof g.removeEventListener === 'function' && _onlineHandler) {
    g.removeEventListener('online', _onlineHandler);
  }
  _onlineHandler = null;
  const clearI = getTimer('clearInterval');
  if (clearI && _pollTimer) {
    try { clearI(_pollTimer); } catch (_) { /* noop */ }
  }
  _pollTimer = null;
  const clearT = getTimer('clear');
  if (clearT && _onlineTimer) {
    try { clearT(_onlineTimer); } catch (_) { /* noop */ }
  }
  _onlineTimer = null;
  return { online: false, polling: false };
}

// ============================================================================
// SEAM cấu hình & tiêm phụ thuộc (cho test)
// ============================================================================

// setDependencies(deps) — tiêm mock/stubs. Chỉ ghi đè khoá được cung cấp.
function setDependencies(deps) {
  if (deps && typeof deps === 'object') {
    for (const k of Object.keys(_injected)) {
      if (deps[k] !== undefined) _injected[k] = deps[k];
    }
  }
  return Object.assign({}, _injected);
}

// configureSync(cfg) — chỉnh cấu hình backoff/maxAttempts/chu kỳ… Trả bản sao.
function configureSync(cfg) {
  if (cfg && typeof cfg === 'object') {
    for (const k of Object.keys(_config)) {
      if (cfg[k] !== undefined) _config[k] = cfg[k];
    }
  }
  return Object.assign({}, _config);
}

// resetSync() — gỡ mọi tiêm phụ thuộc + dừng auto-sync (khôi phục mặc định cho test).
function resetSync() {
  for (const k of Object.keys(_injected)) _injected[k] = null;
  _flushing = false;
  stopAutoSync();
  return true;
}

// ============================================================================
// Phơi API
// ============================================================================

const api = {
  // điều phối chính
  flushQueue,
  flushOne,
  onOnline,
  pollWeekPack,
  manualSync,
  syncStatus,
  // tự động hoá vòng đời
  startAutoSync,
  stopAutoSync,
  // tiện ích
  logFileName,
  // re-export computeBackoff (TÁI SỬ DỤNG từ backoff.js — không cài lại)
  computeBackoff: (...args) => resolveComputeBackoff()(...args),
  // seam test/cấu hình
  setDependencies,
  configureSync,
  resetSync,
};

// Phơi cho trình duyệt theo quy ước script thuần của PWA.
(function exposeGlobal() {
  const g = getGlobal();
  if (g) g.MWLSync = api;
})();

// Guarded CommonJS export để nạp/kiểm cú pháp + test trong Node.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
