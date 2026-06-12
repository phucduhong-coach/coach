'use strict';

// Feature: mobile-workout-logger — unit test cho helper thuần của UI ghi set (task 10.2)
//
// Kiểm các hàm thuần phơi trên MWLLoggerUI: applyStep (bước nhảy ±), stepFor (bước
// nhảy cấu hình được), normalizeFieldValue (chuẩn hoá giá trị trường), configureSteps.
// Đây là logic cốt lõi cho nút ± (YC3.3) và ghi Set_Thực_Tế (YC3.5), tách khỏi DOM
// nên test được trực tiếp trong Node (không cần trình duyệt).

const { test } = require('node:test');
const assert = require('node:assert');

const ui = require('../logger-ui');

// ---- applyStep -------------------------------------------------------------

test('applyStep: tăng/giảm từ giá trị số hiện có', () => {
  assert.strictEqual(ui._applyStep(10, 1, 1), 11);
  assert.strictEqual(ui._applyStep(10, 1, -1), 9);
  assert.strictEqual(ui._applyStep(40, 2.5, 1), 42.5);
  assert.strictEqual(ui._applyStep(42.5, 2.5, -1), 40);
});

test('applyStep: rỗng/không-phải-số coi như 0', () => {
  assert.strictEqual(ui._applyStep('', 2.5, 1), 2.5);
  assert.strictEqual(ui._applyStep(null, 1, 1), 1);
  assert.strictEqual(ui._applyStep('abc', 1, 1), 1);
  // Giảm từ 0 bị chặn không âm.
  assert.strictEqual(ui._applyStep('', 2.5, -1), 0);
});

test('applyStep: chặn không âm (≥0)', () => {
  assert.strictEqual(ui._applyStep(1, 2.5, -1), 0);
  assert.strictEqual(ui._applyStep(0, 1, -1), 0);
});

test('applyStep: làm tròn 3 chữ số tránh nhiễu dấu phẩy động', () => {
  // 0.1 + 0.2 = 0.30000000000000004 trong IEEE-754 ⇒ phải làm tròn về 0.3.
  assert.strictEqual(ui._applyStep(0.1, 0.2, 1), 0.3);
});

test('applyStep: tăng rồi giảm cùng bước trả lại giá trị ban đầu (≥0)', () => {
  for (const c of [0, 1, 2.5, 10, 42.5, 100]) {
    for (const s of [1, 2.5, 5]) {
      const roundTrip = ui._applyStep(ui._applyStep(c, s, 1), s, -1);
      assert.strictEqual(roundTrip, c, `round-trip thất bại tại c=${c}, s=${s}`);
    }
  }
});

// ---- stepFor / configureSteps ---------------------------------------------

test('stepFor: mặc định reps=1, weight=2.5', () => {
  assert.strictEqual(ui._stepFor('reps'), 1);
  assert.strictEqual(ui._stepFor('weight'), 2.5);
});

test('stepFor: opts.steps ghi đè mặc định (cấu hình được — YC3.3)', () => {
  assert.strictEqual(ui._stepFor('reps', { steps: { reps: 2 } }), 2);
  assert.strictEqual(ui._stepFor('weight', { steps: { weight: 5 } }), 5);
  // Giá trị không hợp lệ (≤0 hoặc NaN) ⇒ rơi về mặc định.
  assert.strictEqual(ui._stepFor('weight', { steps: { weight: 0 } }), 2.5);
  assert.strictEqual(ui._stepFor('reps', { steps: { reps: 'x' } }), 1);
});

test('configureSteps: đặt bước nhảy mặc định toàn cục, chỉ nhận số dương', () => {
  const before = ui.STEP_CONFIG.reps;
  ui.configureSteps({ reps: 3 });
  assert.strictEqual(ui._stepFor('reps'), 3);
  // Giá trị không hợp lệ bị bỏ qua.
  ui.configureSteps({ reps: -1 });
  assert.strictEqual(ui._stepFor('reps'), 3);
  // Khôi phục để không ảnh hưởng test khác.
  ui.configureSteps({ reps: before });
  assert.strictEqual(ui._stepFor('reps'), before);
});

// ---- normalizeFieldValue ---------------------------------------------------

test('normalizeFieldValue: cột số → Number khi hợp lệ, "" khi rỗng', () => {
  assert.strictEqual(ui._normalizeFieldValue('reps', '12'), 12);
  assert.strictEqual(ui._normalizeFieldValue('weight', '42.5'), 42.5);
  assert.strictEqual(ui._normalizeFieldValue('reps', ''), '');
  assert.strictEqual(ui._normalizeFieldValue('weight', null), '');
});

test('normalizeFieldValue: cột chữ (text/time/tempo) giữ nguyên chuỗi', () => {
  assert.strictEqual(ui._normalizeFieldValue('text', 'thấy khỏe'), 'thấy khỏe');
  assert.strictEqual(ui._normalizeFieldValue('time', '01:30'), '01:30');
  assert.strictEqual(ui._normalizeFieldValue('tempo', '3-1-1'), '3-1-1');
  assert.strictEqual(ui._normalizeFieldValue('text', ''), '');
});

test('normalizeFieldValue: cột số với chuỗi không-phải-số giữ nguyên (không ép)', () => {
  assert.strictEqual(ui._normalizeFieldValue('reps', 'nhiều'), 'nhiều');
});
