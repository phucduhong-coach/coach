'use strict';

// Feature: mobile-workout-logger
// pwa/app-pwa.js — Điểm khởi động của Ứng_Dụng_Ghi_Buổi.
// Web/JS thuần, KHÔNG bước build, KHÔNG thư viện ngoài.
//
// Phạm vi TASK 9.2 — Khởi động app + trạng thái kết nối:
//   - Khôi phục từ Cache_Offline (MWLStore.getWeekPack) để mở được dữ liệu cũ kể cả
//     khi offline (YC2.4).
//   - Nếu online VÀ đã Kết_Nối_Google: poll Gói_Lịch_Tuần mới về cache (YC6.1) và
//     hiển thị thời điểm tải `weekPackLoadedAt` (YC6.4). Thiếu gói (không có ở cache
//     lẫn Drive) ⇒ hướng dẫn HLV "Đưa lịch tuần ra điện thoại" từ laptop (YC6.3).
//   - Hiện trạng thái kết nối online/offline + badge trạng thái đồng bộ; cập nhật theo
//     sự kiện 'online'/'offline' và sau mỗi lần đồng bộ (YC2.5; dùng MWLSync.syncStatus).
//   - Chặn hiển thị dữ liệu khách khi CHƯA Kết_Nối_Google (không có uỷ quyền/chưa chọn
//     thư mục) ⇒ hiện lời nhắc "Kết nối Google" thay cho dữ liệu (YC11.5).
//   - First paint nhanh (< 3s, YC1.5): render vỏ ngay, hydrate (truy IndexedDB/Drive) sau.
//
// ============================================================================
// HỢP ĐỒNG DOM CHO TASK 10 (logger-ui.js)
// ----------------------------------------------------------------------------
// app-pwa.js sở hữu vòng đời khởi động + cổng kết nối; logger-ui.js (task 10) sở hữu
// việc render danh sách buổi + ô nhập set. Hai bên ghép qua các container + state sau:
//
//   Container DOM (index.html dựng sẵn, app-pwa.js KHÔNG xoá khỏi DOM):
//     #connection-status  — badge online/offline (app-pwa quản lý văn bản + data-state).
//     #mwl-status         — badge trạng thái ĐỒNG BỘ (app-pwa quản lý: synced/syncing/offline + số chờ).
//     #mwl-connect        — vùng lời nhắc "Kết nối Google" (app-pwa hiện/ẩn; chứa #mwl-connect-btn).
//     #mwl-weekinfo       — dòng thông tin Gói_Lịch_Tuần: thời điểm tải / "thiếu gói" (app-pwa quản lý).
//     #mwl-sessions       — VÙNG DÀNH CHO TASK 10 render danh sách buổi. app-pwa chỉ xoá/ẩn
//                           nội dung khi CHƯA kết nối (cổng YC11.5); khi đã kết nối app-pwa
//                           để trống cho task 10 toàn quyền render.
//
//   API JS (window.MWLApp):
//     MWLApp.boot()              — khởi động (idempotent).
//     MWLApp.getState()          — trả bản sao state hiện tại (xem hình dạng dưới).
//     MWLApp.onState(cb)         — đăng ký lắng nghe; gọi cb(state) NGAY với state hiện tại
//                                  và mỗi lần state đổi. Task 10 dùng để biết khi nào có
//                                  weekPack + đã kết nối để render #mwl-sessions.
//     MWLApp.refresh()           — chạy lại hydrate (khôi phục cache + poll) và phát state.
//     MWLApp.refreshSyncStatus() — đọc MWLSync.syncStatus() và cập nhật badge #mwl-status.
//
//   Hình dạng state (cũng phát qua window event 'mwl-app-state', detail = state):
//     {
//       online: boolean,            // navigator.onLine
//       connected: boolean,         // đã Kết_Nối_Google (có uỷ quyền + đã chọn thư mục)
//       hasAuth: boolean,           // có refresh token đã lưu
//       hasFolder: boolean,         // đã chọn thư mục _coach_data (folderId)
//       weekPack: object|null,      // Gói_Lịch_Tuần đang dùng (từ cache hoặc Drive)
//       weekPackLoadedAt: string|null, // ISO thời điểm tải gói gần nhất (YC6.4)
//       missingWeekPack: boolean,   // true ⇒ chưa có gói ở cache lẫn Drive (YC6.3)
//       sync: { state: 'synced'|'syncing'|'offline', pending: number }, // YC2.5/7.5
//     }
// ============================================================================
//
// Requirements: 1.5, 2.4, 2.5, 6.1, 6.3, 6.4, 11.5.

(function () {
  function getGlobal() {
    return (
      (typeof self !== 'undefined' && self) ||
      (typeof window !== 'undefined' && window) ||
      (typeof globalThis !== 'undefined' && globalThis) ||
      null
    );
  }

  const g = getGlobal();

  // ---- Phân giải phụ thuộc (lười, không bắt buộc có mặt) -------------------

  function getStore() {
    return (g && g.MWLStore) || null;
  }
  function getSync() {
    return (g && g.MWLSync) || null;
  }
  function getDrive() {
    return (g && g.MWLDrive) || null;
  }

  // ---- Tiện ích DOM ---------------------------------------------------------

  function el(id) {
    return g && g.document ? g.document.getElementById(id) : null;
  }
  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }
  function show(id, visible) {
    const node = el(id);
    if (node) node.hidden = !visible;
  }

  function isOnline() {
    return !!(g && g.navigator && g.navigator.onLine);
  }

  // ---- State + bộ lắng nghe (cho task 10) -----------------------------------

  const state = {
    online: isOnline(),
    connected: false,
    hasAuth: false,
    hasFolder: false,
    weekPack: null,
    weekPackLoadedAt: null,
    missingWeekPack: false,
    sync: { state: isOnline() ? 'synced' : 'offline', pending: 0 },
  };

  const _stateListeners = [];

  function getState() {
    // Trả bản sao nông để bên ngoài không sửa trực tiếp state nội bộ.
    return Object.assign({}, state, { sync: Object.assign({}, state.sync) });
  }

  function emitState() {
    const snapshot = getState();
    for (const cb of _stateListeners) {
      try {
        cb(snapshot);
      } catch (_) {
        // listener lỗi không được làm hỏng vòng đời app.
      }
    }
    try {
      if (g && typeof g.dispatchEvent === 'function' && typeof g.CustomEvent === 'function') {
        g.dispatchEvent(new g.CustomEvent('mwl-app-state', { detail: snapshot }));
      }
    } catch (_) {
      /* best-effort */
    }
  }

  // onState(cb) — đăng ký; gọi ngay với state hiện tại để task 10 render lần đầu.
  function onState(cb) {
    if (typeof cb !== 'function') return function () {};
    _stateListeners.push(cb);
    try {
      cb(getState());
    } catch (_) {
      /* noop */
    }
    // Trả hàm huỷ đăng ký.
    return function off() {
      const i = _stateListeners.indexOf(cb);
      if (i >= 0) _stateListeners.splice(i, 1);
    };
  }

  // ---- Render trạng thái kết nối (online/offline) — YC2.5 -------------------

  function renderConnectionStatus() {
    state.online = isOnline();
    const node = el('connection-status');
    if (node) {
      node.textContent = state.online ? 'Đang online' : 'Đang offline';
      node.dataset.state = state.online ? 'online' : 'offline';
    }
  }

  // ---- Render badge trạng thái đồng bộ (YC2.5, 7.5) -------------------------

  function paintSyncBadge() {
    const node = el('mwl-status');
    if (!node) return;
    const s = state.sync || { state: 'synced', pending: 0 };
    const labels = { synced: 'Đã đồng bộ', syncing: 'Đang đồng bộ', offline: 'Ngoại tuyến' };
    let text = labels[s.state] || s.state;
    if (s.pending > 0) text += ` (${s.pending} chờ)`;
    node.textContent = text;
    node.dataset.state = s.state;
  }

  // refreshSyncStatus() — đọc MWLSync.syncStatus() và cập nhật badge.
  async function refreshSyncStatus() {
    const sync = getSync();
    if (sync && typeof sync.syncStatus === 'function') {
      try {
        const st = await sync.syncStatus();
        if (st && typeof st === 'object') {
          state.sync = { state: st.state || 'synced', pending: Number(st.pending) || 0 };
        }
      } catch (_) {
        // Không lấy được ⇒ suy ra tối thiểu từ trạng thái mạng.
        state.sync = { state: isOnline() ? 'synced' : 'offline', pending: state.sync.pending };
      }
    } else {
      state.sync = { state: isOnline() ? 'synced' : 'offline', pending: 0 };
    }
    paintSyncBadge();
    return state.sync;
  }

  // ---- Cổng Kết_Nối_Google (YC11.5) -----------------------------------------

  // checkConnected() — xác định đã Kết_Nối_Google chưa MÀ KHÔNG kích hoạt OAuth/Picker.
  // Đã kết nối = có refresh token đã lưu (hasAuth) VÀ đã chọn thư mục _coach_data (hasFolder).
  // Đọc trực tiếp meta của store (drive-client lưu 'refreshToken' và 'folderId').
  async function checkConnected() {
    const store = getStore();
    let hasAuth = false;
    let hasFolder = false;
    if (store && typeof store.getMeta === 'function') {
      try {
        hasAuth = !!(await store.getMeta('refreshToken'));
      } catch (_) {
        hasAuth = false;
      }
      try {
        hasFolder = !!(await store.getMeta('folderId'));
      } catch (_) {
        hasFolder = false;
      }
    }
    state.hasAuth = hasAuth;
    state.hasFolder = hasFolder;
    state.connected = hasAuth && hasFolder;
    return state.connected;
  }

  // Hiện/ẩn lời nhắc kết nối; khi chưa kết nối thì CHẶN dữ liệu khách (YC11.5).
  function renderConnectGate() {
    show('mwl-connect', !state.connected);
    if (!state.connected) {
      // Xoá dữ liệu khách đang hiển thị (nếu có) để không lộ khi chưa kết nối.
      const sessions = el('mwl-sessions');
      if (sessions) sessions.innerHTML = '';
      show('mwl-sessions', false);
      const msg = !state.hasAuth
        ? 'Hãy kết nối Google để xem lịch và ghi buổi tập.'
        : 'Hãy chọn thư mục _coach_data để hoàn tất kết nối.';
      setText('mwl-connect-msg', msg);
    } else {
      // Đã kết nối ⇒ mở vùng cho task 10 render danh sách buổi.
      show('mwl-sessions', true);
    }
  }

  // Wire nút "Kết nối Google" → đăng nhập GIS, rồi MỞ LUÔN bước chọn thư mục _coach_data,
  // rồi làm mới app để hiển thị dữ liệu (cùng một thao tác của người dùng).
  function wireConnectButton() {
    const btn = el('mwl-connect-btn');
    const drive = getDrive();
    if (!btn || !drive || typeof drive.connectGoogle !== 'function') return;
    if (btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', function () {
      setText('mwl-connect-msg', 'Đang kết nối Google…');
      Promise.resolve()
        .then(() => drive.connectGoogle())
        .then(() => {
          // Sau khi đăng nhập: mở Google Picker để chọn thư mục _coach_data (lưu folderId).
          setText('mwl-connect-msg', 'Hãy chọn thư mục _coach_data…');
          return typeof drive.resolveDataFolder === 'function' ? drive.resolveDataFolder() : null;
        })
        .then(() => refresh()) // hydrate lại: đã có auth + folder ⇒ hiển thị danh sách buổi.
        .catch((err) => {
          setText('mwl-connect-msg', 'Kết nối Google thất bại. Vui lòng thử lại.');
          if (g && g.console) g.console.warn('connectGoogle lỗi:', err);
        });
    });
  }

  // Nếu URL quay lại từ Google có ?code=&state= ⇒ hoàn tất đổi token (YC10.1/10.2).
  async function completeOAuthCallbackIfAny() {
    const drive = getDrive();
    if (!drive || typeof drive.connectGoogle !== 'function') return;
    const search = (g && g.location && g.location.search) || '';
    if (search.indexOf('code=') === -1) return;
    try {
      await drive.connectGoogle();
    } catch (err) {
      if (g && g.console) g.console.warn('Hoàn tất OAuth callback lỗi:', err);
    }
  }

  // ---- Render thông tin Gói_Lịch_Tuần (YC6.3, 6.4) --------------------------

  function renderWeekInfo() {
    const node = el('mwl-weekinfo');
    if (!node) return;
    if (!state.connected) {
      node.textContent = '';
      node.dataset.state = 'disconnected';
      return;
    }
    if (state.missingWeekPack) {
      // Thiếu gói ⇒ hướng dẫn xuất từ laptop (YC6.3).
      node.textContent = 'Chưa có lịch tuần. Hãy "Đưa lịch tuần ra điện thoại" từ máy tính.';
      node.dataset.state = 'missing';
      return;
    }
    if (state.weekPackLoadedAt) {
      node.textContent = `Lịch tuần đã tải lúc ${formatLoadedAt(state.weekPackLoadedAt)}`;
      node.dataset.state = 'loaded';
    } else {
      node.textContent = '';
      node.dataset.state = 'loaded';
    }
  }

  // Định dạng thời điểm tải gọn gàng; lỗi parse ⇒ trả nguyên chuỗi.
  function formatLoadedAt(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString('vi-VN');
    } catch (_) {
      return String(iso);
    }
  }

  // ---- Hydrate: khôi phục cache + poll khi online (YC2.4, 6.1) --------------

  async function hydrate() {
    const store = getStore();
    const sync = getSync();

    renderConnectionStatus();

    // 1) Hoàn tất OAuth callback nếu vừa quay lại từ Google.
    await completeOAuthCallbackIfAny();

    // 2) Xác định trạng thái kết nối (không kích hoạt Picker).
    await checkConnected();

    // 3) Khôi phục Gói_Lịch_Tuần từ Cache_Offline để mở được kể cả offline (YC2.4).
    let cachedPack = null;
    if (store && typeof store.getWeekPack === 'function') {
      try {
        cachedPack = await store.getWeekPack();
      } catch (_) {
        cachedPack = null;
      }
    }
    if (cachedPack) state.weekPack = cachedPack;

    if (store && typeof store.getMeta === 'function') {
      try {
        const loadedAt = await store.getMeta('weekPackLoadedAt');
        if (loadedAt) state.weekPackLoadedAt = loadedAt;
      } catch (_) {
        /* bỏ qua */
      }
    }

    // 4) Nếu online VÀ đã kết nối ⇒ poll gói mới nhất về cache (YC6.1) + cập nhật giờ tải (YC6.4).
    if (state.connected && isOnline() && sync && typeof sync.pollWeekPack === 'function') {
      try {
        const res = await sync.pollWeekPack();
        if (res && res.updated) {
          // Đọc lại bản mới + thời điểm tải vừa cập nhật.
          if (store && typeof store.getWeekPack === 'function') {
            try {
              const fresh = await store.getWeekPack();
              if (fresh) state.weekPack = fresh;
            } catch (_) {
              /* giữ bản cache cũ */
            }
          }
          if (store && typeof store.getMeta === 'function') {
            try {
              const loadedAt = await store.getMeta('weekPackLoadedAt');
              if (loadedAt) state.weekPackLoadedAt = loadedAt;
            } catch (_) {
              /* bỏ qua */
            }
          }
        }
      } catch (_) {
        // Poll thất bại (mạng/auth) ⇒ vẫn dùng bản cache; không chặn app.
      }
    }

    // 5) Thiếu gói khi đã kết nối (không cache + (online nhưng Drive cũng không có)) ⇒ hướng dẫn xuất (YC6.3).
    state.missingWeekPack = state.connected && !state.weekPack;

    // 6) Render cổng kết nối + thông tin gói + badge đồng bộ.
    wireConnectButton();
    renderConnectGate();
    renderWeekInfo();
    await refreshSyncStatus();

    emitState();
    return getState();
  }

  // refresh() — công khai cho task 10 / nút làm mới: chạy lại hydrate.
  function refresh() {
    return hydrate().catch((err) => {
      if (g && g.console) g.console.warn('hydrate lỗi:', err);
      return getState();
    });
  }

  // ---- Cập nhật theo sự kiện mạng (YC2.5) -----------------------------------

  function handleOnline() {
    renderConnectionStatus();
    // Có mạng lại ⇒ làm mới badge đồng bộ sớm; MWLSync.onOnline tự lo flush hàng đợi.
    refreshSyncStatus().then(emitState).catch(() => emitState());
  }
  function handleOffline() {
    renderConnectionStatus();
    state.sync = { state: 'offline', pending: state.sync.pending };
    paintSyncBadge();
    emitState();
  }
  function handleSyncEvent() {
    // MWLSync phát 'mwl-sync' sau các sự kiện đồng bộ ⇒ làm mới badge.
    refreshSyncStatus().then(emitState).catch(() => emitState());
  }

  let _booted = false;

  // boot() — hook khởi động. Idempotent (gọi nhiều lần an toàn).
  // Render vỏ ngay (first paint nhanh — YC1.5), sau đó hydrate bất đồng bộ.
  function boot() {
    if (_booted) return getState();
    _booted = true;

    // Theo dõi online/offline + sự kiện đồng bộ để cập nhật trạng thái (YC2.5).
    if (g && typeof g.addEventListener === 'function') {
      g.addEventListener('online', handleOnline);
      g.addEventListener('offline', handleOffline);
      g.addEventListener('mwl-sync', handleSyncEvent);
    }

    // First paint: vẽ trạng thái tĩnh ngay từ DOM có sẵn, KHÔNG chờ I/O.
    renderConnectionStatus();
    paintSyncBadge();

    // Khởi động đồng bộ nền (listener 'online' + poll Gói_Lịch_Tuần) nếu sẵn sàng.
    try {
      const sync = getSync();
      if (sync && typeof sync.startAutoSync === 'function') {
        sync.startAutoSync();
      }
    } catch (_) {
      // Auto-sync best-effort; không chặn khởi động.
    }

    // Hydrate (truy IndexedDB/Drive) chạy nền — không chặn first paint (YC1.5).
    Promise.resolve()
      .then(hydrate)
      .catch((err) => {
        if (g && g.console) g.console.warn('Khởi động hydrate lỗi:', err);
      });

    return getState();
  }

  const api = {
    boot,
    refresh,
    getState,
    onState,
    renderConnectionStatus,
    refreshSyncStatus,
  };

  // Phơi global theo quy ước script thuần của PWA.
  if (g) g.MWLApp = api;

  // Tự động boot khi DOM sẵn sàng (chỉ trong trình duyệt có document).
  if (g && g.document) {
    if (g.document.readyState === 'loading') {
      g.document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }

  // Guarded CommonJS export để kiểm cú pháp/nạp trong Node.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
