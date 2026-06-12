'use strict';

// (Bọc IIFE: cô lập khai báo top-level để không trùng tên giữa các <script> trong trình duyệt.)
(function () {
// Feature: mobile-workout-logger
// pwa/logmodel.js — Hàm THUẦN dựng/sửa Nhật_Ký_Buổi_Tập (workout-log).
// Không DOM, không I/O, immutable (không biến đổi đầu vào).
// Tham chiếu: design.md > Data Models (workout-log) + Components > pwa/logmodel.js
// Requirements: 2.2, 3.4, 3.5, 3.7, 4.2, 4.3

// Nhóm trường số liệu — ĐỒNG NHẤT với nhóm trường của Kê_Đơn (YC3.5).
// Mọi Set_Thực_Tế chỉ chứa đúng nhóm này + {set, setId, done, loggedAt}.
const SET_FIELD_KEYS = Object.freeze([
  'reps',
  'weight',
  'one_rm',
  'rpe',
  'rir',
  'rest',
  'time',
  'distance',
  'tempo',
  'text',
]);

// ---- Helpers (thuần) -------------------------------------------------------

// Deep-clone an toàn cho dữ liệu JSON thuần (log là JSON-serializable).
function deepClone(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

// Số thứ tự (ordinal) kế tiếp cho một entry: max(set hiện có) + 1, tối thiểu 1.
function nextOrdinal(entry) {
  let max = 0;
  const sets = (entry && Array.isArray(entry.sets)) ? entry.sets : [];
  for (const s of sets) {
    const n = Number(s && s.set);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

// Tìm (hoặc tạo) entry theo entryId; trả về tham chiếu trong log đã clone.
function findOrCreateEntry(log, entryId, name) {
  if (!Array.isArray(log.entries)) log.entries = [];
  let entry = log.entries.find((e) => e && e.entryId === entryId);
  if (!entry) {
    entry = { entryId, name: name != null ? name : '', sets: [] };
    log.entries.push(entry);
  }
  if (!Array.isArray(entry.sets)) entry.sets = [];
  return entry;
}

// Dựng một Set_Thực_Tế "sạch": CHỈ chứa nhóm trường cho phép, không trường lạ.
// base: set hiện có (nếu cập nhật) | null; patch: thay đổi từ UI.
function buildSet(base, patch, setId, ordinal, now) {
  const out = {};
  for (const k of SET_FIELD_KEYS) {
    if (hasOwn(patch, k)) {
      out[k] = patch[k];
    } else if (hasOwn(base, k)) {
      out[k] = base[k];
    } else {
      out[k] = '';
    }
  }
  out.set = ordinal;
  out.setId = setId;
  if (hasOwn(patch, 'done')) {
    out.done = !!patch.done;
  } else if (hasOwn(base, 'done')) {
    out.done = !!base.done;
  } else {
    out.done = false;
  }
  out.loggedAt = now;
  return out;
}

// ---- API thuần -------------------------------------------------------------

// genSetId(entryId, ordinal) → id ổn định "<entryId>:<ordinal>".
function genSetId(entryId, ordinal) {
  return `${entryId}:${ordinal}`;
}

// seedLogFromPack(session) → Nhật_Ký rỗng (entries ánh xạ từ items, 0 set thực tế).
// Kê_Đơn chỉ là gợi ý UI, KHÔNG sao chép vào set thực tế.
function seedLogFromPack(session) {
  const s = session || {};
  const items = Array.isArray(s.items) ? s.items : [];
  const log = {
    schema: 'workout-log',
    version: 1,
    sessionId: s.sessionId != null ? s.sessionId : '',
    clientId: s.clientId != null ? s.clientId : '',
    planId: s.planId != null ? s.planId : '',
    workoutId: s.workoutId != null ? s.workoutId : '',
    date: s.date != null ? s.date : '',
    rev: 0,
    updatedAt: null,
    entries: items.map((item) => ({
      entryId: item && item.itemId != null ? item.itemId : '',
      name: item && item.name != null ? item.name : '',
      sets: [],
    })),
  };
  // deviceId là tùy chọn (cho gộp/chẩn đoán) — chỉ thêm khi session cung cấp.
  if (hasOwn(s, 'deviceId')) {
    log.deviceId = s.deviceId;
  }
  return log;
}

// upsertSet(log, entryId, setPatch, now) → log MỚI (immutable).
// Tạo hoặc cập nhật một set; gán setId ổn định/duy nhất; đặt loggedAt=now;
// áp dụng done theo patch; tăng rev; cập nhật updatedAt.
function upsertSet(log, entryId, setPatch, now) {
  const next = deepClone(log) || {};
  if (!Array.isArray(next.entries)) next.entries = [];
  const patch = setPatch || {};
  const entry = findOrCreateEntry(next, entryId, patch.name);

  // Xác định setId mục tiêu + ordinal.
  let targetSetId;
  let ordinal;
  let existing = null;

  if (hasOwn(patch, 'setId') && patch.setId != null && patch.setId !== '') {
    targetSetId = patch.setId;
    existing = entry.sets.find((s) => s && s.setId === targetSetId) || null;
    if (existing) {
      ordinal = existing.set;
    } else if (hasOwn(patch, 'set') && Number.isFinite(Number(patch.set))) {
      ordinal = Number(patch.set);
    } else {
      ordinal = nextOrdinal(entry);
    }
  } else if (hasOwn(patch, 'set') && Number.isFinite(Number(patch.set))) {
    ordinal = Number(patch.set);
    targetSetId = genSetId(entryId, ordinal);
    existing = entry.sets.find((s) => s && s.setId === targetSetId) || null;
  } else {
    ordinal = nextOrdinal(entry);
    targetSetId = genSetId(entryId, ordinal);
    existing = entry.sets.find((s) => s && s.setId === targetSetId) || null;
  }

  const newSet = buildSet(existing, patch, targetSetId, ordinal, now);

  const idx = entry.sets.findIndex((s) => s && s.setId === targetSetId);
  if (idx >= 0) {
    entry.sets[idx] = newSet; // cập nhật tại chỗ (idempotent theo setId)
  } else {
    entry.sets.push(newSet); // tạo mới
  }

  next.rev = (Number(next.rev) || 0) + 1; // tăng đơn điệu
  next.updatedAt = now;
  return next;
}

// addBlankSet(log, entryId, now) → log MỚI với một set thực tế trống được thêm
// (setId mới duy nhất). Dùng khi cần ghi nhiều set hơn số set Kê_Đơn (YC3.7).
function addBlankSet(log, entryId, now) {
  const next = deepClone(log) || {};
  if (!Array.isArray(next.entries)) next.entries = [];
  const entry = findOrCreateEntry(next, entryId);

  const ordinal = nextOrdinal(entry);
  const setId = genSetId(entryId, ordinal);
  const blank = buildSet(null, null, setId, ordinal, now);
  entry.sets.push(blank);

  next.rev = (Number(next.rev) || 0) + 1;
  next.updatedAt = now;
  return next;
}

const api = {
  SET_FIELD_KEYS,
  genSetId,
  seedLogFromPack,
  upsertSet,
  addBlankSet,
};

// Phơi cho trình duyệt (window/self) theo quy ước script thuần của PWA,
// để logger-ui.js (task 10) gọi được qua global. Giữ nguyên module.exports
// cho Node (`node --test`).
(function exposeGlobal() {
  const g =
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    (typeof globalThis !== 'undefined' && globalThis) ||
    null;
  if (g) {
    g.MWLLogModel = api;
  }
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

})();
