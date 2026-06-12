'use strict';

// Feature: mobile-workout-logger, Property 4: Gộp giao hoán về nội dung
//
// mergeLogs phải giao hoán *về nội dung*: mergeLogs(A,B) và mergeLogs(B,A) cho
// ra cùng một tập hợp set (theo setId) với cùng giá trị từng set — kể cả cờ
// `conflict` và `conflictWith` — sau khi chuẩn hoá (bỏ qua `rev`, sắp xếp entries
// theo entryId và sets theo setId).
//
// Validates: Requirements 9.2

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');
const { mergeLogs } = require('../merge');

// --- Pools để bảo đảm có giao nhau giữa A và B (overlap entryId/setId) -------
const ENTRY_IDS = ['e1', 'e2', 'e3'];
const SET_IDS = ['s1', 's2', 's3', 's4'];
// loggedAt cố ý nhỏ để các trường hợp loggedAt bằng nhau (kể cả khác nội dung)
// xuất hiện thường xuyên — đây là nhánh sinh conflict cần kiểm.
const LOGGED_AT = [
  '2024-01-01T10:00:00.000Z',
  '2024-01-01T11:30:00.000Z',
  '2024-01-02T09:15:00.000Z',
];

// --- Generators --------------------------------------------------------------
const setArb = fc.record({
  setId: fc.constantFrom(...SET_IDS),
  set: fc.integer({ min: 1, max: 5 }),
  loggedAt: fc.constantFrom(...LOGGED_AT),
  reps: fc.integer({ min: 0, max: 12 }),
  weight: fc.integer({ min: 0, max: 100 }),
  done: fc.boolean(),
});

const entryArb = fc.record({
  entryId: fc.constantFrom(...ENTRY_IDS),
  sets: fc.array(setArb, { maxLength: 5 }),
});

const logArb = fc.record({
  entries: fc.array(entryArb, { maxLength: 4 }),
  rev: fc.integer({ min: 0, max: 10 }),
  updatedAt: fc.constantFrom(...LOGGED_AT),
});

// Giữ phần tử đầu tiên cho mỗi key — phản ánh dữ liệu hợp lệ (entryId duy nhất
// mỗi log, setId duy nhất mỗi entry) mà mergeLogs giả định.
function dedupeBy(arr, keyName) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = item[keyName];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// Chuẩn hoá log thành dạng so sánh được: chỉ giữ entries (bỏ qua `rev`,
// `updatedAt` và các trường top-level), sắp entries theo entryId và sets theo
// setId. assert.deepStrictEqual so sánh object không phụ thuộc thứ tự key, nên
// chỉ cần sắp các mảng.
function normalize(log) {
  const entries = (log.entries || []).map((e) => ({
    entryId: e.entryId,
    sets: (e.sets || [])
      .slice()
      .sort((a, b) => String(a.setId).localeCompare(String(b.setId))),
  }));
  entries.sort((a, b) => String(a.entryId).localeCompare(String(b.entryId)));
  return { entries };
}

// Dựng một cặp log hợp lệ (đã dedupe) từ generator thô.
function buildLog(raw) {
  const entries = dedupeBy(raw.entries, 'entryId').map((e) => ({
    entryId: e.entryId,
    sets: dedupeBy(e.sets, 'setId'),
  }));
  return { entries, rev: raw.rev, updatedAt: raw.updatedAt };
}

test('Property 4: mergeLogs giao hoán về nội dung (set membership + giá trị + conflict)', () => {
  fc.assert(
    fc.property(logArb, logArb, (rawA, rawB) => {
      const A = buildLog(rawA);
      const B = buildLog(rawB);

      const m1 = mergeLogs(A, B);
      const m2 = mergeLogs(B, A);

      assert.deepStrictEqual(normalize(m1), normalize(m2));
    }),
    { numRuns: 200 }
  );
});
