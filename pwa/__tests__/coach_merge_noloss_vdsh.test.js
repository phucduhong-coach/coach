'use strict';

// Feature: viewer-data-sync-hardening, Property 11: merge coach không mất bản ghi
//
// Validates: Requirements 4.3, 4.5
//
// Coach_Data được đồng bộ hai chiều qua Coach_Sync_Engine của pwa (tái dùng nguyên
// trạng mergeLogs). Property 11 yêu cầu: kết quả gộp chứa HỢP (union) của mọi
// `entryId` và, trong mỗi entry, hợp của mọi `setId` ở một trong hai phía — không
// bản ghi nào bị mất, KỂ CẢ qua nhiều vòng gộp liên tiếp.
//
// Khác với pwa/__tests__/merge_noloss.test.js (chỉ kiểm union setId, một vòng gộp),
// test này bổ sung:
//   (1) union theo entryId (không chỉ setId), và
//   (2) nhiều vòng gộp: mergeLogs(mergeLogs(A,B), C) giữ đủ A∪B∪C, và gộp lặp lại
//       chính nó (idempotent về tập id) không làm mất bản ghi.

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');
const { mergeLogs } = require('../merge');

// Pool nhỏ để A/B/C vừa trùng (đường gộp thật) vừa có phần riêng (đường "một phía ⇒ giữ").
const ENTRY_IDS = ['e0', 'e1', 'e2', 'e3', 'e4'];
const SET_IDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];

const pairArb = fc.record({
  entryId: fc.constantFrom(...ENTRY_IDS),
  setId: fc.constantFrom(...SET_IDS),
  set: fc.integer({ min: 1, max: 12 }),
  reps: fc.integer({ min: 1, max: 20 }),
  weight: fc.integer({ min: 0, max: 200 }),
  loggedAt: fc.integer({ min: 1, max: 9 }).map((n) => `2024-01-0${n}T08:00:00.000Z`),
});

// Dựng Nhật_Ký hợp lệ: setId duy nhất trong cùng một log, nhóm set theo entryId.
function buildLog(pairs) {
  const seenSetIds = new Set();
  const byEntry = new Map();
  for (const p of pairs) {
    if (seenSetIds.has(p.setId)) continue;
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
  return { clientId: 'c1', rev: 1, updatedAt: '2024-01-01T00:00:00.000Z', entries };
}

const logArb = fc.array(pairArb, { maxLength: 16 }).map(buildLog);

// Thu thập tập entryId của một log.
function collectEntryIds(log) {
  const ids = new Set();
  for (const entry of log.entries || []) {
    if (entry && entry.entryId != null) ids.add(entry.entryId);
  }
  return ids;
}

// Thu thập tập setId qua mọi entry của một log.
function collectSetIds(log) {
  const ids = new Set();
  for (const entry of log.entries || []) {
    for (const s of entry.sets || []) if (s && s.setId != null) ids.add(s.setId);
  }
  return ids;
}

function unionOf(sets) {
  const out = new Set();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

function assertSetsEqual(actual, expected, label) {
  for (const id of expected) {
    assert.ok(actual.has(id), `${label}: id ${id} có trong kỳ vọng nhưng bị mất sau gộp`);
  }
  for (const id of actual) {
    assert.ok(expected.has(id), `${label}: id ${id} xuất hiện sau gộp nhưng không có trong kỳ vọng`);
  }
  assert.strictEqual(actual.size, expected.size, `${label}: kích thước tập id phải bằng nhau`);
}

test('Property 11: mergeLogs giữ đúng HỢP entryId + setId (một vòng)', () => {
  fc.assert(
    fc.property(logArb, logArb, (a, b) => {
      const merged = mergeLogs(a, b);

      assertSetsEqual(
        collectEntryIds(merged),
        unionOf([collectEntryIds(a), collectEntryIds(b)]),
        'entryId A∪B'
      );
      assertSetsEqual(
        collectSetIds(merged),
        unionOf([collectSetIds(a), collectSetIds(b)]),
        'setId A∪B'
      );
    }),
    { numRuns: 100 }
  );
});

test('Property 11: nhiều vòng gộp mergeLogs(mergeLogs(A,B),C) không mất bản ghi', () => {
  fc.assert(
    fc.property(logArb, logArb, logArb, (a, b, c) => {
      const merged = mergeLogs(mergeLogs(a, b), c);

      const expectedEntries = unionOf([collectEntryIds(a), collectEntryIds(b), collectEntryIds(c)]);
      const expectedSets = unionOf([collectSetIds(a), collectSetIds(b), collectSetIds(c)]);

      assertSetsEqual(collectEntryIds(merged), expectedEntries, 'entryId A∪B∪C');
      assertSetsEqual(collectSetIds(merged), expectedSets, 'setId A∪B∪C');

      // Gộp lặp lại chính kết quả (mô phỏng vòng đọc-gộp-ghi lặp khi xung đột Drive)
      // KHÔNG được làm mất hay phát sinh id.
      const again = mergeLogs(merged, c);
      assertSetsEqual(collectEntryIds(again), expectedEntries, 'entryId sau gộp lặp');
      assertSetsEqual(collectSetIds(again), expectedSets, 'setId sau gộp lặp');
    }),
    { numRuns: 100 }
  );
});
