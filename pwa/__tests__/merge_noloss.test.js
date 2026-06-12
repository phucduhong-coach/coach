'use strict';

// Feature: mobile-workout-logger, Property 2: Gộp không bao giờ mất set
//
// Validates: Requirements 9.3, 9.6
//
// mergeLogs(A, B) hợp nhất theo entryId rồi setId. Một set chỉ có ở một phía
// PHẢI được giữ (YC9.3), và không set nào của hai bên bị mất (YC9.6).
// Bất biến kiểm chứng: tập tất cả setId thu thập trên mọi entry của
// mergeLogs(A, B) đúng bằng HỢP của tập setId trong A và tập setId trong B.

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');
const { mergeLogs } = require('../merge');

// Pool nhỏ, có chủ đích để A và B vừa có entryId/setId trùng nhau (đường gộp
// thật sự) vừa có phần riêng (đường "một phía ⇒ giữ").
const ENTRY_IDS = ['e0', 'e1', 'e2', 'e3'];
const SET_IDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];

// Một "cặp gán" thô: setId này thuộc entryId nào, kèm nội dung set.
const pairArb = fc.record({
  entryId: fc.constantFrom(...ENTRY_IDS),
  setId: fc.constantFrom(...SET_IDS),
  set: fc.integer({ min: 1, max: 12 }),
  reps: fc.integer({ min: 1, max: 20 }),
  weight: fc.integer({ min: 0, max: 200 }),
  // Vài mốc thời gian khác nhau để chạm cả nhánh "mới hơn" lẫn "bằng nhau".
  loggedAt: fc
    .integer({ min: 1, max: 6 })
    .map((n) => `2024-01-0${n}T08:00:00.000Z`),
});

// Dựng một Nhật_Ký hợp lệ: setId duy nhất trong cùng một log (theo YC: setId
// ổn định/duy nhất), nhóm các set theo entryId thành mảng entries.
function buildLog(pairs) {
  const seenSetIds = new Set();
  const byEntry = new Map();
  for (const p of pairs) {
    if (seenSetIds.has(p.setId)) continue; // giữ setId duy nhất trong log
    seenSetIds.add(p.setId);
    if (!byEntry.has(p.entryId)) byEntry.set(p.entryId, []);
    byEntry.get(p.entryId).push({
      setId: p.setId,
      set: p.set,
      reps: p.reps,
      weight: p.weight,
      done: true,
      loggedAt: p.loggedAt,
    });
  }
  const entries = [];
  for (const [entryId, sets] of byEntry) {
    entries.push({ entryId, name: `Bài ${entryId}`, sets });
  }
  return {
    clientId: 'c1',
    rev: 1,
    updatedAt: '2024-01-01T00:00:00.000Z',
    entries,
  };
}

const logArb = fc.array(pairArb, { maxLength: 12 }).map(buildLog);

// Thu thập toàn bộ setId qua mọi entry của một log.
function collectSetIds(log) {
  const ids = new Set();
  for (const entry of log.entries || []) {
    for (const s of entry.sets || []) ids.add(s.setId);
  }
  return ids;
}

test('Property 2: mergeLogs giữ đúng HỢP các setId của hai phía (không mất set)', () => {
  fc.assert(
    fc.property(logArb, logArb, (a, b) => {
      const merged = mergeLogs(a, b);

      const idsA = collectSetIds(a);
      const idsB = collectSetIds(b);
      const union = new Set([...idsA, ...idsB]);
      const mergedIds = collectSetIds(merged);

      // Mọi setId của A hoặc B phải còn trong kết quả (không mất set).
      for (const id of union) {
        assert.ok(
          mergedIds.has(id),
          `setId ${id} có trong A∪B nhưng bị mất sau khi gộp`
        );
      }
      // Không phát sinh setId lạ ngoài A∪B.
      for (const id of mergedIds) {
        assert.ok(
          union.has(id),
          `setId ${id} xuất hiện sau khi gộp nhưng không có trong A∪B`
        );
      }
      // Bằng nhau về kích thước ⇒ hai tập đúng bằng nhau.
      assert.strictEqual(mergedIds.size, union.size);
    }),
    { numRuns: 200 }
  );
});
