'use strict';

// Feature: mobile-workout-logger — TASK 11
// Kiểm thử hàm THUẦN của các tính năng nâng cao (không DOM/Drive):
//   rest-timer.parseRest, plate-calc.compute, history.bestSetOf/pickLatestPriorLog,
//   logmodel.setLogMeta.

const { test } = require('node:test');
const assert = require('node:assert');

const restTimer = require('../rest-timer.js');
const plate = require('../plate-calc.js');
const history = require('../history.js');
const logmodel = require('../logmodel.js');

test('parseRest: nhận diện nhiều định dạng thời gian nghỉ', () => {
  assert.equal(restTimer.parseRest('90'), 90);
  assert.equal(restTimer.parseRest(90), 90);
  assert.equal(restTimer.parseRest('1:30'), 90);
  assert.equal(restTimer.parseRest("1'"), 60);
  assert.equal(restTimer.parseRest("1'30"), 90);
  assert.equal(restTimer.parseRest('1m30s'), 90);
  assert.equal(restTimer.parseRest('2m'), 120);
  assert.equal(restTimer.parseRest('45s'), 45);
  assert.equal(restTimer.parseRest(''), null);
  assert.equal(restTimer.parseRest(null), null);
  assert.equal(restTimer.parseRest('abc'), null);
  assert.equal(restTimer.parseRest(0), null);
});

test('plate-calc.compute: xếp bánh tham lam mỗi bên + phần dư', () => {
  const r = plate.compute(100, 20); // (100-20)/2 = 40 mỗi bên
  assert.deepEqual(r.perSide, [{ plate: 25, count: 1 }, { plate: 15, count: 1 }]);
  assert.equal(r.leftover, 0);

  const r2 = plate.compute(60, 20); // 20 mỗi bên
  assert.deepEqual(r2.perSide, [{ plate: 20, count: 1 }]);

  const r3 = plate.compute(21, 20); // 0.5 mỗi bên — không bánh nào đủ
  assert.equal(r3.perSide.length, 0);
  assert.equal(r3.leftover, 0.5);

  const r4 = plate.compute(10, 20); // mục tiêu < đòn
  assert.equal(r4.perSide.length, 0);
});

test('plate-calc._format: chuỗi gọn dễ đọc', () => {
  const r = plate.compute(100, 20);
  assert.equal(plate._format(r), 'Mỗi bên: 1×25kg + 1×15kg');
});

test('history.bestSetOf: chọn set nặng nhất rồi nhiều reps nhất', () => {
  assert.deepEqual(history.bestSetOf([
    { weight: 30, reps: 12 },
    { weight: 40, reps: 6 },
    { weight: 40, reps: 8 },
  ]), { weight: 40, reps: 8 });
  assert.equal(history.bestSetOf([]), null);
  assert.equal(history.bestSetOf([{ weight: '', reps: '' }]), null);
  assert.deepEqual(history.bestSetOf([{ reps: 10 }]), { weight: null, reps: 10 });
});

test('history.pickLatestPriorLog: lấy buổi gần nhất TRƯỚC ngày đang ghi', () => {
  const files = [
    { name: 'c1__2026-06-10.json' },
    { name: 'c1__2026-06-14.json' },
    { name: 'c1__2026-06-16.json' }, // = ngày đang ghi ⇒ loại
    { name: 'c2__2026-06-15.json' }, // khác khách ⇒ loại
  ];
  const pick = history.pickLatestPriorLog(files, 'c1', '2026-06-16');
  assert.equal(pick.date, '2026-06-14');
  assert.equal(pick.name, 'c1__2026-06-14.json');

  // Không có buổi trước ⇒ null
  assert.equal(history.pickLatestPriorLog([{ name: 'c1__2026-06-20.json' }], 'c1', '2026-06-16'), null);
});

test('history.formatResult: định dạng "kg × reps"', () => {
  assert.equal(history.formatResult({ weight: 35, reps: 10 }), '35kg × 10');
  assert.equal(history.formatResult({ weight: 35, reps: null }), '35kg');
  assert.equal(history.formatResult({ weight: null, reps: 10 }), '× 10');
  assert.equal(history.formatResult(null), '');
});

test('logmodel.setLogMeta: ghi note/bodyweight immutably + tăng rev', () => {
  const log = { schema: 'workout-log', rev: 2, entries: [], note: '', bodyweight: '' };
  const next = logmodel.setLogMeta(log, { note: 'khách mệt', bodyweight: 64 }, '2026-06-16T10:00:00Z');
  assert.equal(next.note, 'khách mệt');
  assert.equal(next.bodyweight, 64);
  assert.equal(next.rev, 3);
  assert.equal(next.updatedAt, '2026-06-16T10:00:00Z');
  // đầu vào không bị sửa
  assert.equal(log.note, '');
  assert.equal(log.rev, 2);

  // không đổi gì ⇒ rev giữ nguyên
  const same = logmodel.setLogMeta(next, { note: 'khách mệt' }, '2026-06-16T11:00:00Z');
  assert.equal(same.rev, 3);

  // bỏ qua khoá lạ
  const ignore = logmodel.setLogMeta(next, { hacker: 'x' }, '2026-06-16T12:00:00Z');
  assert.equal(ignore.hacker, undefined);
});

test('logmodel.ensureEntry: thêm bài tự do nếu chưa có, immutable', () => {
  const log = { schema: 'workout-log', rev: 1, entries: [{ entryId: 'w1#0', name: 'A', sets: [] }] };
  const next = logmodel.ensureEntry(log, 'custom:1', 'Plank', '2026-06-16T10:00:00Z');
  assert.equal(next.entries.length, 2);
  const added = next.entries.find((e) => e.entryId === 'custom:1');
  assert.equal(added.name, 'Plank');
  assert.equal(added.custom, true);
  assert.equal(next.rev, 2);
  // đầu vào không đổi
  assert.equal(log.entries.length, 1);
  // gọi lại với cùng id ⇒ không thêm trùng, rev giữ nguyên
  const again = logmodel.ensureEntry(next, 'custom:1', 'Plank', '2026-06-16T11:00:00Z');
  assert.equal(again.entries.length, 2);
  assert.equal(again.rev, 2);
});

test('history.epley1RM: ước tính 1RM hợp lý', () => {
  assert.equal(history.epley1RM(100, 1), 100);
  assert.equal(history.epley1RM(100, 10), Math.round(100 * (1 + 10 / 30) * 10) / 10);
  assert.equal(history.epley1RM('', 5), null);
  assert.equal(history.epley1RM(0, 5), null);
});
