'use strict';

// Feature: mobile-workout-logger
// pwa/sw.js — Service Worker cho Ứng_Dụng_Ghi_Buổi.
// Web/JS thuần, KHÔNG bước build, KHÔNG thư viện ngoài.
//
// Mục tiêu (design.md > Components > app-pwa.js + manifest + sw.js):
//   - Precache "vỏ ứng dụng" (index.html, các module JS, app.css) — KHÔNG video (YC1.4).
//   - Chiến lược cache-first cho vỏ ⇒ mở được offline (YC2.1).
//   - network-only (bỏ qua cache) cho Google Drive API + Google OAuth — dữ liệu
//     khách luôn đi thẳng tới Google, không bao giờ phục vụ từ cache (YC7.1, 11.x).
//   - Hằng số phiên bản cache + dọn cache cũ khi activate.
//
// Requirements: 1.1, 1.2, 1.4, 2.1.

// ---- Phiên bản cache (tăng khi đổi vỏ ứng dụng để buộc cập nhật) -----------
const CACHE_VERSION = 'v3';
const SHELL_CACHE = `mwl-shell-${CACHE_VERSION}`;

// ---- Danh sách "vỏ" cần precache (tương đối với scope = thư mục pwa/) -------
// CHỈ nội dung chữ/mã: HTML, manifest, CSS, các module JS. TUYỆT ĐỐI không video.
// Thứ tự không quan trọng cho cache; thứ tự nạp do index.html quyết định.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app.css',
  './store.js',
  './merge.js',
  './backoff.js',
  './logmodel.js',
  './drive-client.js',
  './sync.js',
  './app-pwa.js',
];

// ---- Máy chủ chỉ-mạng (network-only): Drive API + OAuth -------------------
// Mọi request tới các host này LUÔN đi thẳng ra mạng, không đọc/ghi cache.
const NETWORK_ONLY_HOSTS = [
  'googleapis.com',        // www.googleapis.com (Drive API), apis.google.com
  'accounts.google.com',   // màn hình đồng ý OAuth
  'oauth2.googleapis.com', // token/refresh/revoke endpoint
];

function isNetworkOnly(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch (_) {
    return false;
  }
  return NETWORK_ONLY_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`) || host.endsWith(h)
  );
}

// ---- install: precache vỏ (chịu lỗi từng tệp để không chặn cài đặt) -------
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Cache từng tệp riêng lẻ: nếu một tệp chưa tồn tại (vd app.css do task 10
      // tạo sau), việc cài đặt vẫn thành công thay vì rớt toàn bộ như addAll.
      await Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          try {
            const req = new Request(asset, { cache: 'reload' });
            const resp = await fetch(req);
            if (resp && (resp.ok || resp.type === 'opaque')) {
              await cache.put(asset, resp.clone());
            }
          } catch (_) {
            // Bỏ qua tệp lỗi/thiếu — phần còn lại của vỏ vẫn được cache.
          }
        })
      );
      // Kích hoạt ngay phiên bản SW mới.
      await self.skipWaiting();
    })()
  );
});

// ---- activate: dọn cache phiên bản cũ -------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('mwl-shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// ---- fetch: network-only cho Google; cache-first cho vỏ -------------------
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Chỉ xử lý GET; các method khác (POST tới Drive…) đi thẳng mạng.
  if (request.method !== 'GET') return;

  // Drive API + OAuth: network-only, không bao giờ phục vụ từ cache.
  if (isNetworkOnly(request.url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Vỏ ứng dụng: cache-first, dự phòng mạng (và lưu lại bản mới khi tải được).
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const resp = await fetch(request);
        // Chỉ cache phản hồi same-origin hợp lệ (tránh cache phản hồi lạ).
        if (resp && resp.ok && resp.type === 'basic') {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, resp.clone());
        }
        return resp;
      } catch (err) {
        // Offline và không có trong cache: thử trả về index.html cho điều hướng.
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
