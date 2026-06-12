'use strict';

// Feature: mobile-workout-logger, Property 3: Gộp chọn bản mới hơn
//
// Validates: Requirements 9.4, 9.5
//   9.4 — cùng một Set_Thực_Tế (cùng setId) khác giá trị giữa hai phiên bản ⇒
//         chọn phiên bản có dấu thời gian ghi (loggedAt) mới hơn.
//   9.5 — xung đột không tự gộp được (loggedAt bằng nhau + nội dung khác) ⇒
//         giữ cả hai (conflict:true + conflictWith) để xem lại.
//
// Strategy: sinh cặp Nhật_Ký cùng entryId + setId với loggedAt được kiểm soát,
// rồi gộp và kiểm chứng kết quả của set chia sẻ đó.

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');
const { mergeLogs } = require('../merge');

const RUNS = 200;
const ENTRY_ID = 'e1';
const SET_ID = 'e1:1';
const BASE_MS = Date.UTC(2026, 0, 1, 8, 0, 0); // mốc ISO ổn định để dựng loggedAt

function isoAt(offsetMs) {
  return new Date(BASE_MS + offsetMs).toISOString();
}

// Một Set_Thực_Tế "sạch" (không có khoá merge), đúng nhóm trường cho phép.
function makeSet(loggedAt, content) {
  return {
    set: 1,
    setId: SET_ID,
    done: true,
    loggedAt,
    reps: content.reps,
    weight: content.weight,
  };
}

function makeLog(set) {
  return {
    schemaVersion: 1,
    sessionId: 's1',
    entries: [{ entryId: ENTRY_ID, name: 'Bài tập', sets: [set] }],
    rev: 1,
    updatedAt: set.loggedAt,
  };
}

function findMergedSet(merged) {
  const entry = merged.entries.find((e) => e.entryId === ENTRY_ID);
  assert.ok(entry, 'phải có entry sau khi gộp');
  const set = entry.sets.find((s) => s.setId === SET_ID);
  assert.ok(set, 'phải có set chia sẻ sau khi gộp');
  return set;
}

// Bỏ khoá merge để so sánh "nội dung" của set.
function contentOf(set) {
  const out = {};
  for (const k of Object.keys(set)) {
    if (k === 'conflict' || k === 'conflictWith') continue;
    out[k] = set[k];
  }
  return out;
}

// Sinh nội dung số liệu hợp lệ cho một set.
const contentArb = fc.record({
  reps: fc.integer({ min: 0, max: 30 }),
  weight: fc.integer({ min: 0, max: 300 }),
});

test('Property 3a: loggedAt khác nhau ⇒ giữ nội dung phía mới hơn (YC9.4)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }), // offset cho phía A
      fc.integer({ min: 1, max: 1_000_000 }), // delta > 0 ⇒ loggedAt khác nhau
      fc.boolean(), // hoán đổi vai trò local/drive
      contentArb,
      contentArb,
      (offsetA, delta, swap, contentA, contentB) => {
        const loggedA = isoAt(offsetA);
        const loggedB = isoAt(offsetA + delta); // B luôn mới hơn A
        const setA = makeSet(loggedA, contentA);
        const setB = makeSet(loggedB, contentB);

        const localSet = swap ? setB : setA;
        const driveSet = swap ? setA : setB;

        const merged = mergeLogs(makeLog(localSet), makeLog(driveSet));
        const mergedSet = findMergedSet(merged);

        // Phía mới hơn (loggedAt lớn hơn) là setB bất kể local/drive.
        // Khác loggedAt ⇒ không có xung đột, nội dung khớp đúng phía mới hơn.
        assert.notStrictEqual(mergedSet.conflict, true);
        assert.deepStrictEqual(contentOf(mergedSet), contentOf(setB));
      }
    ),
    { numRuns: RUNS }
  );
});

test('Property 3b: loggedAt bằng nhau + nội dung khác ⇒ conflict:true (YC9.5)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.boolean(),
      contentArb,
      contentArb,
      (offset, swap, contentA, contentBraw) => {
        // Bảo đảm nội dung KHÁC nhau (ít nhất một trường lệch).
        fc.pre(
          contentA.reps !== contentBraw.reps ||
            contentA.weight !== contentBraw.weight
        );
        const logged = isoAt(offset); // cùng loggedAt
        const setA = makeSet(logged, contentA);
        const setB = makeSet(logged, contentBraw);

        const localSet = swap ? setB : setA;
        const driveSet = swap ? setA : setB;

        const merged = mergeLogs(makeLog(localSet), makeLog(driveSet));
        const mergedSet = findMergedSet(merged);

        assert.strictEqual(mergedSet.conflict, true);
        assert.ok(
          mergedSet.conflictWith && typeof mergedSet.conflictWith === 'object',
          'phải giữ phía còn lại trong conflictWith'
        );
      }
    ),
    { numRuns: RUNS }
  );
});

test('Property 3c: loggedAt bằng nhau + nội dung giống ⇒ không cờ conflict', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.boolean(),
      contentArb,
      (offset, swap, content) => {
        const logged = isoAt(offset);
        const setA = makeSet(logged, content);
        const setB = makeSet(logged, content); // nội dung y hệt

        const localSet = swap ? setB : setA;
        const driveSet = swap ? setA : setB;

        const merged = mergeLogs(makeLog(localSet), makeLog(driveSet));
        const mergedSet = findMergedSet(merged);

        assert.notStrictEqual(mergedSet.conflict, true);
        assert.strictEqual(mergedSet.conflictWith, undefined);
        assert.deepStrictEqual(contentOf(mergedSet), contentOf(setA));
      }
    ),
    { numRuns: RUNS }
  );
});
