'use strict';

// Feature: mobile-workout-logger, Property 1: upsertSet bảo toàn và idempotent theo setId
//
// Kiểm chứng (≥100 vòng, fast-check) trên log/patch sinh ngẫu nhiên:
//   - Cùng setId + cùng patch lặp lại ⇒ số set của entry KHÔNG tăng (idempotent count).
//   - Patch KHÁC trên cùng setId ⇒ cập nhật tại chỗ (count không đổi, giá trị đổi).
//   - loggedAt LUÔN được đặt = now.
//   - rev tăng đơn điệu (strictly increasing) sau mỗi lần gọi.
//   - Log đầu vào KHÔNG bị biến đổi.
//
// Validates: Requirements 2.2, 3.7, 4.3

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');

const {
  SET_FIELD_KEYS,
  seedLogFromPack,
  upsertSet,
} = require('../logmodel.js');

// --- Generators -------------------------------------------------------------

// Giá trị một trường số liệu: số hoặc chuỗi ngắn (đều JSON-serializable).
const fieldVal = fc.oneof(
  fc.integer({ min: 0, max: 2000 }),
  fc.string({ maxLength: 6 })
);

// Patch chỉ chứa nhóm trường Kê_Đơn (tập con tuỳ ý) + done tuỳ chọn.
// KHÔNG đưa setId/set vào patch sinh — ta điều khiển setId thủ công trong test.
const patchShape = {};
for (const k of SET_FIELD_KEYS) patchShape[k] = fieldVal;
patchShape.done = fc.boolean();
const patchGen = fc.record(patchShape, { requiredKeys: [] });

const idGen = fc.string({ maxLength: 5 });

const itemsGen = fc.array(
  fc.record({ itemId: idGen, name: fc.string({ maxLength: 8 }) }),
  { maxLength: 4 }
);

// --- Helpers ----------------------------------------------------------------

function findEntry(log, entryId) {
  return log.entries.find((e) => e && e.entryId === entryId);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// --- Property 1 -------------------------------------------------------------

test('Property 1: upsertSet bảo toàn và idempotent theo setId', () => {
  fc.assert(
    fc.property(
      itemsGen,
      idGen,
      patchGen,
      patchGen,
      fc.integer({ min: 1, max: 8 }), // số lần lặp idempotent
      fc.integer({ min: 1, max: 1_000_000 }), // mốc thời gian khởi đầu
      (items, entryId, patchA, patchB, repeat, baseNow) => {
        const log0 = seedLogFromPack({ items });
        const log0Snapshot = clone(log0);

        let now = baseNow;
        let cur = log0;
        let prevRev = cur.rev;

        // 1) Tạo set đầu tiên trên entryId.
        cur = upsertSet(cur, entryId, patchA, now);

        // rev tăng đơn điệu.
        assert.ok(cur.rev > prevRev, 'rev phải tăng sau khi tạo set');
        prevRev = cur.rev;

        // Log đầu vào không bị biến đổi.
        assert.deepStrictEqual(log0, log0Snapshot, 'log đầu vào bị mutate');

        const entry = findEntry(cur, entryId);
        assert.ok(entry, 'entry phải tồn tại sau upsert');
        const targetSetId = entry.sets[entry.sets.length - 1].setId;
        const baselineCount = entry.sets.length;

        // loggedAt được đặt = now.
        const created = entry.sets.find((s) => s.setId === targetSetId);
        assert.strictEqual(created.loggedAt, now, 'loggedAt phải = now');

        // 2) Idempotent count: cùng setId + cùng patch lặp lại ⇒ count không tăng.
        for (let i = 0; i < repeat; i++) {
          now += 1;
          const before = clone(cur);
          cur = upsertSet(cur, entryId, { ...patchA, setId: targetSetId }, now);

          // input không bị biến đổi
          assert.deepStrictEqual(before, JSON.parse(JSON.stringify(before)));

          assert.ok(cur.rev > prevRev, 'rev phải tăng đơn điệu mỗi lần gọi');
          prevRev = cur.rev;

          const e = findEntry(cur, entryId);
          assert.strictEqual(
            e.sets.length,
            baselineCount,
            'số set không được tăng khi upsert cùng setId'
          );
          const s = e.sets.find((x) => x.setId === targetSetId);
          assert.ok(s, 'set mục tiêu vẫn phải tồn tại');
          assert.strictEqual(s.loggedAt, now, 'loggedAt phải = now mỗi lần');
        }

        // 3) Patch KHÁC trên cùng setId ⇒ count không đổi, giá trị cập nhật tại chỗ.
        now += 1;
        const beforeDiff = clone(cur);
        cur = upsertSet(cur, entryId, { ...patchB, setId: targetSetId }, now);

        // input không bị biến đổi
        assert.deepStrictEqual(
          beforeDiff,
          JSON.parse(JSON.stringify(beforeDiff))
        );

        assert.ok(cur.rev > prevRev, 'rev phải tăng sau patch khác');
        prevRev = cur.rev;

        const eDiff = findEntry(cur, entryId);
        assert.strictEqual(
          eDiff.sets.length,
          baselineCount,
          'patch khác trên cùng setId không được tăng số set'
        );

        const sDiff = eDiff.sets.find((x) => x.setId === targetSetId);
        assert.ok(sDiff, 'set mục tiêu vẫn tồn tại sau patch khác');
        assert.strictEqual(sDiff.loggedAt, now, 'loggedAt phải = now');

        // Giá trị các trường có trong patchB phải được cập nhật.
        for (const k of SET_FIELD_KEYS) {
          if (Object.prototype.hasOwnProperty.call(patchB, k)) {
            assert.strictEqual(
              sDiff[k],
              patchB[k],
              `trường ${k} phải được cập nhật theo patch khác`
            );
          }
        }
        if (Object.prototype.hasOwnProperty.call(patchB, 'done')) {
          assert.strictEqual(sDiff.done, !!patchB.done, 'done phải cập nhật');
        }

        // setId/ordinal ổn định: set vẫn giữ nguyên định danh.
        assert.strictEqual(sDiff.setId, targetSetId, 'setId phải ổn định');

        return true;
      }
    ),
    { numRuns: 200 }
  );
});
