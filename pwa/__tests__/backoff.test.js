'use strict';

// Feature: mobile-workout-logger, Property 7: computeBackoff bị chặn và không giảm
//
// Validates: Requirements 8.2
//   8.2 — Bộ_Đồng_Bộ thử lại theo cấp số nhân (exponential backoff) với thời gian
//         chờ tối đa cấu hình được; thời gian chờ luôn nằm trong [0, maxMs] và
//         không giảm khi số lần thử tăng (đơn điệu theo `attempts`, kể cả khi đã
//         chạm trần thì giữ nguyên `maxMs`).
//
// Hàm thuần: computeBackoff(attempts, baseMs, maxMs, jitter?) trả về [0, maxMs].
//   - jitter là phân số trong [0,1] hoặc hàm (attempts)=>phân số.
//   - bỏ jitter ⇒ jitter mặc định tất định (suy từ attempts, KHÔNG Math.random).
//
// Chiến lược: sinh ngẫu nhiên baseMs, maxMs (>=0) và dải attempts (0..~60), rồi
// kiểm chứng (a) chặn trong [0, maxMs] và (b) không giảm theo attempts — với
// jitter mặc định, jitter=0 và jitter=1 (và các phân số cố định khác).

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');
const { computeBackoff } = require('../backoff');

const RUNS = 300;
const MAX_ATTEMPTS = 60;

// baseMs / maxMs không âm; gồm cả 0 để phủ trường hợp suy biến.
const nonNegArb = fc.integer({ min: 0, max: 1_000_000 });
// Một phân số jitter cố định bất kỳ trong [0,1] (để xác nhận đơn điệu cho mọi f).
const fractionArb = fc.double({ min: 0, max: 1, noNaN: true });

// Các "nguồn jitter" cần kiểm: mặc định (undefined), 0, 1, và phân số cố định.
function jitterCases(fixed) {
  return [
    undefined, // jitter mặc định tất định
    0, // cận dưới
    1, // cận trên
    fixed, // phân số cố định bất kỳ trong [0,1]
  ];
}

test('Property 7a: computeBackoff luôn nằm trong [0, maxMs] (mọi jitter)', () => {
  fc.assert(
    fc.property(
      nonNegArb, // baseMs
      nonNegArb, // maxMs
      fc.integer({ min: 0, max: MAX_ATTEMPTS }), // attempts n
      fractionArb, // phân số cố định
      (base, max, n, fixed) => {
        for (const jitter of jitterCases(fixed)) {
          const v = computeBackoff(n, base, max, jitter);
          assert.ok(
            Number.isFinite(v),
            `kết quả phải hữu hạn (n=${n}, base=${base}, max=${max}, jitter=${jitter})`
          );
          assert.ok(
            v >= 0,
            `kết quả phải >= 0 (got ${v}; n=${n}, base=${base}, max=${max}, jitter=${jitter})`
          );
          assert.ok(
            v <= max,
            `kết quả phải <= maxMs (got ${v} > ${max}; n=${n}, base=${base}, jitter=${jitter})`
          );
        }
      }
    ),
    { numRuns: RUNS }
  );
});

test('Property 7b: computeBackoff không giảm theo attempts (mọi jitter)', () => {
  fc.assert(
    fc.property(
      nonNegArb, // baseMs
      nonNegArb, // maxMs
      fractionArb, // phân số cố định
      (base, max, fixed) => {
        for (const jitter of jitterCases(fixed)) {
          let prev = computeBackoff(0, base, max, jitter);
          for (let n = 1; n <= MAX_ATTEMPTS; n++) {
            const cur = computeBackoff(n, base, max, jitter);
            assert.ok(
              cur >= prev,
              `phải không giảm: f(${n})=${cur} < f(${n - 1})=${prev} ` +
                `(base=${base}, max=${max}, jitter=${jitter})`
            );
            prev = cur;
          }
        }
      }
    ),
    { numRuns: RUNS }
  );
});

test('Property 7c: trường hợp suy biến maxMs=0 hoặc baseMs=0 ⇒ kết quả 0', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: MAX_ATTEMPTS }), // attempts n
      nonNegArb, // giá trị tự do (base khi max=0, hoặc max khi base=0)
      fractionArb,
      (n, other, fixed) => {
        for (const jitter of jitterCases(fixed)) {
          // maxMs = 0 ⇒ trần bằng 0 ⇒ kết quả 0.
          assert.strictEqual(computeBackoff(n, other, 0, jitter), 0);
          // baseMs = 0 ⇒ tăng trưởng bằng 0 ⇒ kết quả 0.
          assert.strictEqual(computeBackoff(n, 0, other, jitter), 0);
        }
      }
    ),
    { numRuns: RUNS }
  );
});
