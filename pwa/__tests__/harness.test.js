'use strict';

// Feature: mobile-workout-logger — smoke test xac nhan harness `node --test`
// va fast-check (_fc.js) hoat dong trong pwa/. Cac test ham thuan se duoc
// them o cac task sau (logmodel, merge, computeBackoff...).

const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('./_fc');

test('node --test harness chay duoc trong pwa/', () => {
  assert.strictEqual(true, true);
});

test('fast-check nap duoc qua _fc.js', () => {
  assert.strictEqual(typeof fc.assert, 'function');
  assert.strictEqual(typeof fc.property, 'function');
});
