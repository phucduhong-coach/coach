'use strict';

// Feature: mobile-workout-logger
// pwa/logger-ui.js — UI ghi set cảm ứng.
//   TASK 10.1: render danh sách buổi theo ngày + gợi ý Kê_Đơn + ô nhập set.
//   TASK 10.2: THAO TÁC NHẬP TỐI ƯU CẢM ỨNG — wiring tương tác:
//     - Vùng chạm ≥ 44×44 cho ô nhập + nút (YC3.1) — qua app.css (--touch).
//     - inputmode số/decimal phù hợp loại dữ liệu (YC3.2).
//     - Nút ± tăng/giảm nhanh reps/weight với BƯỚC NHẢY CẤU HÌNH ĐƯỢC (YC3.3).
//     - Nút "xong" một chạm toggle hoàn thành set (YC3.4).
//     - Nút "+ set" thêm Set_Thực_Tế mới qua MWLLogModel.addBlankSet (YC3.7).
//     - Mọi sửa đổi: upsertSet/addBlankSet (immutable) → MWLStore.putLog (lưu cache
//       NGAY — YC2.2) → MWLStore.enqueue + kích MWLSync + phát 'mwl-sync' để badge
//       trạng thái đồng bộ cập nhật (YC7.5).
//
// Web/JS thuần, KHÔNG bước build, KHÔNG thư viện ngoài. Code DOM chỉ chạy trong
// trình duyệt (guard qua document); `node --check` + `node --test` vẫn xanh.
//
// Điểm vào global: window.MWLLoggerUI.renderSessions(weekPack, opts)
// Container DOM: id "mwl-sessions".
//
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 7.5 (+ 6.2, 3.6 từ 10.1)

(function () {
  function getGlobal() {
    return (
      (typeof self !== 'undefined' && self) ||
      (typeof window !== 'undefined' && window) ||
      (typeof globalThis !== 'undefined' && globalThis) ||
      null
    );
  }

  const g = getGlobal();

  // Container mặc định mà app-pwa.js / index.html (task 9.2) phơi ra.
  const CONTAINER_ID = 'mwl-sessions';

  // --- Định nghĩa cột hiển thị --------------------------------------------
  const PRIMARY_COLS = Object.freeze(['reps', 'weight']);
  const NUMERIC_EXTRA = Object.freeze(['one_rm', 'rpe', 'rir', 'rest']);
  const FLAG_COLS = Object.freeze(['time', 'distance', 'tempo', 'text']);

  const COL_LABELS = Object.freeze({
    reps: 'Reps',
    weight: 'Kg',
    one_rm: '%1RM',
    rpe: 'RPE',
    rir: 'RIR',
    rest: 'Nghỉ',
    time: 'Thời gian',
    distance: 'Quãng',
    tempo: 'Tempo',
    text: 'Ghi chú',
  });

  // Ô nhập kiểu chữ (text) vs số; số nguyên (numeric) vs thập phân (decimal) (YC3.2).
  const TEXT_COLS = new Set(['text', 'time', 'tempo']);
  const DECIMAL_COLS = new Set(['weight', 'one_rm', 'rpe', 'distance']);

  // Trường có nút ± tăng/giảm nhanh (YC3.3).
  const STEP_FIELDS = new Set(['reps', 'weight']);

  // Bước nhảy MẶC ĐỊNH — cấu hình được qua configureSteps() hoặc opts.steps (YC3.3).
  const DEFAULT_STEPS = Object.freeze({ reps: 1, weight: 2.5 });
  const STEP_CONFIG = Object.assign({}, DEFAULT_STEPS);

  // --- Helpers thuần -------------------------------------------------------

  function isFilled(v) {
    return v !== undefined && v !== null && v !== '';
  }

  // Phân tích số an toàn: '' / null / không-phải-số ⇒ null.
  function parseNumeric(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Chuẩn hoá giá trị trường trước khi ghi vào log:
  //   - Cột chữ (text/time/tempo): giữ nguyên chuỗi.
  //   - Cột số: rỗng ⇒ ''; số hợp lệ ⇒ Number; còn lại ⇒ giữ chuỗi.
  function normalizeFieldValue(field, value) {
    if (TEXT_COLS.has(field)) return value == null ? '' : value;
    if (value === '' || value == null) return '';
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }

  // Bước nhảy hiệu lực cho một trường: ưu tiên opts.steps[field], rồi STEP_CONFIG.
  function stepFor(field, opts) {
    if (opts && opts.steps && opts.steps[field] != null) {
      const n = Number(opts.steps[field]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const c = Number(STEP_CONFIG[field]);
    return Number.isFinite(c) && c > 0 ? c : 1;
  }

  // configureSteps(cfg) → đặt bước nhảy mặc định toàn cục (chỉ nhận số dương).
  function configureSteps(cfg) {
    if (cfg && typeof cfg === 'object') {
      for (const k of Object.keys(cfg)) {
        const n = Number(cfg[k]);
        if (Number.isFinite(n) && n > 0) STEP_CONFIG[k] = n;
      }
    }
    return Object.assign({}, STEP_CONFIG);
  }

  // applyStep(current, step, dir) → giá trị số mới sau khi ±step.
  //   - current rỗng/không-phải-số ⇒ coi như 0.
  //   - dir < 0 giảm, ngược lại tăng; chặn không âm (≥0).
  //   - làm tròn 3 chữ số thập phân để tránh nhiễu dấu phẩy động.
  function applyStep(current, step, dir) {
    const base = parseNumeric(current);
    const s = Number(step) || 0;
    const start = base == null ? 0 : base;
    let next = start + (Number(dir) < 0 ? -s : s);
    if (next < 0) next = 0;
    next = Math.round(next * 1000) / 1000;
    return next;
  }

  // So sánh giờ "HH:MM" (chuỗi rỗng xếp cuối).
  function compareTime(a, b) {
    const ta = a == null ? '' : String(a);
    const tb = b == null ? '' : String(b);
    if (ta === tb) return 0;
    if (ta === '') return 1;
    if (tb === '') return -1;
    return ta < tb ? -1 : 1;
  }

  // Gom buổi theo ngày → [{ date, sessions }], sắp ngày tăng dần, trong ngày theo `time`.
  function groupByDate(sessions) {
    const list = Array.isArray(sessions) ? sessions.slice() : [];
    const byDate = new Map();
    for (const s of list) {
      const date = s && s.date != null ? String(s.date) : '';
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(s);
    }
    const dates = Array.from(byDate.keys()).sort((a, b) => {
      if (a === b) return 0;
      if (a === '') return 1;
      if (b === '') return -1;
      return a < b ? -1 : 1;
    });
    return dates.map((date) => ({
      date,
      sessions: byDate
        .get(date)
        .slice()
        .sort((x, y) => compareTime(x && x.time, y && y.time)),
    }));
  }

  // Danh sách cột render cho một bài, dựa vào cờ `cols` + nội dung Kê_Đơn.
  function columnsForItem(item) {
    const presc = item && Array.isArray(item.prescription) ? item.prescription : [];
    const cols = (item && item.cols) || {};
    const anyFilled = (key) => presc.some((p) => p && isFilled(p[key]));

    const result = [];
    for (const key of PRIMARY_COLS) result.push(key);
    for (const key of NUMERIC_EXTRA) {
      if (anyFilled(key)) result.push(key);
    }
    for (const key of FLAG_COLS) {
      if (cols[key] === true || anyFilled(key)) result.push(key);
    }
    return result;
  }

  function findEntry(log, entryId) {
    if (!log || !Array.isArray(log.entries)) return null;
    return log.entries.find((e) => e && e.entryId === entryId) || null;
  }

  function findLoggedSet(entry, ordinal) {
    if (!entry || !Array.isArray(entry.sets)) return null;
    return entry.sets.find((s) => s && Number(s.set) === Number(ordinal)) || null;
  }

  // --- DOM builders (chỉ chạy khi có document) -----------------------------

  function doc() {
    return g && g.document ? g.document : null;
  }

  function h(tag, attrs, children) {
    const d = doc();
    const node = d.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      }
    }
    const kids = Array.isArray(children) ? children : children != null ? [children] : [];
    for (const c of kids) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? d.createTextNode(c) : c);
    }
    return node;
  }

  // Một ô nhập Set_Thực_Tế với inputmode phù hợp (YC3.2).
  function buildActualInput(sessionId, entryId, ordinal, field, value) {
    const isText = TEXT_COLS.has(field);
    const attrs = {
      class: 'mwl-set-input' + (isText ? ' is-text' : ''),
      'data-session-id': sessionId,
      'data-entry-id': entryId,
      'data-set': String(ordinal),
      'data-field': field,
      type: 'text',
      placeholder: '—',
    };
    if (isFilled(value)) attrs.value = String(value);
    // type=text + inputmode để hiện bàn phím số/decimal trên di động (YC3.2).
    if (!isText) {
      attrs.inputmode = DECIMAL_COLS.has(field) ? 'decimal' : 'numeric';
    }
    return h('input', attrs);
  }

  // Một nút bước nhảy ± (YC3.3).
  function buildStepBtn(sessionId, entryId, ordinal, field, dir, step) {
    return h('button', {
      type: 'button',
      class: 'mwl-step-btn ' + (dir < 0 ? 'mwl-step-dec' : 'mwl-step-inc'),
      'data-session-id': sessionId,
      'data-entry-id': entryId,
      'data-set': String(ordinal),
      'data-field': field,
      'data-dir': String(dir),
      'data-step': String(step),
      'aria-label': (dir < 0 ? 'Giảm ' : 'Tăng ') + (COL_LABELS[field] || field),
      text: dir < 0 ? '−' : '+',
    });
  }

  // Ô nhập có ± cho trường step (reps/weight); ô thường cho phần còn lại.
  function buildFieldControl(sessionId, entryId, ordinal, field, value, opts) {
    const input = buildActualInput(sessionId, entryId, ordinal, field, value);
    if (!STEP_FIELDS.has(field)) return input;
    const step = stepFor(field, opts);
    return h('div', { class: 'mwl-stepper' }, [
      buildStepBtn(sessionId, entryId, ordinal, field, -1, step),
      input,
      buildStepBtn(sessionId, entryId, ordinal, field, 1, step),
    ]);
  }

  // Một hàng set: gợi ý Kê_Đơn (mờ) + ô nhập/± thực tế cho từng cột (YC3.6, 3.3).
  function buildSetRow(session, item, columns, ordinal, prescriptionSet, loggedSet, opts) {
    const sessionId = session.sessionId;
    const entryId = item.itemId;
    const cells = [];

    cells.push(
      h('div', { class: 'mwl-set-ord' }, [h('span', { class: 'mwl-set-ord-num', text: 'Set ' + ordinal })])
    );

    for (const field of columns) {
      const presVal = prescriptionSet ? prescriptionSet[field] : '';
      const actualVal = loggedSet ? loggedSet[field] : '';
      const cellClass = 'mwl-cell' + (STEP_FIELDS.has(field) ? ' mwl-cell--step' : '');
      const cell = h('div', { class: cellClass, 'data-field': field }, [
        h('div', {
          class: 'mwl-presc-hint',
          title: isFilled(presVal) ? 'Kê đơn: ' + String(presVal) : 'Kê đơn',
          text: isFilled(presVal) ? String(presVal) : '·',
        }),
        buildFieldControl(sessionId, entryId, ordinal, field, actualVal, opts),
      ]);
      cells.push(cell);
    }

    // Nút "xong" một-chạm (YC3.4).
    const doneOn = !!(loggedSet && loggedSet.done);
    cells.push(
      h('div', { class: 'mwl-cell mwl-cell-done' }, [
        h('button', {
          type: 'button',
          class: 'mwl-done-btn' + (doneOn ? ' is-done' : ''),
          'data-session-id': sessionId,
          'data-entry-id': entryId,
          'data-set': String(ordinal),
          'aria-pressed': doneOn ? 'true' : 'false',
          title: 'Đánh dấu hoàn thành',
          text: doneOn ? '✓' : '○',
        }),
      ])
    );

    return h('div', { class: 'mwl-set-row' + (doneOn ? ' is-done' : '') }, cells);
  }

  function buildColumnHeader(columns) {
    const cells = [h('div', { class: 'mwl-set-ord', text: '' })];
    for (const field of columns) {
      const cls = 'mwl-cell mwl-col-head' + (STEP_FIELDS.has(field) ? ' mwl-cell--step' : '');
      cells.push(h('div', { class: cls, text: COL_LABELS[field] || field }));
    }
    cells.push(h('div', { class: 'mwl-cell mwl-cell-done', text: '' }));
    return h('div', { class: 'mwl-set-row mwl-col-headrow' }, cells);
  }

  // Render một bài tập (exercise item).
  function buildItem(session, item, log, opts) {
    const columns = columnsForItem(item);
    const entry = findEntry(log, item.itemId);
    const presc = Array.isArray(item.prescription) ? item.prescription : [];

    const rows = [buildColumnHeader(columns)];

    const loggedSets = entry && Array.isArray(entry.sets) ? entry.sets : [];
    const maxLogged = loggedSets.reduce((m, s) => Math.max(m, Number(s && s.set) || 0), 0);
    const total = Math.max(presc.length, maxLogged);

    for (let i = 1; i <= total; i++) {
      const prescriptionSet = presc.find((p) => Number(p && p.set) === i) || presc[i - 1] || null;
      const loggedSet = findLoggedSet(entry, i);
      rows.push(buildSetRow(session, item, columns, i, prescriptionSet, loggedSet, opts));
    }

    // Nút "+ set" (YC3.7).
    const addBtn = h('button', {
      type: 'button',
      class: 'mwl-addset-btn',
      'data-session-id': session.sessionId,
      'data-entry-id': item.itemId,
      text: '+ Thêm set',
    });

    return h('section', { class: 'mwl-item', 'data-entry-id': item.itemId }, [
      h('div', { class: 'mwl-item-head' }, [
        h('span', { class: 'mwl-item-name', text: item.name != null ? item.name : '' }),
        isFilled(item.target) ? h('span', { class: 'mwl-item-target', text: String(item.target) }) : null,
      ]),
      h('div', { class: 'mwl-sets' }, rows),
      h('div', { class: 'mwl-item-foot' }, [addBtn]),
    ]);
  }

  // Render một buổi (session card).
  function buildSession(session, log, opts) {
    const items = Array.isArray(session.items) ? session.items : [];
    const meta = [];
    if (isFilled(session.time)) meta.push(h('span', { class: 'mwl-session-time', text: String(session.time) }));
    if (isFilled(session.planName)) meta.push(h('span', { class: 'mwl-session-plan', text: String(session.planName) }));

    const head = h('header', { class: 'mwl-session-head' }, [
      h('div', { class: 'mwl-session-titles' }, [
        h('h3', {
          class: 'mwl-session-client',
          text: isFilled(session.workoutName) ? String(session.workoutName) : 'Buổi tập',
        }),
        h('div', {
          class: 'mwl-session-workout',
          text: session.clientName != null ? String(session.clientName) : '',
        }),
      ]),
      h('div', { class: 'mwl-session-meta' }, meta),
    ]);

    const body =
      items.length > 0
        ? h('div', { class: 'mwl-session-items' }, items.map((it) => buildItem(session, it, log, opts)))
        : h('p', { class: 'mwl-empty-hint', text: 'Buổi này chưa có bài tập.' });

    return h('article', { class: 'mwl-session', 'data-session-id': session.sessionId }, [head, body]);
  }

  // ========================================================================
  // CONTEXT TƯƠNG TÁC (TASK 10.2)
  // ------------------------------------------------------------------------
  // _ctx giữ trạng thái render hiện tại để các handler (±/done/+set/nhập) đọc
  // weekPack, log đang ghi (theo sessionId), container và phụ thuộc đã phân giải.
  // ========================================================================

  let _ctx = null;

  function resolveDeps(opts) {
    return {
      store: (opts && opts.store) || (g && g.MWLStore) || null,
      logModel: (opts && opts.logModel) || (g && g.MWLLogModel) || null,
      sync: (opts && opts.sync) || (g && g.MWLSync) || null,
    };
  }

  function nowIso() {
    if (_ctx && _ctx.opts && typeof _ctx.opts.now === 'function') return _ctx.opts.now();
    return new Date().toISOString();
  }

  function getCtxLog(sessionId) {
    if (!_ctx) return null;
    if (_ctx.logs.has(sessionId)) return _ctx.logs.get(sessionId);
    // Chưa có trong context ⇒ seed từ session để có cấu trúc ghi vào.
    const session = findSession(sessionId);
    const model = _ctx.deps.logModel;
    if (session && model && typeof model.seedLogFromPack === 'function') {
      const seeded = model.seedLogFromPack(session);
      _ctx.logs.set(sessionId, seeded);
      return seeded;
    }
    return null;
  }

  function findSession(sessionId) {
    const wp = _ctx && _ctx.weekPack;
    const sessions = wp && Array.isArray(wp.sessions) ? wp.sessions : [];
    return sessions.find((s) => s && s.sessionId === sessionId) || null;
  }

  function findItem(session, entryId) {
    const items = session && Array.isArray(session.items) ? session.items : [];
    return items.find((it) => it && it.itemId === entryId) || null;
  }

  function reportErr(err) {
    if (g && g.console) g.console.warn('[logger-ui]', err);
  }

  // Phát sự kiện 'mwl-sync' để app-pwa làm mới badge trạng thái đồng bộ (YC7.5).
  function emitSyncEvent(detail) {
    try {
      if (g && typeof g.dispatchEvent === 'function' && typeof g.CustomEvent === 'function') {
        g.dispatchEvent(new g.CustomEvent('mwl-sync', { detail: detail || { type: 'enqueued' } }));
      }
    } catch (_) {
      /* best-effort */
    }
  }

  // Lưu cache NGAY (YC2.2) + đưa vào Hàng_Đợi_Đồng_Bộ + kích đồng bộ nền (YC7.2/7.5).
  async function persistAndQueue(log, sessionId) {
    const deps = _ctx ? _ctx.deps : resolveDeps(null);
    const store = deps.store;
    if (store && typeof store.putLog === 'function') {
      await store.putLog(log); // YC2.2 — ghi cục bộ tức thời
    }
    if (store && typeof store.enqueue === 'function') {
      // id ổn định theo sessionId ⇒ các sửa đổi liên tiếp gộp về một mục hàng đợi.
      await store.enqueue({ id: 'log:' + sessionId, sessionId, op: 'upsertLog' });
    }
    // Kích đồng bộ nền khi đang online; khi offline để listener 'online' lo sau (YC2.3).
    const sync = deps.sync;
    const online = !(g && g.navigator && typeof g.navigator.onLine === 'boolean') || g.navigator.onLine;
    if (sync && online && typeof sync.onOnline === 'function') {
      try {
        sync.onOnline();
      } catch (_) {
        /* không chặn ghi cục bộ */
      }
    }
    // Cập nhật badge trạng thái đồng bộ (YC7.5).
    emitSyncEvent({ type: 'enqueued', sessionId });
  }

  // commitPatch — áp một patch set qua upsertSet (immutable) rồi lưu + xếp hàng.
  async function commitPatch(sessionId, entryId, patch) {
    const model = _ctx && _ctx.deps.logModel;
    if (!model || typeof model.upsertSet !== 'function') return null;
    const log = getCtxLog(sessionId);
    const next = model.upsertSet(log, entryId, patch, nowIso());
    _ctx.logs.set(sessionId, next);
    await persistAndQueue(next, sessionId);
    return next;
  }

  // --- Handlers ------------------------------------------------------------

  async function onInputChange(input) {
    const sessionId = input.getAttribute('data-session-id');
    const entryId = input.getAttribute('data-entry-id');
    const ordinal = Number(input.getAttribute('data-set'));
    const field = input.getAttribute('data-field');
    const value = normalizeFieldValue(field, input.value);
    await commitPatch(sessionId, entryId, { set: ordinal, [field]: value });
  }

  async function onStep(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const entryId = btn.getAttribute('data-entry-id');
    const ordinal = Number(btn.getAttribute('data-set'));
    const field = btn.getAttribute('data-field');
    const dir = Number(btn.getAttribute('data-dir'));
    const step = Number(btn.getAttribute('data-step')) || stepFor(field, _ctx && _ctx.opts);

    const stepper = btn.parentNode;
    const input = stepper && stepper.querySelector ? stepper.querySelector('.mwl-set-input') : null;
    const current = input ? input.value : '';
    const nextVal = applyStep(current, step, dir);
    if (input) input.value = String(nextVal); // cập nhật DOM tại chỗ
    await commitPatch(sessionId, entryId, { set: ordinal, [field]: nextVal });
  }

  async function onDone(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const entryId = btn.getAttribute('data-entry-id');
    const ordinal = Number(btn.getAttribute('data-set'));

    const log = getCtxLog(sessionId);
    const existing = findLoggedSet(findEntry(log, entryId), ordinal);
    const newDone = !(existing && existing.done);

    await commitPatch(sessionId, entryId, { set: ordinal, done: newDone });

    // Cập nhật DOM tại chỗ (YC3.4 — phản hồi tức thì một-chạm).
    btn.classList.toggle('is-done', newDone);
    btn.textContent = newDone ? '✓' : '○';
    btn.setAttribute('aria-pressed', newDone ? 'true' : 'false');
    const row = btn.closest ? btn.closest('.mwl-set-row') : null;
    if (row) row.classList.toggle('is-done', newDone);
  }

  async function onAddSet(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const entryId = btn.getAttribute('data-entry-id');

    const model = _ctx && _ctx.deps.logModel;
    if (!model || typeof model.addBlankSet !== 'function') return;
    const log = getCtxLog(sessionId);
    const next = model.addBlankSet(log, entryId, nowIso());
    _ctx.logs.set(sessionId, next);
    await persistAndQueue(next, sessionId);

    rerenderItem(sessionId, entryId); // vẽ lại bài để hiện set mới
  }

  // Vẽ lại một bài tập tại chỗ (sau khi +set hoặc thay đổi cấu trúc).
  function rerenderItem(sessionId, entryId) {
    if (!_ctx || !_ctx.container) return;
    const oldNode = findItemNode(sessionId, entryId);
    if (!oldNode || !oldNode.parentNode) return;
    const session = findSession(sessionId);
    const item = session ? findItem(session, entryId) : null;
    if (!session || !item) return;
    const log = getCtxLog(sessionId);
    const fresh = buildItem(session, item, log, _ctx.opts);
    oldNode.parentNode.replaceChild(fresh, oldNode);
  }

  // Tìm node bài tập theo (sessionId, entryId) — duyệt thủ công để né escaping selector.
  function findItemNode(sessionId, entryId) {
    const container = _ctx.container;
    const sessions = container.getElementsByClassName
      ? Array.prototype.slice.call(container.getElementsByClassName('mwl-session'))
      : [];
    for (const sn of sessions) {
      if (sn.getAttribute('data-session-id') !== sessionId) continue;
      const items = Array.prototype.slice.call(sn.getElementsByClassName('mwl-item'));
      for (const it of items) {
        if (it.getAttribute('data-entry-id') === entryId) return it;
      }
    }
    return null;
  }

  // --- Event delegation ----------------------------------------------------

  function onContainerClick(ev) {
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    // Chip điều hướng: chọn Khách / Ngày / Buổi.
    const chipEl = t.closest('.mwl-chip');
    if (chipEl) {
      ev.preventDefault();
      onNav(chipEl);
      return;
    }
    // Nút Lưu & đồng bộ.
    const saveBtn = t.closest('.mwl-save-btn');
    if (saveBtn) {
      ev.preventDefault();
      onSave().catch(reportErr);
      return;
    }
    const stepBtn = t.closest('.mwl-step-btn');
    if (stepBtn) {
      ev.preventDefault();
      onStep(stepBtn).catch(reportErr);
      return;
    }
    const doneBtn = t.closest('.mwl-done-btn');
    if (doneBtn) {
      ev.preventDefault();
      onDone(doneBtn).catch(reportErr);
      return;
    }
    const addBtn = t.closest('.mwl-addset-btn');
    if (addBtn) {
      ev.preventDefault();
      onAddSet(addBtn).catch(reportErr);
    }
  }

  function onContainerChange(ev) {
    const t = ev.target;
    if (t && t.classList && t.classList.contains('mwl-set-input')) {
      onInputChange(t).catch(reportErr);
    }
  }

  // Gắn delegation MỘT LẦN cho container (idempotent qua cờ trên node).
  function wireContainer(container) {
    if (!container || container._mwlWired) return;
    container._mwlWired = true;
    container.addEventListener('click', onContainerClick);
    container.addEventListener('change', onContainerChange);
  }

  // --- Giải Nhật_Ký cho một buổi ------------------------------------------
  async function resolveLog(session, opts) {
    const sid = session && session.sessionId;
    if (opts && opts.logsBySession && Object.prototype.hasOwnProperty.call(opts.logsBySession, sid)) {
      return opts.logsBySession[sid];
    }
    try {
      const store = (opts && opts.store) || (g && g.MWLStore);
      if (store && typeof store.getLog === 'function' && sid != null && sid !== '') {
        const existing = await store.getLog(sid);
        if (existing) return existing;
      }
    } catch (_) {
      /* offline/không IndexedDB → seed */
    }
    try {
      const model = (opts && opts.logModel) || (g && g.MWLLogModel);
      if (model && typeof model.seedLogFromPack === 'function') {
        return model.seedLogFromPack(session);
      }
    } catch (_) {
      /* seed lỗi → null */
    }
    return null;
  }

  function resolveContainer(opts) {
    if (opts && opts.container && opts.container.appendChild) return opts.container;
    const d = doc();
    if (!d) return null;
    let c = d.getElementById(CONTAINER_ID);
    if (c) return c;
    const root = d.getElementById('app-root') || d.body;
    if (!root) return null;
    c = d.createElement('div');
    c.id = CONTAINER_ID;
    c.className = 'mwl-sessions';
    root.appendChild(c);
    return c;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ========================================================================
  // ĐIỀU HƯỚNG GỌN (TASK 11): chọn Khách → Ngày → Buổi rồi mới hiện chi tiết.
  // _nav giữ lựa chọn hiện tại; bền qua các lần render lại (chip bấm → re-render).
  // ========================================================================
  const _nav = { client: null, date: null, sessionId: null };

  function sessionsOf() {
    const wp = _ctx && _ctx.weekPack;
    return wp && Array.isArray(wp.sessions) ? wp.sessions : [];
  }

  function uniqueClients(sessions) {
    const seen = [];
    for (const s of sessions) {
      const name = s && s.clientName != null ? String(s.clientName) : '';
      if (!seen.includes(name)) seen.push(name);
    }
    return seen;
  }

  function datesForClient(sessions, client) {
    const seen = [];
    for (const s of sessions) {
      if (String((s && s.clientName) || '') !== client) continue;
      const d = s && s.date != null ? String(s.date) : '';
      if (!seen.includes(d)) seen.push(d);
    }
    seen.sort((a, b) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1));
    return seen;
  }

  function sessionsForClientDate(sessions, client, date) {
    return sessions
      .filter((s) => String((s && s.clientName) || '') === client && String((s && s.date) || '') === date)
      .sort((x, y) => compareTime(x && x.time, y && y.time));
  }

  // Nhãn ngày thân thiện: "T6" + "14/6".
  const WEEKDAYS_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  function formatDateLabel(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!m) return { main: date || 'Chưa đặt', sub: '' };
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    const wd = WEEKDAYS_VI[dt.getUTCDay()] || '';
    return { main: wd, sub: d + '/' + mo };
  }

  // Một chip điều hướng (2 dòng: chính + phụ).
  function chip(navType, key, mainText, subText, active) {
    const kids = [h('span', { class: 'mwl-chip-main', text: mainText })];
    if (isFilled(subText)) kids.push(h('span', { class: 'mwl-chip-sub', text: subText }));
    return h(
      'button',
      {
        type: 'button',
        class: 'mwl-chip' + (active ? ' is-active' : ''),
        'data-nav': navType,
        'data-key': key,
      },
      kids
    );
  }

  function chipRow(label, chips) {
    return h('div', { class: 'mwl-pickrow' }, [
      h('span', { class: 'mwl-pick-label', text: label }),
      h('div', { class: 'mwl-chips' }, chips),
    ]);
  }

  // Bấm chip → cập nhật lựa chọn (đổi khách reset ngày+buổi; đổi ngày reset buổi).
  function onNav(chipEl) {
    const type = chipEl.getAttribute('data-nav');
    const key = chipEl.getAttribute('data-key');
    if (type === 'client') {
      if (_nav.client !== key) {
        _nav.client = key;
        _nav.date = null;
        _nav.sessionId = null;
      }
    } else if (type === 'date') {
      if (_nav.date !== key) {
        _nav.date = key;
        _nav.sessionId = null;
      }
    } else if (type === 'session') {
      _nav.sessionId = key;
    }
    rerenderAll();
  }

  function rerenderAll() {
    if (!_ctx) return;
    renderSessions(_ctx.weekPack, _ctx.opts).catch(reportErr);
  }

  // --- Nút "Lưu & đồng bộ" -------------------------------------------------
  function setSaveState(state, summary) {
    if (!_ctx || !_ctx.container || !_ctx.container.querySelector) return;
    const el = _ctx.container.querySelector('.mwl-save-state');
    const btn = _ctx.container.querySelector('.mwl-save-btn');
    if (!el) return;
    let txt = '';
    let cls = 'mwl-save-state';
    if (state === 'saving') {
      txt = 'Đang lưu…';
      cls += ' is-saving';
    } else if (state === 'saved') {
      txt = 'Đã lưu ✓';
      cls += ' is-saved';
    } else if (state === 'pending') {
      const n = summary && summary.pending ? Number(summary.pending) : 0;
      txt = n > 0 ? 'Còn ' + n + ' chờ đồng bộ' : 'Đã lưu ✓';
      cls += n > 0 ? ' is-pending' : ' is-saved';
    } else if (state === 'error') {
      txt = 'Lỗi mạng — thử lại';
      cls += ' is-error';
    }
    el.className = cls;
    el.textContent = txt;
    if (btn) btn.disabled = state === 'saving';
  }

  async function onSave() {
    const sync = (_ctx && _ctx.deps && _ctx.deps.sync) || (g && g.MWLSync) || null;
    setSaveState('saving');
    if (!sync || typeof sync.manualSync !== 'function') {
      setSaveState('saved');
      return;
    }
    try {
      const r = await sync.manualSync();
      if (r && r.authExpired) {
        setSaveState('error');
        return;
      }
      setSaveState('pending', r);
    } catch (e) {
      reportErr(e);
      setSaveState('error');
    }
  }

  // Phản ánh trạng thái đồng bộ hiện tại lên nhãn cạnh nút Lưu.
  function refreshSaveStateFromSync() {
    const sync = (_ctx && _ctx.deps && _ctx.deps.sync) || (g && g.MWLSync) || null;
    if (!sync || typeof sync.syncStatus !== 'function') return;
    Promise.resolve()
      .then(() => sync.syncStatus())
      .then((st) => {
        if (!st) return;
        setSaveState('pending', { pending: st.pending || 0 });
      })
      .catch(() => {
        /* best-effort */
      });
  }

  // --- Điểm vào chính ------------------------------------------------------
  // renderSessions(weekPack, opts?) → thanh chọn Khách/Ngày/Buổi + chi tiết 1 buổi.
  // opts: { container?, logsBySession?, store?, logModel?, sync?, steps?, now? }
  async function renderSessions(weekPack, opts) {
    opts = opts || (_ctx && _ctx.opts) || {};
    const container = resolveContainer(opts);
    if (!container) return { rendered: 0 }; // môi trường không có DOM (vd. Node).

    _ctx = {
      container,
      weekPack: weekPack || { sessions: [] },
      opts,
      deps: resolveDeps(opts),
      logs: new Map(),
    };

    wireContainer(container);
    clearNode(container);

    const sessions = sessionsOf();
    if (sessions.length === 0) {
      container.appendChild(
        h('p', {
          class: 'mwl-empty',
          text: 'Chưa có lịch tuần. Hãy "Đưa lịch tuần ra điện thoại" từ máy tính.',
        })
      );
      return { rendered: 0 };
    }

    // 1) Khách hàng — chọn mặc định nếu lựa chọn cũ không còn.
    const clients = uniqueClients(sessions);
    if (!clients.includes(_nav.client)) _nav.client = clients[0];

    // 2) Ngày của khách đã chọn.
    const dates = datesForClient(sessions, _nav.client);
    if (!dates.includes(_nav.date)) _nav.date = dates[0] || null;

    // 3) Buổi của khách + ngày.
    const daySessions = sessionsForClientDate(sessions, _nav.client, _nav.date);
    const sessionIds = daySessions.map((s) => s.sessionId);
    if (!sessionIds.includes(_nav.sessionId)) _nav.sessionId = sessionIds[0] || null;

    // --- Thanh chọn gọn ---
    const toolbar = h('div', { class: 'mwl-toolbar' }, []);

    // Hàng Khách — ẩn nếu chỉ có 1 khách.
    if (clients.length > 1) {
      toolbar.appendChild(
        chipRow(
          'Khách',
          clients.map((c) => chip('client', c, c || '—', '', c === _nav.client))
        )
      );
    }
    // Hàng Ngày.
    toolbar.appendChild(
      chipRow(
        'Ngày',
        dates.map((d) => {
          const lab = formatDateLabel(d);
          return chip('date', d, lab.main, lab.sub, d === _nav.date);
        })
      )
    );
    // Hàng Buổi — ẩn nếu chỉ có 1 buổi trong ngày.
    if (daySessions.length > 1) {
      toolbar.appendChild(
        chipRow(
          'Buổi',
          daySessions.map((s) => {
            const t = isFilled(s.time) ? String(s.time) : '';
            const nm = isFilled(s.workoutName) ? String(s.workoutName) : 'Buổi tập';
            return chip('session', s.sessionId, nm, t, s.sessionId === _nav.sessionId);
          })
        )
      );
    }
    container.appendChild(toolbar);

    // --- Chi tiết buổi đang chọn ---
    const detail = h('div', { class: 'mwl-detail' }, []);
    const selected = daySessions.find((s) => s.sessionId === _nav.sessionId) || daySessions[0] || null;
    if (selected) {
      const log = await resolveLog(selected, opts);
      if (selected.sessionId != null) _ctx.logs.set(selected.sessionId, log);
      detail.appendChild(buildSession(selected, log, opts));
    } else {
      detail.appendChild(h('p', { class: 'mwl-empty-hint', text: 'Ngày này chưa có buổi tập.' }));
    }
    container.appendChild(detail);

    // --- Thanh "Lưu & đồng bộ" (dính đáy) ---
    const savebar = h('div', { class: 'mwl-savebar' }, [
      h('button', { type: 'button', class: 'mwl-save-btn', text: '💾 Lưu & đồng bộ' }),
      h('span', { class: 'mwl-save-state', text: '' }),
    ]);
    container.appendChild(savebar);
    refreshSaveStateFromSync();

    return { rendered: selected ? 1 : 0 };
  }

  const api = {
    renderSessions,
    configureSteps,
    CONTAINER_ID,
    // helper thuần phơi cho kiểm thử/seam
    _groupByDate: groupByDate,
    _columnsForItem: columnsForItem,
    _compareTime: compareTime,
    _applyStep: applyStep,
    _parseNumeric: parseNumeric,
    _normalizeFieldValue: normalizeFieldValue,
    _stepFor: stepFor,
    STEP_CONFIG,
    DEFAULT_STEPS,
  };

  if (g) g.MWLLoggerUI = api;

  // --- Tự vẽ danh sách buổi khi app đã kết nối + có Gói_Lịch_Tuần ----------
  // Nối với MWLApp (task 9.2): app-pwa phát state (có weekPack) sau khi tải lịch.
  // Chỉ vẽ lại khi weekPack THỰC SỰ đổi (tránh xoá form đang nhập mỗi lần cập nhật badge).
  (function autoRenderOnState() {
    if (!g || !g.MWLApp || typeof g.MWLApp.onState !== 'function') return;
    let lastPack = null;
    g.MWLApp.onState(function (st) {
      if (!st || !st.connected) { lastPack = null; return; }
      const wp = st.weekPack;
      if (wp && Array.isArray(wp.sessions) && wp.sessions.length && wp !== lastPack) {
        lastPack = wp;
        try { api.renderSessions(wp); }
        catch (e) { if (g.console) g.console.warn('renderSessions lỗi:', e); }
      }
    });
  })();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
