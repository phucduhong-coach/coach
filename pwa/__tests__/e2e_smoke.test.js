'use strict';

// Feature: mobile-workout-logger
// e2e_smoke.test.js — Kiểm thử tích hợp đầu-cuối CROSS-MODULE (không Drive/server I/O):
//   laptop buildWeekPack → PWA seedLogFromPack + upsertSet → laptop importLogs
//   + mergeActualIntoView. Xác nhận luồng dữ liệu khớp định danh và KHÔNG đụng
//   giáo án gốc (Property 9 / YC12.4) cũng như không sửa đầu vào.
// Task 16.1 (design.md > Testing Strategy; Requirements: 12.1, 12.4, 13.2, 13.4)

const { test } = require('node:test');
const assert = require('node:assert');

const coach = require('../../viewer/coach.js');
const { seedLogFromPack, upsertSet } = require('../logmodel.js');

function sampleInputs() {
  const plans = [
    {
      id: 'p1',
      name: 'Tăng cơ 8 tuần',
      weeks: 8,
      workouts: [
        {
          id: 'w1',
          name: 'Buổi đẩy',
          wk: 1,
          dow: 1, // thứ Hai
          items: [
            {
              type: 'exercise',
              name: 'Bench Press',
              target: 'Ngực',
              cols: { time: false, distance: false, tempo: false, text: false },
              prescription: [
                { set: 1, reps: 10, weight: 40, rest: 90 },
                { set: 2, reps: 10, weight: 40, rest: 90 },
              ],
            },
            { type: 'rest', duration: 60 }, // phải bị loại khỏi week-pack
          ],
        },
      ],
    },
  ];
  const clients = [
    { id: 'c1', name: 'Nguyễn Văn A', planIds: ['p1'], planStart: { p1: '2026-06-08' } },
  ];
  return { plans, clients };
}

test('e2e: buildWeekPack → seed/upsert (PWA) → importLogs → mergeActualIntoView', () => {
  const { plans, clients } = sampleInputs();
  const plansSnapshot = JSON.parse(JSON.stringify(plans));

  // 1) Laptop: dựng Gói_Lịch_Tuần cho tuần bắt đầu thứ Hai 2026-06-08.
  const pack = coach.buildWeekPack(clients, plans, '2026-06-08', { generatedAt: '2026-06-08T00:00:00Z' });
  assert.equal(pack.schema, 'week-pack');
  assert.equal(pack.sessions.length, 1, 'đúng một buổi trong tuần');

  const session = pack.sessions[0];
  assert.equal(session.sessionId, 'c1__2026-06-08');
  assert.equal(session.date, '2026-06-08');
  assert.equal(session.items.length, 1, 'rest day đã bị loại');
  assert.equal(session.items[0].itemId, 'w1#0');

  // 2) PWA: seed log rỗng từ session rồi ghi Set_Thực_Tế.
  let log = seedLogFromPack(session);
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].entryId, 'w1#0');
  assert.equal(log.entries[0].sets.length, 0, 'kê đơn chỉ là gợi ý, chưa có set thực tế');

  log = upsertSet(log, 'w1#0', { set: 1, reps: 10, weight: 42, done: true }, '2026-06-08T11:00:00Z');
  log = upsertSet(log, 'w1#0', { set: 2, reps: 9, weight: 42, done: true }, '2026-06-08T11:05:00Z');
  // thêm một set tay ngoài kê đơn
  log = upsertSet(log, 'w1#0', { set: 3, reps: 8, weight: 42, done: true }, '2026-06-08T11:10:00Z');
  assert.equal(log.entries[0].sets.length, 3);

  // 3) Laptop: nhập log → tra cứu theo sessionId.
  const lookup = coach.importLogs([log]);
  assert.ok(lookup['c1__2026-06-08'], 'có log theo đúng sessionId');

  // 4) Laptop: ghép thực tế cạnh kê đơn (không sửa workout gốc).
  const workout = plans[0].workouts[0];
  const view = coach.mergeActualIntoView(workout, lookup['c1__2026-06-08']);
  assert.equal(view.workoutId, 'w1');
  // mergeActualIntoView ánh xạ theo MỌI item của workout gốc (gồm cả khối rest),
  // nên view.items khớp số item của workout (2): [exercise, rest].
  assert.equal(view.items.length, 2);
  const item = view.items[0];
  assert.equal(item.hasLog, true);
  assert.equal(item.sets.length, 2, 'hai set kê đơn');
  assert.equal(item.sets[0].prescription.weight, 40, 'kê đơn giữ nguyên 40kg');
  assert.equal(item.sets[0].actual.weight, 42, 'thực tế 42kg ghép vào set 1');
  assert.equal(item.sets[1].actual.reps, 9, 'thực tế reps set 2');
  assert.equal(item.extraActualSets.length, 1, 'set thêm tay nằm ở extraActualSets');
  assert.equal(item.extraActualSets[0].reps, 8);

  // 5) Bất biến: KHÔNG sửa giáo án gốc (YC12.4 / Property 9).
  assert.deepEqual(plans, plansSnapshot, 'plans không bị biến đổi qua toàn luồng');
});

test('e2e: tiến bộ qua nhiều buổi (progressionSeries) tăng dần theo thời gian', () => {
  const series = coach.progressionSeries([
    { date: '2026-06-08', sets: [{ set: 1, weight: 40, reps: 10, loggedAt: '2026-06-08T11:00:00Z' }] },
    { date: '2026-06-15', sets: [{ set: 1, weight: 45, reps: 10, loggedAt: '2026-06-15T11:00:00Z' }] },
  ]);
  assert.ok(Array.isArray(series));
  assert.ok(series.length >= 2);
  // Sắp xếp tăng dần theo thời gian: điểm cuối không sớm hơn điểm đầu.
  assert.ok(String(series[0].at) <= String(series[series.length - 1].at));
});
