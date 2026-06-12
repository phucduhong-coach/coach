'use strict';

// Feature: mobile-workout-logger, Property 8: Trường log đồng nhất Kê_Đơn
//
// Sinh patch ngẫu nhiên (gồm cả khóa lạ như `foo`, `bar` và thiếu khóa) rồi
// áp dụng upsertSet / addBlankSet. Khẳng định MỌI set thực tế chỉ chứa đúng
// nhóm khóa cho phép: 10 trường Kê_Đơn + {set, setId, done, loggedAt} —
// không rò rỉ khóa lạ, không thiếu khóa bắt buộc.
//
// Validates: Requirements 3.5

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');
const { SET_FIELD_KEYS, upsertSet, addBlankSet, seedLogFromPack } = require('../logmodel');

// Nhóm khóa cho phép = 10 trường Kê_Đơn + 4 trường meta của set thực tế.
const ALLOWED_KEYS = Object.freeze([
  ...SET_FIELD_KEYS,
  'set',
  'setId',
  'done',
  'loggedAt',
]);
const ALLOWED_SET = new Set(ALLOWED_KEYS);

// ---- Generators -----------------------------------------------------------

// Giá trị tùy ý cho một trường (số, chuỗi, bool, null).
const fieldValue = fc.oneof(
  fc.integer({ min: 0, max: 500 }),
  fc.float({ min: 0, max: 500, noNaN: true }),
  fc.string(),
  fc.boolean(),
  fc.constant(''),
  fc.constant(null),
);

// Khóa lạ (foreign keys) — KHÔNG được phép xuất hiện trong set kết quả.
const foreignKey = fc.constantFrom('foo', 'bar', 'baz', 'qux', 'name', '__proto__', 'sets', 'rev');

// Patch ngẫu nhiên: tập con bất kỳ của các trường hợp lệ + done + (đôi khi)
// set/setId + một số khóa lạ.
const patchArb = fc.record({
  // tập con ngẫu nhiên của 10 trường Kê_Đơn, mỗi trường có giá trị tùy ý
  fields: fc.dictionary(fc.constantFrom(...SET_FIELD_KEYS), fieldValue),
  // các khóa lạ kèm giá trị
  foreign: fc.dictionary(foreignKey, fieldValue),
  withDone: fc.boolean(),
  doneVal: fieldValue,
  withSet: fc.boolean(),
  setVal: fc.integer({ min: 1, max: 6 }),
}).map(({ fields, foreign, withDone, doneVal, withSet, setVal }) => {
  const patch = { ...fields, ...foreign };
  if (withDone) patch.done = doneVal;
  if (withSet) patch.set = setVal;
  return patch;
});

// Một thao tác: hoặc upsert (với patch) hoặc addBlank.
const opArb = fc.oneof(
  fc.record({ kind: fc.constant('upsert'), entryId: fc.constantFrom('e1', 'e2', 'e3'), patch: patchArb }),
  fc.record({ kind: fc.constant('addBlank'), entryId: fc.constantFrom('e1', 'e2', 'e3') }),
);

function seedLog() {
  return seedLogFromPack({
    sessionId: 'c1#2026-01-01',
    clientId: 'c1',
    date: '2026-01-01',
    items: [
      { itemId: 'e1', name: 'Squat' },
      { itemId: 'e2', name: 'Bench' },
      { itemId: 'e3', name: 'Row' },
    ],
  });
}

function checkSetKeys(log) {
  for (const entry of log.entries) {
    for (const s of entry.sets) {
      const keys = Object.keys(s);
      // 1) Không có khóa lạ
      for (const k of keys) {
        assert.ok(
          ALLOWED_SET.has(k),
          `Khóa lạ rò rỉ vào set: "${k}" (entry ${entry.entryId}), keys=${JSON.stringify(keys)}`,
        );
      }
      // 2) Không thiếu khóa bắt buộc — tập khóa PHẢI bằng đúng nhóm cho phép
      assert.strictEqual(
        keys.length,
        ALLOWED_KEYS.length,
        `Số khóa của set lệch: keys=${JSON.stringify(keys.sort())}`,
      );
      for (const req of ALLOWED_KEYS) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(s, req),
          `Thiếu khóa bắt buộc "${req}" trong set, keys=${JSON.stringify(keys)}`,
        );
      }
    }
  }
}

// ---- Property -------------------------------------------------------------

test('Property 8: mọi set thực tế có tập khóa đúng bằng nhóm Kê_Đơn + meta', () => {
  fc.assert(
    fc.property(fc.array(opArb, { minLength: 1, maxLength: 12 }), (ops) => {
      let now = 1;
      let log = seedLog();
      for (const op of ops) {
        now += 1;
        if (op.kind === 'upsert') {
          log = upsertSet(log, op.entryId, op.patch, now);
        } else {
          log = addBlankSet(log, op.entryId, now);
        }
      }
      checkSetKeys(log);
    }),
    { numRuns: 200 },
  );
});

test('Property 8: một upsert với toàn khóa lạ vẫn cho set đúng nhóm khóa', () => {
  fc.assert(
    fc.property(fc.dictionary(foreignKey, fieldValue), (foreign) => {
      const log = upsertSet(seedLog(), 'e1', { ...foreign }, 10);
      checkSetKeys(log);
    }),
    { numRuns: 100 },
  );
});
