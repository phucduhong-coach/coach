'use strict';

// (Bọc IIFE: cô lập khai báo top-level để không trùng tên giữa các <script> trong trình duyệt.)
(function () {
// Feature: mobile-workout-logger
// pwa/drive-client.js — Lớp I/O Google Drive (OAuth + Picker + Drive API).
// Web/JS thuần, KHÔNG bước build, KHÔNG thư viện ngoài. Chỉ chạy trong trình duyệt
// (qua HTTPS — yêu cầu của service worker và YC11.1).
//
// Tham chiếu: design.md
//   > Components > pwa/drive-client.js (hợp đồng hàm)
//   > Security & Privacy (drive.file + Picker; refresh token trong IndexedDB; xoá khi đăng xuất)
//   > Quyết định đã chốt (PKCE public client, GitHub Pages, OAuth client một lần có tài liệu)
//
// PHẠM VI TASK 7.1 (phần kết nối/uỷ quyền):
//   - connectGoogle()      OAuth 2.0 Authorization Code + PKCE (S256 qua Web Crypto)
//   - ensureAccessToken()  trả access token hợp lệ, tự refresh; ném AuthExpired khi hỏng/bị thu hồi
//   - pickDataFolder()     Google Picker để chọn thư mục _coach_data một lần → lưu folderId
//   - resolveDataFolder()  trả folderId đã lưu, hoặc gọi pickDataFolder() nếu chưa có
//   - disconnect()         thu hồi token ở endpoint revoke của Google + clearClientData()
//   - configureDrive()     seam cấu hình điền sau khi tạo OAuth client (task 15.1)
//
// LƯU Ý: readJson(name)/writeJson(name,obj,expectedModifiedTime?) là TASK 7.2 — KHÔNG
// triển khai ở đây. resolveDataFolder()/ensureAccessToken() được phơi ra để 7.2 dựng tiếp.
//
// Requirements: 10.1 (OAuth), 10.2 (lưu uỷ quyền/đăng nhập lại), 10.3 (tự refresh),
//               10.4 (AuthExpired khi hết hạn/thu hồi), 10.7 (đăng xuất thu hồi),
//               11.1 (HTTPS), 11.2 (chỉ phạm vi drive.file).

// ============================================================================
// CONFIG SEAM — ĐIỀN SAU KHI TẠO GOOGLE CLOUD OAuth CLIENT (xem task 15.1)
// ----------------------------------------------------------------------------
// PKCE public client (loại "Web application") — KHÔNG có client secret.
// Có thể điền trực tiếp các hằng dưới đây, hoặc gọi configureDrive({...}) lúc khởi động.
//   - clientId    : OAuth 2.0 Client ID (….apps.googleusercontent.com)
//   - redirectUri : URL trang callback trên GitHub Pages (HTTPS), khớp "Authorized
//                   redirect URIs" trong Google Cloud Console. Ví dụ:
//                   "https://<user>.github.io/<repo>/pwa/index.html"
//   - apiKey      : (Picker) Developer key / API key cho Google Picker. Tuỳ chọn nhưng
//                   nên có để Picker hoạt động ổn định.
//   - appId       : (Picker) Project number của dự án Google Cloud. Tuỳ chọn.
// ============================================================================
const DRIVE_CONFIG = {
  clientId: '73756387461-5ebq2o38g8g9lg0h79c4md8h9cc56762.apps.googleusercontent.com',
  clientSecret: '', // FILL_IN: "Client secret" của OAuth client (Web application) trong Google Cloud
  redirectUri: 'https://phucduhong-coach.github.io/coach/pwa/index.html',
  apiKey: '', // (Picker developer key — tuỳ chọn; để '' vẫn chạy)
  appId: '73756387461', // Project number (cho Google Picker)
};

// ---- Hằng số phạm vi & endpoint (KHÔNG đổi) --------------------------------

// Phạm vi: drive.file (tạo/ghi file của app, vd logs) + drive.readonly (ĐỌC file do
// máy tính/Drive Desktop tạo, vd week-pack.json). Cần readonly vì app phải đọc lịch
// tuần do Hệ_Thống_Laptop ghi — drive.file không thấy file do bên khác tạo.
const DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// Script Google API (nạp động cho Picker). Tài liệu index.html bên dưới.
const GAPI_SCRIPT_SRC = 'https://apis.google.com/js/api.js';

// Khoá meta (đồng nhất với store.js / CLIENT_META_KEYS để clearClientData xoá đúng).
const META_REFRESH_TOKEN = 'refreshToken';
const META_FOLDER_ID = 'folderId';

// Khoá sessionStorage cho luồng PKCE redirect (tồn tại qua lần chuyển trang).
const SS_VERIFIER = 'mwl_pkce_verifier';
const SS_STATE = 'mwl_pkce_state';

// Đệm an toàn trước khi access token hết hạn (refresh sớm 60s).
const TOKEN_SKEW_MS = 60 * 1000;

// ---- Trạng thái phiên (chỉ trong bộ nhớ — KHÔNG ghi access token ra đĩa) ----

let _accessToken = null; // access token đang dùng (RAM phiên)
let _accessTokenExpiry = 0; // epoch ms hết hạn ước tính
let _pickerApiReady = null; // Promise nạp Picker (singleton)

// ============================================================================
// Lỗi định kiểu
// ============================================================================

// AuthExpired — ném khi không thể lấy/refresh access token (hết hạn hoặc bị thu hồi).
// UI bắt lỗi này để hướng dẫn Kết_Nối_Google lại mà KHÔNG xoá log đang chờ (YC10.4).
class AuthExpired extends Error {
  constructor(message, cause) {
    super(message || 'Phiên Google đã hết hạn hoặc bị thu hồi — cần Kết_Nối_Google lại.');
    this.name = 'AuthExpired';
    this.code = 'AuthExpired';
    if (cause !== undefined) this.cause = cause;
  }
}

// DriveConfigError — thiếu cấu hình OAuth client (clientId/redirectUri chưa điền).
class DriveConfigError extends Error {
  constructor(message) {
    super(message || 'Thiếu cấu hình OAuth (clientId/redirectUri). Xem CONFIG SEAM trong drive-client.js.');
    this.name = 'DriveConfigError';
    this.code = 'DriveConfigError';
  }
}

// ============================================================================
// Tiện ích môi trường
// ============================================================================

function getGlobal() {
  return (
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    (typeof globalThis !== 'undefined' && globalThis) ||
    null
  );
}

// Lấy lớp lưu trữ IndexedDB (global MWLStore trong trình duyệt; require khi ở Node).
function getStore() {
  const g = getGlobal();
  if (g && g.MWLStore) return g.MWLStore;
  if (typeof require === 'function') {
    try {
      // eslint-disable-next-line global-require
      return require('./store');
    } catch (_) {
      /* không sẵn — rơi xuống lỗi bên dưới */
    }
  }
  throw new Error('MWLStore không khả dụng — đảm bảo store.js đã được nạp trước drive-client.js.');
}

// Bắt buộc HTTPS (cho phép localhost khi phát triển) — YC11.1.
function assertSecureContext() {
  const g = getGlobal();
  const loc = g && g.location;
  if (!loc) return; // môi trường không có location (vd Node kiểm cú pháp) — bỏ qua.
  const host = loc.hostname || '';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (loc.protocol !== 'https:' && !isLocal) {
    throw new Error('Yêu cầu HTTPS (YC11.1): drive-client chỉ hoạt động qua kết nối an toàn.');
  }
}

// Cấu hình đã đầy đủ chưa?
function requireConfig() {
  if (!DRIVE_CONFIG.clientId || !DRIVE_CONFIG.redirectUri) {
    throw new DriveConfigError();
  }
  return DRIVE_CONFIG;
}

// configureDrive({clientId, redirectUri, apiKey?, appId?}) → gộp cấu hình; trả bản sao.
function configureDrive(cfg) {
  if (cfg && typeof cfg === 'object') {
    if (cfg.clientId != null) DRIVE_CONFIG.clientId = String(cfg.clientId);
    if (cfg.clientSecret != null) DRIVE_CONFIG.clientSecret = String(cfg.clientSecret);
    if (cfg.redirectUri != null) DRIVE_CONFIG.redirectUri = String(cfg.redirectUri);
    if (cfg.apiKey != null) DRIVE_CONFIG.apiKey = String(cfg.apiKey);
    if (cfg.appId != null) DRIVE_CONFIG.appId = String(cfg.appId);
  }
  return Object.assign({}, DRIVE_CONFIG);
}

// ============================================================================
// PKCE (Web Crypto)
// ============================================================================

function getCrypto() {
  const g = getGlobal();
  const c = g && (g.crypto || g.msCrypto);
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('Web Crypto không khả dụng — cần ngữ cảnh an toàn (HTTPS).');
  }
  return c;
}

// Mã hoá base64url (không padding) từ Uint8Array.
function base64UrlEncode(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(bytes[i]);
  }
  const g = getGlobal();
  const b64 = (g && typeof g.btoa === 'function' ? g.btoa(str) : Buffer.from(bytes).toString('base64'));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Sinh code_verifier ngẫu nhiên (43..128 ký tự an toàn URL).
function generateCodeVerifier() {
  const c = getCrypto();
  const bytes = new Uint8Array(48); // 48 byte → 64 ký tự base64url
  c.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// code_challenge = BASE64URL(SHA-256(code_verifier)).
async function deriveCodeChallenge(verifier) {
  const c = getCrypto();
  const data = new TextEncoder().encode(verifier);
  const digest = await c.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

// state ngẫu nhiên chống CSRF.
function generateState() {
  const c = getCrypto();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ============================================================================
// OAuth — connectGoogle (PKCE, luồng redirect)
// ============================================================================

// Dựng URL uỷ quyền. access_type=offline + prompt=consent để luôn nhận refresh token.
function buildAuthUrl(codeChallenge, state) {
  const cfg = requireConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ============================================================================
// Google Identity Services (GIS) — token client cho ứng dụng web (KHÔNG cần secret)
// ----------------------------------------------------------------------------
// Google chặn dùng client_secret trong trình duyệt; cách chuẩn cho web app là GIS
// token model: initTokenClient + requestAccessToken() trả access token ngay trên
// trình duyệt (popup), không client_secret, không refresh token (token ~1 giờ; khi
// online app tự xin token mới — im lặng nếu phiên Google còn hiệu lực).
// Yêu cầu: origin trang phải nằm trong "Authorized JavaScript origins" của OAuth client.
// (YC10.1 OAuth, YC11.1 HTTPS, YC11.2 chỉ drive.file)
// ============================================================================

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let _gisReady = null; // Promise nạp GIS (singleton)
let _tokenClient = null; // GIS token client (singleton)
let _pendingToken = null; // { resolve, reject } cho lần requestAccessToken đang chờ

// Nạp script GIS (singleton). accounts.google.com nằm trong NETWORK_ONLY của SW ⇒ luôn từ mạng.
function loadGis() {
  if (_gisReady) return _gisReady;
  _gisReady = new Promise((resolve, reject) => {
    const g = getGlobal();
    if (!g || !g.document) {
      reject(new Error('Google Identity Services chỉ chạy trong trình duyệt.'));
      return;
    }
    if (g.google && g.google.accounts && g.google.accounts.oauth2) {
      resolve(g.google.accounts.oauth2);
      return;
    }
    const existing = g.document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    const script = existing || g.document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      'load',
      () => {
        if (g.google && g.google.accounts && g.google.accounts.oauth2) {
          resolve(g.google.accounts.oauth2);
        } else {
          reject(new Error('Không khởi tạo được Google Identity Services.'));
        }
      },
      { once: true }
    );
    script.addEventListener('error', () => reject(new Error(`Không tải được ${GIS_SCRIPT_SRC}`)), {
      once: true,
    });
    if (!existing) g.document.body.appendChild(script);
  }).catch((err) => {
    _gisReady = null; // cho phép thử lại
    throw err;
  });
  return _gisReady;
}

// Khởi tạo token client một lần; callback/error_callback điều phối tới _pendingToken.
function getTokenClient(oauth2) {
  if (_tokenClient) return _tokenClient;
  const cfg = requireConfig();
  _tokenClient = oauth2.initTokenClient({
    client_id: cfg.clientId,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      const p = _pendingToken;
      _pendingToken = null;
      if (!p) return;
      if (resp && resp.error) {
        p.reject(new AuthExpired('GIS: ' + (resp.error_description || resp.error)));
        return;
      }
      if (!resp || !resp.access_token) {
        p.reject(new AuthExpired('GIS không trả access token.'));
        return;
      }
      _accessToken = resp.access_token;
      _accessTokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      p.resolve(resp.access_token);
    },
    error_callback: (err) => {
      const p = _pendingToken;
      _pendingToken = null;
      if (p) p.reject(new AuthExpired('GIS lỗi: ' + (err && (err.type || err.message) || 'unknown')));
    },
  });
  return _tokenClient;
}

// requestToken(prompt) → mở luồng GIS lấy access token.
//   prompt 'consent' = hiện màn đồng ý (lần đầu); '' = im lặng nếu đã đồng ý + còn phiên.
function requestToken(prompt) {
  return loadGis().then((oauth2) => {
    const client = getTokenClient(oauth2);
    return new Promise((resolve, reject) => {
      _pendingToken = { resolve, reject };
      try {
        client.requestAccessToken(prompt != null ? { prompt } : {});
      } catch (err) {
        _pendingToken = null;
        reject(err);
      }
    });
  });
}

// connectGoogle() → mở popup chọn tài khoản + đồng ý (lần đầu), lấy access token (GIS).
// Lưu một "sentinel" để app biết đã kết nối (giữ tương thích checkConnected cũ). { ok:true }.
async function connectGoogle() {
  assertSecureContext();
  requireConfig();
  await requestToken('consent');
  try {
    await getStore().setMeta(META_REFRESH_TOKEN, 'gis');
  } catch (_) {
    /* không chặn nếu lưu meta lỗi */
  }
  return { ok: true };
}

// ============================================================================
// ensureAccessToken — trả access token còn hiệu lực; ném AuthExpired khi cần kết nối lại
// ============================================================================

// ensureAccessToken() → access token còn hạn (RAM) hoặc xin token mới im lặng qua GIS.
//   - Còn token trong RAM và chưa tới hạn (trừ đệm) ⇒ trả ngay.
//   - Ngược lại requestAccessToken({prompt:''}) — im lặng nếu phiên Google còn hiệu lực (YC10.3).
//   - Thất bại/cần tương tác ⇒ ném AuthExpired để UI hướng dẫn Kết_Nối_Google lại (YC10.4).
async function ensureAccessToken() {
  assertSecureContext();
  if (_accessToken && Date.now() < _accessTokenExpiry - TOKEN_SKEW_MS) {
    return _accessToken;
  }
  try {
    return await requestToken('');
  } catch (err) {
    throw err instanceof AuthExpired ? err : new AuthExpired('Không lấy được access token (GIS).', err);
  }
}

// ============================================================================
// Google Picker — pickDataFolder / resolveDataFolder
// ============================================================================

// Nạp api.js + module 'picker' (singleton). Cần <script src="…/api.js"> hoặc tự chèn.
function loadPickerApi() {
  if (_pickerApiReady) return _pickerApiReady;
  _pickerApiReady = new Promise((resolve, reject) => {
    const g = getGlobal();
    if (!g || !g.document) {
      reject(new Error('Google Picker chỉ khả dụng trong trình duyệt.'));
      return;
    }

    const onGapiReady = () => {
      if (!g.gapi || typeof g.gapi.load !== 'function') {
        reject(new Error('Không nạp được gapi.'));
        return;
      }
      g.gapi.load('picker', {
        callback: () => {
          if (g.google && g.google.picker) resolve(g.google.picker);
          else reject(new Error('Không nạp được module Google Picker.'));
        },
        onerror: () => reject(new Error('Lỗi khi nạp module Google Picker.')),
      });
    };

    // Nếu gapi đã có sẵn (script đã nhúng trong index.html), dùng luôn.
    if (g.gapi && typeof g.gapi.load === 'function') {
      onGapiReady();
      return;
    }

    // Ngược lại chèn script động.
    const existing = g.document.querySelector(`script[src="${GAPI_SCRIPT_SRC}"]`);
    const script = existing || g.document.createElement('script');
    script.src = GAPI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onGapiReady, { once: true });
    script.addEventListener('error', () => reject(new Error(`Không tải được ${GAPI_SCRIPT_SRC}`)), {
      once: true,
    });
    if (!existing) g.document.body.appendChild(script);
  }).catch((err) => {
    _pickerApiReady = null; // cho phép thử lại lần sau
    throw err;
  });
  return _pickerApiReady;
}

// pickDataFolder() → mở Google Picker (chỉ thư mục) cho người dùng chọn _coach_data
// MỘT LẦN; lưu folderId vào meta. Trả folderId, hoặc null nếu người dùng huỷ.
// (Quyết định đã chốt: drive.file + Picker; YC11.2 phạm vi tối thiểu.)
async function pickDataFolder() {
  assertSecureContext();
  const cfg = requireConfig();
  const token = await ensureAccessToken();
  const picker = await loadPickerApi();
  const g = getGlobal();
  const store = getStore();

  return new Promise((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const builder = new picker.PickerBuilder()
        .setOAuthToken(token)
        .addView(view)
        .setTitle('Chọn thư mục _coach_data')
        .setCallback(async (data) => {
          const action = data && data[picker.Response.ACTION];
          if (action === picker.Action.PICKED) {
            const docs = data[picker.Response.DOCUMENTS] || [];
            const folderId = docs[0] && docs[0][picker.Document.ID];
            if (!folderId) {
              reject(new Error('Picker không trả về folderId.'));
              return;
            }
            try {
              await store.setMeta(META_FOLDER_ID, folderId);
              resolve(folderId);
            } catch (err) {
              reject(err);
            }
          } else if (action === picker.Action.CANCEL) {
            resolve(null);
          }
        });

      if (cfg.apiKey) builder.setDeveloperKey(cfg.apiKey);
      if (cfg.appId) builder.setAppId(cfg.appId);
      if (g && g.location && g.location.origin) builder.setOrigin(g.location.origin);

      builder.build().setVisible(true);
    } catch (err) {
      reject(err);
    }
  });
}

// resolveDataFolder() → folderId đã lưu (YC: định vị theo folderId đã lưu),
// hoặc kích hoạt pickDataFolder() nếu chưa có. Ném nếu người dùng huỷ chọn.
// Hàm này phơi ra cho task 7.2 (readJson/writeJson) dùng.
async function resolveDataFolder() {
  const store = getStore();
  const saved = await store.getMeta(META_FOLDER_ID);
  if (saved) return saved;
  const picked = await pickDataFolder();
  if (!picked) {
    throw new Error('Chưa chọn thư mục _coach_data — cần chọn để tiếp tục.');
  }
  return picked;
}

// ============================================================================
// TASK 7.2 — Đọc/ghi JSON có kiểm phiên bản (Drive API v3)
// ----------------------------------------------------------------------------
// Tham chiếu design.md:
//   > Components > pwa/drive-client.js:
//       readJson(name)  → { data, modifiedTime } | null
//       writeJson(name, obj, expectedModifiedTime?)
//         → ghi; nếu expectedModifiedTime lệch với Drive ⇒ trả Conflict kèm
//           bản Drive hiện tại (YC9.1).
//   > Sync & Conflict Flow: readJson(log) → modifiedTime; so với base; nếu lệch
//     ⇒ mergeLogs rồi writeJson(merged, expected=driveModifiedTime); lặp khi đổi tiếp.
//
// Ràng buộc: chỉ gọi endpoint Drive của Google qua HTTPS (YC11.1); dùng Bearer
// token từ ensureAccessToken(); 401 ⇒ ném AuthExpired (UI hướng dẫn kết nối lại).
// Phạm vi drive.file: chỉ thấy file/thư mục app tạo hoặc người dùng đã chọn qua
// Picker — thư mục _coach_data đã được chọn (task 7.1) nên các file con app tạo
// trong đó (gồm thư mục con `logs/`) đều truy cập được.
//
// XỬ LÝ TÊN LỒNG `logs/<clientId>__<date>.json`:
//   drive.file thao tác theo folderId (phẳng), không có đường dẫn chuỗi. Vì vậy
//   nếu `name` có tiền tố `logs/`, ta coi `logs` là MỘT thư mục con của _coach_data:
//   resolve (hoặc tạo nếu chưa có) thư mục `logs` rồi thao tác file theo phần tên
//   còn lại bên trong thư mục con đó. Tên không có dấu `/` ⇒ nằm thẳng trong
//   _coach_data. (Chỉ hỗ trợ một cấp `logs/`, đủ cho schema design.)
// ============================================================================

// Endpoint Drive API v3 (KHÔNG đổi). Chỉ www.googleapis.com (Google) qua HTTPS.
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Cache id thư mục con (vd `logs`) theo parentId để khỏi list lại mỗi lần.
const _subfolderCache = Object.create(null);

// Thoát nháy đơn trong giá trị literal của tham số truy vấn Drive `q`.
function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// driveFetch(url, init?) → fetch kèm Authorization: Bearer <token> hợp lệ.
// 401 ⇒ ném AuthExpired (token hết hạn/bị thu hồi giữa chừng) để UI nhắc kết nối lại.
// Các lỗi khác ⇒ ném Error kèm mã trạng thái + nội dung.
async function driveFetch(url, init) {
  assertSecureContext();
  const token = await ensureAccessToken();
  const opts = Object.assign({}, init);
  const headers = Object.assign({}, (init && init.headers) || {});
  headers.Authorization = `Bearer ${token}`;
  opts.headers = headers;

  const resp = await fetch(url, opts);
  if (resp.status === 401) {
    // Drive từ chối token đang dùng ⇒ coi như phiên hết hạn (YC10.4).
    const text = await safeText(resp);
    throw new AuthExpired(`Drive trả 401 (token hết hạn/bị thu hồi): ${text}`);
  }
  return resp;
}

// findFileByName(folderId, name) → { id, name, modifiedTime } của file (không phải
// thư mục) tên `name` nằm trực tiếp trong `folderId`, hoặc null nếu không có.
async function findFileByName(folderId, name) {
  const q = [
    `name = '${escapeDriveQueryValue(name)}'`,
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    `mimeType != '${FOLDER_MIME}'`,
    'trashed = false',
  ].join(' and ');

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '1',
    spaces: 'drive',
  });

  const resp = await driveFetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, { method: 'GET' });
  if (!resp.ok) {
    const text = await safeText(resp);
    throw new Error(`Drive files.list lỗi (${resp.status}): ${text}`);
  }
  const body = await resp.json();
  const files = (body && body.files) || [];
  return files.length ? files[0] : null;
}

// findFileByNameGlobal(name) → tìm file theo TÊN trên TOÀN Drive (không giới hạn thư mục),
// chọn bản sửa gần nhất. Dùng làm dự phòng khi file không nằm trong thư mục đã chọn
// (vd week-pack.json do máy tính ghi vào một _coach_data khác). Cần phạm vi drive.readonly.
async function findFileByNameGlobal(name) {
  const q = [
    `name = '${escapeDriveQueryValue(name)}'`,
    `mimeType != '${FOLDER_MIME}'`,
    'trashed = false',
  ].join(' and ');
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '5',
    spaces: 'drive',
  });
  const resp = await driveFetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, { method: 'GET' });
  if (!resp.ok) {
    // Không chặn luồng nếu tìm toàn cục lỗi — coi như không thấy.
    return null;
  }
  const body = await resp.json();
  const files = (body && body.files) || [];
  return files.length ? files[0] : null;
}
// tạo mới nếu chưa có. Có cache theo parentId để giảm số lần gọi.
async function ensureSubfolder(parentId, folderName) {
  const cacheKey = `${parentId}/${folderName}`;
  if (_subfolderCache[cacheKey]) return _subfolderCache[cacheKey];

  // Tìm thư mục con sẵn có.
  const q = [
    `name = '${escapeDriveQueryValue(folderName)}'`,
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ].join(' and ');
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    pageSize: '1',
    spaces: 'drive',
  });
  const listResp = await driveFetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, { method: 'GET' });
  if (!listResp.ok) {
    const text = await safeText(listResp);
    throw new Error(`Drive tìm thư mục con lỗi (${listResp.status}): ${text}`);
  }
  const listBody = await listResp.json();
  const existing = (listBody && listBody.files && listBody.files[0]) || null;
  if (existing && existing.id) {
    _subfolderCache[cacheKey] = existing.id;
    return existing.id;
  }

  // Chưa có ⇒ tạo thư mục con (metadata-only, không uploadType).
  const metadata = { name: folderName, mimeType: FOLDER_MIME, parents: [parentId] };
  const createResp = await driveFetch(`${DRIVE_FILES_ENDPOINT}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!createResp.ok) {
    const text = await safeText(createResp);
    throw new Error(`Drive tạo thư mục con '${folderName}' lỗi (${createResp.status}): ${text}`);
  }
  const created = await createResp.json();
  if (!created || !created.id) {
    throw new Error(`Drive tạo thư mục con '${folderName}' không trả id.`);
  }
  _subfolderCache[cacheKey] = created.id;
  return created.id;
}

// resolveTargetLocation(name) → { folderId, fileName }: ánh xạ `name` (có thể có
// tiền tố `logs/`) sang thư mục đích thực + tên file thuần. Tạo thư mục con `logs`
// khi cần. Ném nếu `name` rỗng hoặc dùng cấp lồng không hỗ trợ.
async function resolveTargetLocation(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('readJson/writeJson cần tên file (chuỗi) hợp lệ.');
  }
  const dataFolderId = await resolveDataFolder();

  const slash = name.indexOf('/');
  if (slash === -1) {
    return { folderId: dataFolderId, fileName: name };
  }

  const prefix = name.slice(0, slash);
  const rest = name.slice(slash + 1);
  if (prefix !== 'logs') {
    throw new Error(`Chỉ hỗ trợ thư mục con 'logs/'; nhận được tiền tố '${prefix}/'.`);
  }
  if (!rest || rest.indexOf('/') !== -1) {
    throw new Error(`Tên không hợp lệ trong logs/: '${rest}' (chỉ một cấp lồng).`);
  }
  const logsFolderId = await ensureSubfolder(dataFolderId, 'logs');
  return { folderId: logsFolderId, fileName: rest };
}

// fetchFileContent(fileId) → object JSON đã parse từ nội dung file (alt=media).
async function fetchFileContent(fileId) {
  const params = new URLSearchParams({ alt: 'media' });
  const resp = await driveFetch(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?${params.toString()}`, {
    method: 'GET',
  });
  if (!resp.ok) {
    const text = await safeText(resp);
    throw new Error(`Drive đọc nội dung file lỗi (${resp.status}): ${text}`);
  }
  const text = await resp.text();
  if (text === '') return null; // file rỗng ⇒ coi như chưa có nội dung.
  try {
    return JSON.parse(text);
  } catch (err) {
    const e = new Error('Nội dung file trên Drive không phải JSON hợp lệ.');
    e.cause = err;
    throw e;
  }
}

// readJson(name) → { data, modifiedTime } nếu file tồn tại; null nếu không.
//   - Định vị thư mục đích (xử lý tiền tố logs/), tìm file theo tên.
//   - Lấy modifiedTime từ metadata (files.list) và nội dung qua alt=media.
// (YC7.1 đọc dữ liệu khách; YC11.1 HTTPS.)
async function readJson(name) {
  const { folderId, fileName } = await resolveTargetLocation(name);
  let file = await findFileByName(folderId, fileName);
  // Dự phòng: nếu không thấy trong thư mục đã chọn, tìm theo tên trên toàn Drive
  // (cần drive.readonly) — xử lý trường hợp file do máy tính ghi vào _coach_data khác.
  if (!file) file = await findFileByNameGlobal(fileName);
  if (!file) return null;
  const data = await fetchFileContent(file.id);
  return { data, modifiedTime: file.modifiedTime };
}

// uploadNewFile(folderId, fileName, jsonText) → { ok, modifiedTime } sau khi tạo
// file mới bằng multipart (metadata + nội dung) với parent = folderId.
async function uploadNewFile(folderId, fileName, jsonText) {
  const boundary = `mwl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = { name: fileName, parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${jsonText}\r\n` +
    `--${boundary}--`;

  const resp = await driveFetch(`${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!resp.ok) {
    const text = await safeText(resp);
    throw new Error(`Drive tạo file lỗi (${resp.status}): ${text}`);
  }
  const created = await resp.json();
  return { ok: true, modifiedTime: created && created.modifiedTime };
}

// updateFileContent(fileId, jsonText) → { ok, modifiedTime } sau khi PATCH media.
async function updateFileContent(fileId, jsonText) {
  const resp = await driveFetch(
    `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(fileId)}?uploadType=media&fields=id,modifiedTime`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: jsonText,
    }
  );
  if (!resp.ok) {
    const text = await safeText(resp);
    throw new Error(`Drive cập nhật file lỗi (${resp.status}): ${text}`);
  }
  const updated = await resp.json();
  return { ok: true, modifiedTime: updated && updated.modifiedTime };
}

// writeJson(name, obj, expectedModifiedTime?) → ghi JSON cho `name`.
//   - File đã tồn tại + có expectedModifiedTime + lệch với modifiedTime hiện tại của
//     Drive ⇒ KHÔNG ghi đè; trả Conflict { conflict:true, drive:{ data, modifiedTime } }
//     để gọi viên (sync.js) gộp rồi ghi lại với expected mới (YC9.1).
//   - Ngược lại: cập nhật (PATCH media) nếu đã có, hoặc tạo mới (multipart) nếu chưa;
//     trả { ok:true, modifiedTime:<mới> }.
// (YC9.1 kiểm xung đột theo modifiedTime; YC11.1 HTTPS.)
async function writeJson(name, obj, expectedModifiedTime) {
  const { folderId, fileName } = await resolveTargetLocation(name);
  const jsonText = JSON.stringify(obj);
  const existing = await findFileByName(folderId, fileName);

  if (existing) {
    // Kiểm phiên bản: chỉ khi gọi viên cung cấp expectedModifiedTime.
    if (expectedModifiedTime != null && existing.modifiedTime !== expectedModifiedTime) {
      const driveData = await fetchFileContent(existing.id);
      return { conflict: true, drive: { data: driveData, modifiedTime: existing.modifiedTime } };
    }
    return updateFileContent(existing.id, jsonText);
  }

  // Chưa tồn tại ⇒ tạo mới (parent = thư mục đích).
  return uploadNewFile(folderId, fileName, jsonText);
}

// ============================================================================
// disconnect — thu hồi token + xoá dữ liệu khách
// ============================================================================

// disconnect() → thu hồi uỷ quyền ở endpoint revoke của Google, rồi clearClientData()
// (xoá refresh token + dữ liệu khách trong IndexedDB). YC10.7 / YC11.3.
async function disconnect() {
  const store = getStore();
  // Với GIS, meta refreshToken chỉ là sentinel 'gis' (không phải token thật) ⇒ thu hồi
  // access token thật đang giữ trong RAM nếu có.
  const tokenToRevoke = (_accessToken && _accessToken !== 'gis') ? _accessToken : null;

  if (tokenToRevoke) {
    try {
      await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(tokenToRevoke)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (_) {
      // Mạng lỗi khi thu hồi không nên chặn việc dọn cục bộ — vẫn xoá dữ liệu.
    }
  }

  // Xoá trạng thái RAM.
  _accessToken = null;
  _accessTokenExpiry = 0;
  clearPkceSession();

  // Xoá refresh token + dữ liệu khách (YC11.3). clearClientData cũng xoá refreshToken.
  await store.clearClientData();
  return { ok: true };
}

// ============================================================================
// Trợ giúp nhỏ
// ============================================================================

async function safeText(resp) {
  try {
    return await resp.text();
  } catch (_) {
    return '';
  }
}

function getSessionStorage() {
  const g = getGlobal();
  return (g && g.sessionStorage) || null;
}

function ssGet(key) {
  const ss = getSessionStorage();
  return ss ? ss.getItem(key) : null;
}

function ssSet(key, value) {
  const ss = getSessionStorage();
  if (ss) ss.setItem(key, value);
}

function clearPkceSession() {
  const ss = getSessionStorage();
  if (ss) {
    ss.removeItem(SS_VERIFIER);
    ss.removeItem(SS_STATE);
  }
}

// ============================================================================
// Phơi API
// ============================================================================

const api = {
  // cấu hình
  configureDrive,
  DRIVE_CONFIG,
  DRIVE_SCOPE,
  // OAuth / token
  connectGoogle,
  ensureAccessToken,
  disconnect,
  // thư mục dữ liệu
  pickDataFolder,
  resolveDataFolder,
  // đọc/ghi JSON có kiểm phiên bản (task 7.2)
  readJson,
  writeJson,
  findFileByName,
  ensureSubfolder,
  // lỗi định kiểu (cho phép `instanceof` / kiểm `.code`)
  AuthExpired,
  DriveConfigError,
};

// Phơi cho trình duyệt theo quy ước script thuần của PWA.
(function exposeGlobal() {
  const g = getGlobal();
  if (g) {
    g.MWLDrive = api;
  }
})();

// Guarded CommonJS export để nạp/kiểm cú pháp trong Node (các hàm I/O cần trình duyệt).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

})();
