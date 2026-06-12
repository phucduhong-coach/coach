'use strict';

// (Bọc IIFE: cô lập khai báo top-level để không trùng tên giữa các <script> trong trình duyệt.)
(function () {
// Feature: mobile-workout-logger
// Pure (no I/O) exponential-backoff helper for the Bộ_Đồng_Bộ retry logic.
// Validates: Requirements 8.2 (exponential backoff with a configurable max wait).
//
// Exact rule (documented for Property 7 in design.md):
//
//   raw       = min(maxMs, baseMs * 2^attempts)     // clamped exponential growth
//   jitter    = raw * f,  where f ∈ [0, 1]          // NON-NEGATIVE, at most `raw`
//   result    = min(maxMs, max(0, raw + jitter))    // final clamp into [0, maxMs]
//
// Why this guarantees the two testable properties:
//
//   BOUNDS    0 <= result <= maxMs.
//             `raw` is already clamped to [0, maxMs]; jitter is non-negative so the
//             lower clamp (max(0, …)) only matters for degenerate inputs, and the
//             outer min(maxMs, …) guarantees we never exceed the ceiling regardless
//             of the jitter fraction.
//
//   NON-DECREASING (monotone in `attempts` before the ceiling)
//             Because growth is a *doubling*, the next step's raw value alone is at
//             least twice the current raw value:  raw_{n+1} = 2 * raw_n  (pre-ceiling).
//             Since jitter is capped at `raw` (f <= 1), the jittered value never
//             exceeds 2*raw_n:  raw_n*(1+f_n) <= 2*raw_n = raw_{n+1} <= raw_{n+1}*(1+f_{n+1}).
//             So the un-clamped sequence is non-decreasing for ANY f ∈ [0,1], and
//             clamping a non-decreasing sequence with the constant `maxMs` keeps it
//             non-decreasing. This holds even though the default jitter varies with
//             `attempts`, which is what makes the property test deterministic.
//
// Determinism seam (4th argument, optional):
//   - omitted        -> a deterministic pseudo-jitter derived from `attempts`
//                       (NOT Math.random), so results are reproducible.
//   - a number       -> used directly as the jitter fraction f (clamped to [0,1]).
//   - a function rng -> called as rng(attempts); its return value is used as f
//                       (clamped to [0,1]). Lets property tests pin f to 0 or 1
//                       to verify the bounds/monotonicity edges exactly.

/**
 * Deterministic pseudo-random fraction in [0, 1) derived purely from `n`.
 * No Math.random, so the backoff sequence is reproducible for tests.
 * @param {number} n attempt count (>= 0 integer)
 * @returns {number} fraction in [0, 1)
 */
function defaultJitterFraction(n) {
  const x = Math.sin(n + 1) * 10000;
  return x - Math.floor(x); // fractional part, always in [0, 1)
}

/**
 * Compute the next backoff delay in milliseconds.
 *
 * @param {number} attempts Number of failed attempts so far (>= 0). Non-finite or
 *   negative values are treated as 0; fractional values are floored.
 * @param {number} baseMs Base delay in ms (>= 0).
 * @param {number} maxMs Maximum delay in ms (>= 0); the hard ceiling for the result.
 * @param {number|function} [jitter] Optional jitter seam: a fraction in [0,1], or a
 *   function (attempts) => fraction. When omitted, a deterministic fraction derived
 *   from `attempts` is used.
 * @returns {number} A delay in the inclusive range [0, maxMs].
 */
function computeBackoff(attempts, baseMs, maxMs, jitter) {
  // --- sanitize inputs (pure, defensive, no throw) ---
  const max = Math.max(0, Number(maxMs) || 0);
  const base = Math.max(0, Number(baseMs) || 0);

  let n = Number(attempts);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.floor(n);

  // --- raw = min(max, base * 2^n) without ever overflowing 2^n to Infinity ---
  // Once base * 2^k >= max the value is clamped to `max` anyway, so we cap the
  // exponent at the smallest k that reaches `max`. This guards huge `attempts`.
  let raw;
  if (base === 0 || max === 0) {
    raw = 0;
  } else {
    const ceilExp = Math.max(0, Math.ceil(Math.log2(max / base)));
    const exp = Math.min(n, ceilExp);
    raw = Math.min(max, base * Math.pow(2, exp));
  }

  // --- jitter fraction f in [0, 1] ---
  let f;
  if (typeof jitter === 'function') {
    f = Number(jitter(n));
  } else if (typeof jitter === 'number') {
    f = jitter;
  } else {
    f = defaultJitterFraction(n);
  }
  if (!Number.isFinite(f) || f < 0) f = 0;
  if (f > 1) f = 1;

  // jitter is a non-negative fraction of `raw` (at most `raw`), preserving monotonicity.
  const withJitter = raw + raw * f;

  // final clamp into [0, maxMs]
  return Math.min(max, Math.max(0, withJitter));
}

const api = { computeBackoff };

// Phơi cho trình duyệt (window/self) theo quy ước script thuần của PWA.
// sync.js mong đợi global MWLBackoff.computeBackoff khi chạy trong trình duyệt.
(function exposeGlobal() {
  const g =
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    (typeof globalThis !== 'undefined' && globalThis) ||
    null;
  if (g) {
    g.MWLBackoff = api;
  }
})();

// Guarded CommonJS export để giữ test Node hiện có chạy được.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

})();
