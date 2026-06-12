'use strict';

// Feature: mobile-workout-logger — integration test flushQueue (task 8.2)
//
// Kiểm thử tích hợp (integration-style) cho điều phối đồng bộ pwa/sync.js.
// KHÔNG đụng IndexedDB hay mạng thật: dùng mock-store (Map-backed) + mock
// drive-client có hành vi lập trình được theo từng test, tiêm qua
// setDependencies({ drive, store, merge, computeBackoff, now, notify }).
// merge dùng merge.js THẬT (require('../merge')) để gộp đúng như chạy thực.
// computeBackoff dùng backoff.js THẬT. now tiêm cố định để backoff tất định.
//
// Validates: Requirements 7.4 (xoá khỏi queue khi xong), 8.1 (giữ mục khi lỗi),
//            8.2 (backoff khi thất bại), 8.4 (quá maxAttempts → cần thủ công +
//            thông báo), 9.1/9.2 (kiểm phiên bản + gộp).

const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const sync = require('../sync');
const merge = require('../merge');
const { computeBackoff } = require('../backoff');

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// Thu thập toàn bộ setId qua mọi entry của một log (kiểm "không mất set").
function collectSetIds(log) {
  const ids = new Set();
  for (const entry of (log && log.entries) || []) {
    for (const s of entry.sets || []) ids.add(s.setId);
  }
  return ids;
}

// Dựng một Nhật_Ký tối giản hợp lệ.
function makeLog(sessionId, sets, extra) {
  return Object.assign(
    {
      sessionId,
      clientId: 'c1',
      rev: 1,
      updatedAt: '2024-01-01T00:00:00.000Z',
      entries: [{ entryId: 'e0', name: 'Bài e0', sets: sets || [] }],
    },
    extra || {}
  );
}

function makeSet(setId, loggedAt, patch) {
  return Object.assign(
    { setId, set: 1, reps: 10, weight: 50, done: true, loggedAt },
    patch || {}
  );
}

// ---------------------------------------------------------------------------
// Mock store (Map-backed) — khớp API store.js mà sync.js dùng
// ---------------------------------------------------------------------------

function makeMockStore() {
  const logs = new Map();
  const queue = new Map();
  const weekPack = new Map();
  const meta = new Map();

  return {
    _logs: logs,
    _queue: queue,

    async getLog(sessionId) {
      return logs.has(sessionId) ? clone(logs.get(sessionId)) : null;
    },
    async putLog(log) {
      if (!log || log.sessionId == null) throw new Error('putLog: thiếu sessionId');
      logs.set(log.sessionId, clone(log));
      return log;
    },

    async getWeekPack() {
      return weekPack.has('current') ? clone(weekPack.get('current')) : null;
    },
    async putWeekPack(pack) {
      weekPack.set('current', clone(pack));
      return pack;
    },

    async getMeta(key) {
      return meta.get(key);
    },
    async setMeta(key, value) {
      meta.set(key, value);
      return value;
    },

    async peekQueue() {
      return [...queue.values()].map(clone);
    },
    async dequeue(id) {
      queue.delete(id);
      return true;
    },
    async updateQueueItem(id, patch) {
      const current = queue.get(id);
      if (!current) return null;
      const updated = Object.assign({}, current, patch || {}, { id });
      queue.set(id, updated);
      return clone(updated);
    },
    async enqueue(item) {
      const record = Object.assign({ attempts: 0 }, item);
      queue.set(record.id, record);
      return clone(record);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock drive-client — readJson/writeJson lập trình được theo từng test
// ---------------------------------------------------------------------------

class MockAuthExpired extends Error {
  constructor(message) {
    super(message || 'auth expired');
    this.name = 'AuthExpired';
    this.code = 'AuthExpired';
  }
}

function makeMockDrive() {
  const files = new Map(); // name -> { data, modifiedTime }
  const readScript = []; // hàng đợi override cho readJson
  const writeScript = []; // hàng đợi override cho writeJson
  const calls = { readJson: [], writeJson: [] };
  let mtCounter = 1;

  return {
    AuthExpired: MockAuthExpired,
    _files: files,
    calls,

    // Cấy sẵn một file Drive với modifiedTime cho trước.
    seedFile(name, data, modifiedTime) {
      files.set(name, { data: clone(data), modifiedTime });
    },

    // Đẩy một hành vi readJson/writeJson cho lần gọi kế tiếp.
    onRead(fn) {
      readScript.push(fn);
    },
    onWrite(fn) {
      writeScript.push(fn);
    },

    async readJson(name) {
      calls.readJson.push(name);
      if (readScript.length) return readScript.shift()(name);
      return files.has(name) ? clone(files.get(name)) : null;
    },

    async writeJson(name, obj, expected) {
      calls.writeJson.push({ name, obj: clone(obj), expected });
      if (writeScript.length) return writeScript.shift()(name, obj, expected);
      // Mặc định: ghi thành công, sinh modifiedTime mới.
      const modifiedTime = `mt-${mtCounter++}`;
      files.set(name, { data: clone(obj), modifiedTime });
      return { ok: true, modifiedTime };
    },
  };
}

// Tiện ích cài đặt seam cho một test.
function setup({ store, drive, now, notify, config } = {}) {
  const s = store || makeMockStore();
  const d = drive || makeMockDrive();
  const events = [];
  sync.setDependencies({
    store: s,
    drive: d,
    merge,
    computeBackoff,
    now: now || (() => 1000),
    notify: notify || ((e) => events.push(e)),
  });
  if (config) sync.configureSync(config);
  return { store: s, drive: d, events };
}

afterEach(() => {
  // Khôi phục cấu hình mặc định và gỡ mọi tiêm phụ thuộc giữa các test.
  sync.configureSync({
    maxAttempts: 5,
    baseMs: 1000,
    maxMs: 5 * 60 * 1000,
    maxConflictLoops: 5,
  });
  sync.resetSync();
});

// ===========================================================================
// Scenario 1 — Ghi sạch: Drive trống → ghi thẳng, dequeue, gán base
// ===========================================================================

test('Scenario 1: ghi sạch (Drive trống) → writeJson, dequeue, log nhận baseDriveModifiedTime', async () => {
  const { store, drive } = setup();
  const sessionId = '2024-01-05_c1';
  await store.putLog(makeLog(sessionId, [makeSet('s1', '2024-01-05T08:00:00.000Z')]));
  await store.enqueue({ id: 'q1', sessionId, op: 'putLog' });

  const summary = await sync.flushQueue();

  // writeJson được gọi đúng 1 lần cho file logs/<sessionId>.json
  assert.strictEqual(drive.calls.writeJson.length, 1);
  assert.strictEqual(drive.calls.writeJson[0].name, `logs/${sessionId}.json`);
  // expected = undefined vì Drive chưa có file (ghi mới, không kiểm phiên bản)
  assert.strictEqual(drive.calls.writeJson[0].expected, undefined);

  // Mục đã rời hàng đợi (YC7.4)
  assert.strictEqual((await store.peekQueue()).length, 0);

  // Log cục bộ nhận baseDriveModifiedTime mới từ Drive
  const saved = await store.getLog(sessionId);
  assert.strictEqual(saved.baseDriveModifiedTime, 'mt-1');

  assert.ok(summary.flushed >= 1, 'summary.flushed phải >= 1');
  assert.strictEqual(summary.pending, 0);
  assert.strictEqual(summary.ok, true);
});

// ===========================================================================
// Scenario 2 — Xung đột → gộp → ghi: base != Drive modifiedTime
// ===========================================================================

test('Scenario 2: base != Drive modifiedTime → mergeLogs rồi ghi với expected=Drive modifiedTime, không mất set', async () => {
  const { store, drive } = setup();
  const sessionId = '2024-01-06_c1';
  const name = `logs/${sessionId}.json`;

  // Log cục bộ: set s_local, đã từng đồng bộ ở base 'mt-old'
  const localLog = makeLog(
    sessionId,
    [makeSet('s_local', '2024-01-06T08:00:00.000Z')],
    { baseDriveModifiedTime: 'mt-old' }
  );
  await store.putLog(localLog);
  await store.enqueue({ id: 'q1', sessionId, op: 'putLog' });

  // Drive đã đổi kể từ base: modifiedTime 'mt-new' khác base 'mt-old',
  // và chứa một set khác (s_drive) cùng entry e0.
  const driveLog = makeLog(sessionId, [makeSet('s_drive', '2024-01-06T09:00:00.000Z')]);
  drive.seedFile(name, driveLog, 'mt-new');

  const summary = await sync.flushQueue();

  // writeJson gọi với expected = modifiedTime của Drive (kiểm phiên bản YC9.2)
  assert.strictEqual(drive.calls.writeJson.length, 1);
  const written = drive.calls.writeJson[0];
  assert.strictEqual(written.expected, 'mt-new');

  // Bản ghi là kết quả gộp: giữ HỢP các set (không mất set nào)
  const writtenIds = collectSetIds(written.obj);
  assert.ok(writtenIds.has('s_local'), 'set cục bộ phải được giữ sau gộp');
  assert.ok(writtenIds.has('s_drive'), 'set của Drive phải được giữ sau gộp');
  assert.strictEqual(writtenIds.size, 2);

  // Thành công ⇒ dequeue + cập nhật base
  assert.strictEqual((await store.peekQueue()).length, 0);
  const saved = await store.getLog(sessionId);
  assert.strictEqual(saved.baseDriveModifiedTime, 'mt-1');
  assert.ok(summary.flushed >= 1);
});

// ===========================================================================
// Scenario 3 — Thất bại → backoff → thử lại (forced) thành công
// ===========================================================================

test('Scenario 3: writeJson lỗi mạng lần đầu → giữ mục + attempts++ + nextAttemptAt tương lai; forced flush sau đó thành công + dequeue', async () => {
  const T = 1000;
  const { store, drive } = setup({ now: () => T });
  const sessionId = '2024-01-07_c1';
  await store.putLog(makeLog(sessionId, [makeSet('s1', '2024-01-07T08:00:00.000Z')]));
  await store.enqueue({ id: 'q1', sessionId, op: 'putLog' });

  // Lần ghi đầu tiên ném lỗi mạng.
  drive.onWrite(() => {
    const e = new Error('network down');
    e.code = 'NETWORK';
    throw e;
  });

  const summary1 = await sync.flushQueue();

  // Mục vẫn còn trong hàng đợi (YC8.1), attempts tăng, nextAttemptAt ở tương lai.
  const afterFail = await store.peekQueue();
  assert.strictEqual(afterFail.length, 1);
  const item = afterFail[0];
  assert.strictEqual(item.attempts, 1);
  const expectedDelay = computeBackoff(1, 1000, 5 * 60 * 1000);
  assert.strictEqual(item.nextAttemptAt, T + expectedDelay);
  assert.ok(item.nextAttemptAt > T, 'nextAttemptAt phải ở tương lai');
  assert.ok(!item.needsManual, 'chưa quá maxAttempts nên không needsManual');
  assert.strictEqual(summary1.failed, 1);
  assert.strictEqual(summary1.ok, false);

  // Forced flush bỏ qua nextAttemptAt; lần ghi này dùng hành vi mặc định ⇒ thành công.
  const summary2 = await sync.manualSync();
  assert.strictEqual((await store.peekQueue()).length, 0);
  assert.ok(summary2.flushed >= 1);
  const saved = await store.getLog(sessionId);
  assert.ok(saved.baseDriveModifiedTime, 'sau khi gửi lại phải có baseDriveModifiedTime');
});

// ===========================================================================
// Scenario 4 — Quá maxAttempts → giữ + needsManual + notify('needsManual')
// ===========================================================================

test('Scenario 4: maxAttempts=1, lỗi lặp lại → vượt giới hạn ⇒ giữ mục needsManual:true + notify type needsManual', async () => {
  const { store, drive, events } = setup({ now: () => 1000, config: { maxAttempts: 1 } });
  const sessionId = '2024-01-08_c1';
  await store.putLog(makeLog(sessionId, [makeSet('s1', '2024-01-08T08:00:00.000Z')]));
  await store.enqueue({ id: 'q1', sessionId, op: 'putLog' });

  // writeJson luôn lỗi.
  drive.writeJson = async () => {
    const e = new Error('persistent failure');
    e.code = 'NETWORK';
    throw e;
  };

  // Lần 1: attempts 0→1, 1>1 sai ⇒ backoff (giữ, chưa needsManual).
  await sync.flushQueue({ force: true });
  let q = await store.peekQueue();
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].attempts, 1);
  assert.ok(!q[0].needsManual);

  // Lần 2 (force để bỏ qua nextAttemptAt): attempts 1→2, 2>1 đúng ⇒ needsManual.
  const summary = await sync.flushQueue({ force: true });

  q = await store.peekQueue();
  assert.strictEqual(q.length, 1, 'mục vẫn được GIỮ để thử thủ công (YC8.4)');
  assert.strictEqual(q[0].attempts, 2);
  assert.strictEqual(q[0].needsManual, true);
  assert.strictEqual(summary.manual, 1);

  const manualEvents = events.filter((e) => e && e.type === 'needsManual');
  assert.strictEqual(manualEvents.length, 1, 'phải thông báo needsManual đúng 1 lần');
  assert.strictEqual(manualEvents[0].sessionId, sessionId);
});

// ===========================================================================
// Scenario 5 (tuỳ chọn) — AuthExpired: surface, KHÔNG dequeue, attempts không đổi
// ===========================================================================

test('Scenario 5 (optional): readJson ném AuthExpired → flushQueue reject, mục KHÔNG bị dequeue, attempts không đổi', async () => {
  const { store, drive, events } = setup();
  const sessionId = '2024-01-09_c1';
  await store.putLog(makeLog(sessionId, [makeSet('s1', '2024-01-09T08:00:00.000Z')]));
  await store.enqueue({ id: 'q1', sessionId, op: 'putLog', attempts: 0 });

  drive.onRead(() => {
    throw new MockAuthExpired('token revoked');
  });

  await assert.rejects(() => sync.flushQueue(), (err) => err && err.code === 'AuthExpired');

  // Mục NOT dequeued, attempts không đổi (YC10.4 — không drop, không tăng attempts).
  const q = await store.peekQueue();
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].attempts, 0);
  assert.ok(!q[0].needsManual);
  // writeJson chưa hề được gọi vì lỗi xảy ra ở bước đọc.
  assert.strictEqual(drive.calls.writeJson.length, 0);

  const authEvents = events.filter((e) => e && e.type === 'authExpired');
  assert.strictEqual(authEvents.length, 1, 'phải thông báo authExpired');
});
