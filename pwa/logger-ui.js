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

    const conflict = !!(loggedSet && loggedSet.conflict);
    const rowAttrs = { class: 'mwl-set-row' + (doneOn ? ' is-done' : '') + (conflict ? ' has-conflict' : '') };
    if (conflict) rowAttrs.title = 'Xung đột: số liệu set này được sửa từ 2 nơi. Kiểm tra lại.';
    return h('div', rowAttrs, cells);
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
    const sessionId = session.sessionId;
    const entryId = item.itemId;
    const columns = columnsForItem(item);
    const entry = findEntry(log, item.itemId);
    const presc = Array.isArray(item.prescription) ? item.prescription : [];

    const loggedSets = entry && Array.isArray(entry.sets) ? entry.sets : [];
    const maxLogged = loggedSets.reduce((m, s) => Math.max(m, Number(s && s.set) || 0), 0);
    const total = Math.max(presc.length, maxLogged);
    const doneCount = loggedSets.filter((s) => s && s.done).length;
    const allDone = total > 0 && doneCount >= total;
    const collapsed = _collapsed.has(sessionId + '|' + entryId);

    // Tiêu đề bài — chạm để gập/mở.
    const headKids = [
      h('span', { class: 'mwl-item-chevron', text: collapsed ? '▸' : '▾' }),
      h('span', { class: 'mwl-item-name', text: item.name != null ? item.name : '' }),
    ];
    if (isFilled(item.target)) headKids.push(h('span', { class: 'mwl-item-target', text: String(item.target) }));
    // Chỗ hiển thị "Lần trước" (điền bất đồng bộ qua injectHistory).
    headKids.push(h('span', { class: 'mwl-prev', 'data-entry-id': entryId, text: '' }));
    if (allDone) headKids.push(h('span', { class: 'mwl-item-done-badge', text: '✓' }));
    headKids.push(h('span', { class: 'mwl-item-count', text: doneCount + '/' + total }));

    const head = h(
      'div',
      { class: 'mwl-item-head' + (allDone ? ' is-done' : ''), 'data-session-id': sessionId, 'data-entry-id': entryId },
      headKids
    );

    const section = h('section', { class: 'mwl-item' + (collapsed ? ' is-collapsed' : ''), 'data-entry-id': entryId }, [head]);

    if (collapsed) return section;

    const rows = [buildColumnHeader(columns)];
    for (let i = 1; i <= total; i++) {
      const prescriptionSet = presc.find((p) => Number(p && p.set) === i) || presc[i - 1] || null;
      const loggedSet = findLoggedSet(entry, i);
      rows.push(buildSetRow(session, item, columns, i, prescriptionSet, loggedSet, opts));
    }
    section.appendChild(h('div', { class: 'mwl-sets' }, rows));

    // Dòng thống kê: khối lượng buổi + 1RM ước tính (chỉ khi đã có số liệu).
    const vol = volumeOf(entry);
    const orm = best1RM(entry);
    if (vol != null || orm != null) {
      const stats = [];
      if (orm != null) stats.push(h('span', { class: 'mwl-stat', text: '1RM ~' + orm + 'kg' }));
      if (vol != null) stats.push(h('span', { class: 'mwl-stat', text: 'Khối lượng ' + vol + 'kg' }));
      section.appendChild(h('div', { class: 'mwl-item-stats' }, stats));
    }

    // Ô biểu đồ tiến bộ mini (điền bất đồng bộ qua injectHistory).
    section.appendChild(h('div', { class: 'mwl-prog', 'data-entry-id': entryId }, []));

    // Mức tạ gợi ý cho máy tính tạ: tạ thực tế cuối, hoặc tạ kê đơn đầu.
    const last = lastLoggedSet(entry);
    let prefillW = last && isFilled(last.weight) ? last.weight : '';
    if (prefillW === '' && presc.length && isFilled(presc[0].weight)) prefillW = presc[0].weight;

    const foot = h('div', { class: 'mwl-item-foot' }, [
      h('button', {
        type: 'button',
        class: 'mwl-copy-btn',
        'data-session-id': sessionId,
        'data-entry-id': entryId,
        text: '📋 Chép kê đơn',
      }),
      h('button', {
        type: 'button',
        class: 'mwl-addset-btn',
        'data-session-id': sessionId,
        'data-entry-id': entryId,
        text: '+ Thêm set',
      }),
      h('button', {
        type: 'button',
        class: 'mwl-plate-btn',
        'data-weight': prefillW !== '' ? String(prefillW) : null,
        text: '🏋️ Tạ',
      }),
    ]);
    section.appendChild(foot);
    return section;
  }

  // Render một buổi (session card).
  function buildSession(session, log, opts) {
    const items = Array.isArray(session.items) ? session.items : [];
    const sessionId = session.sessionId;
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

    // Thanh tiến độ buổi.
    const p = computeProgress(session, log);
    const pct = p.totalSets > 0 ? Math.round((p.doneSets / p.totalSets) * 100) : 0;
    const progress = h('div', { class: 'mwl-progress', 'data-session-id': sessionId }, [
      h('div', { class: 'mwl-progress-track' }, [
        h('div', { class: 'mwl-progress-fill', style: 'width:' + pct + '%' }),
      ]),
      h('div', {
        class: 'mwl-progress-text',
        text: p.doneItems + '/' + p.totalItems + ' bài · ' + p.doneSets + '/' + p.totalSets + ' set',
      }),
    ]);

    // Hàng cân nặng + ghi chú buổi.
    const bwInput = h('input', {
      class: 'mwl-bw-input',
      type: 'text',
      inputmode: 'decimal',
      'data-session-id': sessionId,
      placeholder: 'kg',
    });
    if (isFilled(log && log.bodyweight)) bwInput.value = String(log.bodyweight);
    const noteInput = h('textarea', {
      class: 'mwl-note-input',
      'data-session-id': sessionId,
      rows: '1',
      placeholder: 'Ghi chú buổi (vd: khách hơi mệt, giảm tạ vai)…',
    });
    if (isFilled(log && log.note)) noteInput.value = String(log.note);
    const metaRow = h('div', { class: 'mwl-session-extra' }, [
      h('label', { class: 'mwl-bw-wrap' }, [h('span', { class: 'mwl-bw-label', text: 'Cân nặng' }), bwInput]),
      noteInput,
    ]);

    // Gộp bài theo giáo án + bài tự do.
    const allItems = getAllItems(session, log);

    let body;
    if (_focus && allItems.length > 0) {
      let idx = _focusIdx;
      if (!(idx >= 0 && idx < allItems.length)) idx = 0;
      _focusIdx = idx;
      const navAttrsPrev = { type: 'button', class: 'mwl-focus-prev', 'data-session-id': sessionId, text: '◀' };
      const navAttrsNext = { type: 'button', class: 'mwl-focus-next', 'data-session-id': sessionId, text: '▶' };
      if (idx <= 0) navAttrsPrev.disabled = 'disabled';
      if (idx >= allItems.length - 1) navAttrsNext.disabled = 'disabled';
      const nav = h('div', { class: 'mwl-focus-nav' }, [
        h('button', navAttrsPrev),
        h('span', { class: 'mwl-focus-label', text: 'Bài ' + (idx + 1) + '/' + allItems.length }),
        h('button', navAttrsNext),
      ]);
      body = h('div', { class: 'mwl-session-items' }, [nav, buildItem(session, allItems[idx], log, opts)]);
    } else if (allItems.length > 0) {
      body = h('div', { class: 'mwl-session-items' }, allItems.map((it) => buildItem(session, it, log, opts)));
    } else {
      body = h('p', { class: 'mwl-empty-hint', text: 'Buổi này chưa có bài tập.' });
    }

    const foot = h('div', { class: 'mwl-session-foot' }, [
      h('button', {
        type: 'button',
        class: 'mwl-addex-btn',
        'data-session-id': sessionId,
        text: '➕ Thêm bài tập',
      }),
      h('button', {
        type: 'button',
        class: 'mwl-end-btn',
        'data-session-id': sessionId,
        text: '✅ Kết thúc buổi',
      }),
    ]);

    return h('article', { class: 'mwl-session', 'data-session-id': sessionId }, [head, progress, metaRow, body, foot]);
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

  // --- Phụ trợ tính năng nâng cao (TASK 11) --------------------------------

  // Trạng thái gập bài (UI-only), khoá theo "sessionId|entryId".
  const _collapsed = new Set();

  // Chế độ "tập trung 1 bài" (mục 8).
  let _focus = false;
  let _focusIdx = 0;

  function vibrate(pattern) {
    try {
      if (g && g.navigator && typeof g.navigator.vibrate === 'function') g.navigator.vibrate(pattern);
    } catch (_) {
      /* best-effort */
    }
  }

  function prescriptionSetOf(item, ordinal) {
    const presc = item && Array.isArray(item.prescription) ? item.prescription : [];
    return presc.find((p) => Number(p && p.set) === Number(ordinal)) || presc[ordinal - 1] || null;
  }

  function lastLoggedSet(entry) {
    const sets = entry && Array.isArray(entry.sets) ? entry.sets : [];
    let best = null;
    for (const s of sets) {
      if (!s) continue;
      if (!best || Number(s.set) > Number(best.set)) best = s;
    }
    return best;
  }

  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Khối lượng (volume) = Σ weight×reps các set có đủ số liệu.
  function volumeOf(entry) {
    const sets = entry && Array.isArray(entry.sets) ? entry.sets : [];
    let vol = 0;
    let any = false;
    for (const s of sets) {
      const w = numOrNull(s && s.weight);
      const r = numOrNull(s && s.reps);
      if (w != null && r != null) {
        vol += w * r;
        any = true;
      }
    }
    return any ? Math.round(vol * 10) / 10 : null;
  }

  // 1RM ước tính tốt nhất (Epley) trong các set của entry.
  function best1RM(entry) {
    const hist = g && g.MWLHistory;
    const sets = entry && Array.isArray(entry.sets) ? entry.sets : [];
    let best = null;
    for (const s of sets) {
      const w = numOrNull(s && s.weight);
      const r = numOrNull(s && s.reps);
      if (w == null) continue;
      let est;
      if (hist && typeof hist.epley1RM === 'function') est = hist.epley1RM(w, r);
      else est = r != null && r > 1 ? Math.round(w * (1 + r / 30) * 10) / 10 : w;
      if (est != null && (best == null || est > best)) best = est;
    }
    return best;
  }

  // Lưu meta buổi (note/bodyweight) immutably qua logmodel.setLogMeta + persist.
  async function commitMeta(sessionId, patch) {
    const model = _ctx && _ctx.deps.logModel;
    if (!model || typeof model.setLogMeta !== 'function') return;
    pushUndo(sessionId);
    const log = getCtxLog(sessionId);
    const next = model.setLogMeta(log, patch, nowIso());
    _ctx.logs.set(sessionId, next);
    await persistAndQueue(next, sessionId);
  }

  // Gộp bài giáo án + bài tự do (entry trong log không thuộc giáo án).
  function getAllItems(session, log) {
    const items = session && Array.isArray(session.items) ? session.items : [];
    const plannedIds = {};
    items.forEach((it) => {
      if (it && it.itemId != null) plannedIds[it.itemId] = true;
    });
    const customItems = (log && Array.isArray(log.entries) ? log.entries : [])
      .filter((e) => e && e.entryId != null && !plannedIds[e.entryId])
      .map((e) => ({
        itemId: e.entryId,
        name: e.name || 'Bài thêm',
        type: 'exercise',
        target: 'tự do',
        cols: {},
        prescription: [],
      }));
    return items.concat(customItems);
  }

  // Chỉ số bài CHƯA hoàn thành đầu tiên (cho chế độ tập trung).
  function firstUnfinishedIndex(session, log) {
    const all = getAllItems(session, log);
    for (let i = 0; i < all.length; i++) {
      const entry = findEntry(log, all[i].itemId);
      const presc = Array.isArray(all[i].prescription) ? all[i].prescription : [];
      const logged = entry && Array.isArray(entry.sets) ? entry.sets : [];
      const maxLogged = logged.reduce((m, s) => Math.max(m, Number(s && s.set) || 0), 0);
      const total = Math.max(presc.length, maxLogged);
      const dCount = logged.filter((s) => s && s.done).length;
      if (!(total > 0 && dCount >= total)) return i;
    }
    return 0;
  }

  // Tính tiến độ buổi: tổng set hiển thị, số set xong, số bài xong.
  function computeProgress(session, log) {
    const items = session && Array.isArray(session.items) ? session.items : [];
    let totalSets = 0;
    let doneSets = 0;
    let doneItems = 0;
    for (const item of items) {
      const entry = findEntry(log, item.itemId);
      const presc = Array.isArray(item.prescription) ? item.prescription : [];
      const logged = entry && Array.isArray(entry.sets) ? entry.sets : [];
      const maxLogged = logged.reduce((m, s) => Math.max(m, Number(s && s.set) || 0), 0);
      const total = Math.max(presc.length, maxLogged);
      const dCount = logged.filter((s) => s && s.done).length;
      totalSets += total;
      doneSets += dCount;
      if (total > 0 && dCount >= total) doneItems += 1;
    }
    return { totalSets, doneSets, doneItems, totalItems: items.length };
  }

  // Cập nhật thanh tiến độ tại chỗ sau mỗi thay đổi.
  function updateProgress(sessionId) {
    if (!_ctx || !_ctx.container || !_ctx.container.querySelector) return;
    const session = findSession(sessionId);
    if (!session) return;
    const log = getCtxLog(sessionId);
    const p = computeProgress(session, log);
    const wrap = _ctx.container.querySelector('.mwl-progress[data-session-id="' + cssEscape(sessionId) + '"]');
    if (!wrap) return;
    const fill = wrap.querySelector('.mwl-progress-fill');
    const txt = wrap.querySelector('.mwl-progress-text');
    const pct = p.totalSets > 0 ? Math.round((p.doneSets / p.totalSets) * 100) : 0;
    if (fill) fill.style.width = pct + '%';
    if (txt) txt.textContent = p.doneItems + '/' + p.totalItems + ' bài · ' + p.doneSets + '/' + p.totalSets + ' set';
  }

  // Escape giá trị để dùng trong selector (đơn giản, đủ cho id của chúng ta).
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // --- Handlers ------------------------------------------------------------

  async function onInputChange(input) {
    const sessionId = input.getAttribute('data-session-id');
    const entryId = input.getAttribute('data-entry-id');
    const ordinal = Number(input.getAttribute('data-set'));
    const field = input.getAttribute('data-field');
    const value = normalizeFieldValue(field, input.value);
    pushUndo(sessionId);
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
    vibrate(8);
    pushUndo(sessionId);
    await commitPatch(sessionId, entryId, { set: ordinal, [field]: nextVal });
  }

  async function onDone(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const entryId = btn.getAttribute('data-entry-id');
    const ordinal = Number(btn.getAttribute('data-set'));

    const log = getCtxLog(sessionId);
    const existing = findLoggedSet(findEntry(log, entryId), ordinal);
    const newDone = !(existing && existing.done);

    pushUndo(sessionId);
    await commitPatch(sessionId, entryId, { set: ordinal, done: newDone });

    // Cập nhật DOM tại chỗ (YC3.4 — phản hồi tức thì một-chạm).
    btn.classList.toggle('is-done', newDone);
    btn.textContent = newDone ? '✓' : '○';
    btn.setAttribute('aria-pressed', newDone ? 'true' : 'false');
    const row = btn.closest ? btn.closest('.mwl-set-row') : null;
    if (row) row.classList.toggle('is-done', newDone);

    // Rung phản hồi + đồng hồ nghỉ tự động theo "Nghỉ" kê đơn (chỉ khi đánh dấu XONG).
    vibrate(newDone ? [15, 30, 15] : 10);
    if (newDone && g && g.MWLRestTimer && typeof g.MWLRestTimer.start === 'function') {
      const session = findSession(sessionId);
      const item = session ? findItem(session, entryId) : null;
      const ps = item ? prescriptionSetOf(item, ordinal) : null;
      const secs = g.MWLRestTimer.parseRest(ps ? ps.rest : '');
      if (secs) g.MWLRestTimer.start(secs, 'Nghỉ');
    }
    updateProgress(sessionId);
  }

  async function onAddSet(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const entryId = btn.getAttribute('data-entry-id');

    const model = _ctx && _ctx.deps.logModel;
    if (!model) return;
    pushUndo(sessionId);
    const log = getCtxLog(sessionId);
    const entry = findEntry(log, entryId);
    const last = lastLoggedSet(entry);

    // Mang mức tạ/reps của set trước xuống set mới cho đỡ gõ (YC nâng cao).
    if (last && (isFilled(last.weight) || isFilled(last.reps))) {
      const nextOrd = (Number(last.set) || 0) + 1;
      await commitPatch(sessionId, entryId, { set: nextOrd, weight: last.weight, reps: last.reps });
    } else if (typeof model.addBlankSet === 'function') {
      const next = model.addBlankSet(log, entryId, nowIso());
      _ctx.logs.set(sessionId, next);
      await persistAndQueue(next, sessionId);
    }

    vibrate(10);
    rerenderItem(sessionId, entryId); // vẽ lại bài để hiện set mới
    updateProgress(sessionId);
  }

  // Chép kê đơn xuống thực tế cho cả bài (1 chạm) — chỉ điền set CHƯA có thực tế.
  async function onCopyPrescription(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const entryId = btn.getAttribute('data-entry-id');
    const session = findSession(sessionId);
    const item = session ? findItem(session, entryId) : null;
    if (!item) return;
    const presc = Array.isArray(item.prescription) ? item.prescription : [];
    const COPY_FIELDS = ['reps', 'weight', 'one_rm', 'rpe', 'rir', 'rest', 'time', 'distance', 'tempo'];
    pushUndo(sessionId);
    for (const p of presc) {
      if (!p) continue;
      const ordinal = Number(p.set) || presc.indexOf(p) + 1;
      const existing = findLoggedSet(findEntry(getCtxLog(sessionId), entryId), ordinal);
      if (existing && (isFilled(existing.reps) || isFilled(existing.weight))) continue; // đã ghi ⇒ giữ
      const patch = { set: ordinal };
      let any = false;
      for (const f of COPY_FIELDS) {
        if (isFilled(p[f])) {
          patch[f] = p[f];
          any = true;
        }
      }
      if (any) {
        // eslint-disable-next-line no-await-in-loop
        await commitPatch(sessionId, entryId, patch);
      }
    }
    vibrate(12);
    rerenderItem(sessionId, entryId);
    updateProgress(sessionId);
  }

  // Bật/tắt chế độ tập trung 1 bài (mục 8).
  function onToggleFocus() {
    _focus = !_focus;
    if (_focus) {
      const session = findSession(_nav.sessionId);
      const log = session ? getCtxLog(session.sessionId) : null;
      _focusIdx = session ? firstUnfinishedIndex(session, log) : 0;
    }
    rerenderAll();
  }

  function onFocusNav(dir) {
    const session = findSession(_nav.sessionId);
    const log = session ? getCtxLog(session.sessionId) : null;
    const all = getAllItems(session, log);
    let idx = _focusIdx + dir;
    if (idx < 0) idx = 0;
    if (idx > all.length - 1) idx = all.length - 1;
    _focusIdx = idx;
    rerenderAll();
  }

  // Gập/mở một bài.
  function onToggleCollapse(headEl) {
    const sessionId = headEl.getAttribute('data-session-id');
    const entryId = headEl.getAttribute('data-entry-id');
    if (!entryId) return;
    const key = sessionId + '|' + entryId;
    if (_collapsed.has(key)) _collapsed.delete(key);
    else _collapsed.add(key);
    rerenderItem(sessionId, entryId);
  }

  // Mở máy tính bánh tạ (prefill từ ô tạ gần nhất nếu có).
  function onPlateCalc(btn) {
    if (!(g && g.MWLPlateCalc && typeof g.MWLPlateCalc.open === 'function')) return;
    let prefill = btn.getAttribute('data-weight') || '';
    g.MWLPlateCalc.open(prefill);
  }

  // Kết thúc buổi: đồng bộ ngay + hiện tóm tắt.
  async function onEndSession(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const session = findSession(sessionId);
    const log = getCtxLog(sessionId);
    const p = session ? computeProgress(session, log) : { doneSets: 0, totalSets: 0, doneItems: 0, totalItems: 0 };
    setSaveState('saving');
    const sync = (_ctx && _ctx.deps && _ctx.deps.sync) || (g && g.MWLSync) || null;
    try {
      if (sync && typeof sync.manualSync === 'function') await sync.manualSync();
      setSaveState('pending', sync && typeof sync.syncStatus === 'function' ? await sync.syncStatus() : null);
    } catch (e) {
      reportErr(e);
      setSaveState('error');
    }
    vibrate([20, 60, 20]);
    showSummary(session, p);
  }

  function showSummary(session, p) {
    const d = doc();
    if (!d) return;
    const modal = h('div', { class: 'mwl-summary-modal' }, [
      h('div', { class: 'mwl-summary-card' }, [
        h('div', { class: 'mwl-summary-head', text: '✅ Hoàn tất buổi tập' }),
        h('div', { class: 'mwl-summary-client', text: (session && session.clientName) || '' }),
        h('div', { class: 'mwl-summary-stats' }, [
          h('div', { class: 'mwl-summary-stat' }, [
            h('span', { class: 'mwl-summary-num', text: String(p.doneItems) + '/' + String(p.totalItems) }),
            h('span', { class: 'mwl-summary-lbl', text: 'bài xong' }),
          ]),
          h('div', { class: 'mwl-summary-stat' }, [
            h('span', { class: 'mwl-summary-num', text: String(p.doneSets) + '/' + String(p.totalSets) }),
            h('span', { class: 'mwl-summary-lbl', text: 'set xong' }),
          ]),
        ]),
        h('div', { class: 'mwl-summary-actions' }, [
          h('button', { type: 'button', class: 'mwl-summary-share', text: '📤 Chia sẻ' }),
          h('button', { type: 'button', class: 'mwl-summary-close', text: 'Đóng' }),
        ]),
      ]),
    ]);
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal || (ev.target && ev.target.classList && ev.target.classList.contains('mwl-summary-close'))) {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
      }
      if (ev.target && ev.target.classList && ev.target.classList.contains('mwl-summary-share')) {
        shareSummary(session, p);
      }
    });
    (d.body || d.documentElement).appendChild(modal);
  }

  // --- Chia sẻ tóm tắt buổi (mục 10): vẽ ảnh PNG rồi share/tải về ----------
  function shareSummary(session, p) {
    const d = doc();
    if (!d) return;
    try {
      const canvas = d.createElement('canvas');
      canvas.width = 800;
      canvas.height = 460;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 460);
      ctx.fillStyle = '#173a78';
      ctx.fillRect(0, 0, 800, 120);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px Arial, sans-serif';
      ctx.fillText('Báo cáo buổi tập', 40, 76);
      ctx.fillStyle = '#17202c';
      ctx.font = 'bold 32px Arial, sans-serif';
      ctx.fillText(String(session && session.clientName ? session.clientName : ''), 40, 185);
      ctx.fillStyle = '#667085';
      ctx.font = '22px Arial, sans-serif';
      const sub = [session && session.workoutName, session && session.date].filter(Boolean).join('  ·  ');
      ctx.fillText(sub, 40, 225);
      // hai chỉ số lớn
      ctx.fillStyle = '#173a78';
      ctx.font = 'bold 72px Arial, sans-serif';
      ctx.fillText(p.doneItems + '/' + p.totalItems, 120, 360);
      ctx.fillText(p.doneSets + '/' + p.totalSets, 470, 360);
      ctx.fillStyle = '#667085';
      ctx.font = '22px Arial, sans-serif';
      ctx.fillText('bài tập', 150, 400);
      ctx.fillText('set', 540, 400);
      ctx.fillStyle = '#9aa3b2';
      ctx.font = '18px Arial, sans-serif';
      ctx.fillText('Tạo bởi Ghi Buổi Tập', 40, 440);

      const finish = (blob) => {
        const file = blob && g.File ? new g.File([blob], 'bao-cao-buoi-tap.png', { type: 'image/png' }) : null;
        const nav = g.navigator;
        if (file && nav && typeof nav.canShare === 'function' && nav.canShare({ files: [file] }) && typeof nav.share === 'function') {
          nav.share({ files: [file], title: 'Báo cáo buổi tập', text: 'Tóm tắt buổi tập' }).catch(() => {});
          return;
        }
        // Dự phòng: tải ảnh về máy.
        const url = canvas.toDataURL('image/png');
        const a = d.createElement('a');
        a.href = url;
        a.download = 'bao-cao-buoi-tap.png';
        (d.body || d.documentElement).appendChild(a);
        a.click();
        if (a.parentNode) a.parentNode.removeChild(a);
      };

      if (canvas.toBlob) canvas.toBlob(finish, 'image/png');
      else finish(null);
    } catch (e) {
      reportErr(e);
    }
  }

  // --- Hoàn tác (mục 9): ngăn xếp ảnh chụp log trước mỗi thay đổi ----------
  const _undo = [];

  function pushUndo(sessionId) {
    if (!_ctx) return;
    const log = getCtxLog(sessionId);
    if (!log) return;
    try {
      _undo.push({ sessionId, log: JSON.parse(JSON.stringify(log)) });
    } catch (_) {
      return;
    }
    if (_undo.length > 30) _undo.shift();
    updateUndoBtn();
  }

  async function undoLast() {
    const item = _undo.pop();
    if (!item || !_ctx) return;
    _ctx.logs.set(item.sessionId, item.log);
    await persistAndQueue(item.log, item.sessionId);
    vibrate(10);
    updateUndoBtn();
    rerenderAll();
  }

  function updateUndoBtn() {
    if (!_ctx || !_ctx.container || !_ctx.container.querySelector) return;
    const btn = _ctx.container.querySelector('.mwl-undo-btn');
    if (btn) btn.disabled = _undo.length === 0;
  }

  // --- Thêm bài tập tự do (mục 6) -----------------------------------------
  async function onAddExercise(btn) {
    const sessionId = btn.getAttribute('data-session-id');
    const model = _ctx && _ctx.deps.logModel;
    if (!model || typeof model.ensureEntry !== 'function') return;
    const name = g && typeof g.prompt === 'function' ? g.prompt('Tên bài tập thêm vào buổi:') : '';
    if (!name || !String(name).trim()) return;
    pushUndo(sessionId);
    const entryId = 'custom:' + Date.now();
    let log = getCtxLog(sessionId);
    log = model.ensureEntry(log, entryId, String(name).trim(), nowIso());
    if (typeof model.addBlankSet === 'function') log = model.addBlankSet(log, entryId, nowIso());
    _ctx.logs.set(sessionId, log);
    await persistAndQueue(log, sessionId);
    vibrate(12);
    rerenderAll();
  }

  // --- Lọc khách theo ô tìm kiếm (mục 7) ----------------------------------
  function onClientSearch(input) {
    const q = String(input.value || '').trim().toLowerCase();
    const toolbar = input.closest ? input.closest('.mwl-toolbar') : null;
    if (!toolbar) return;
    const chips = toolbar.getElementsByClassName('mwl-chip');
    Array.prototype.slice.call(chips).forEach((c) => {
      if (c.getAttribute('data-nav') !== 'client') return;
      const key = (c.getAttribute('data-key') || '').toLowerCase();
      c.style.display = !q || key.indexOf(q) !== -1 ? '' : 'none';
    });
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
      return;
    }
    const copyBtn = t.closest('.mwl-copy-btn');
    if (copyBtn) {
      ev.preventDefault();
      onCopyPrescription(copyBtn).catch(reportErr);
      return;
    }
    const plateBtn = t.closest('.mwl-plate-btn');
    if (plateBtn) {
      ev.preventDefault();
      onPlateCalc(plateBtn);
      return;
    }
    const endBtn = t.closest('.mwl-end-btn');
    if (endBtn) {
      ev.preventDefault();
      onEndSession(endBtn).catch(reportErr);
      return;
    }
    const undoBtn = t.closest('.mwl-undo-btn');
    if (undoBtn) {
      ev.preventDefault();
      undoLast().catch(reportErr);
      return;
    }
    const addExBtn = t.closest('.mwl-addex-btn');
    if (addExBtn) {
      ev.preventDefault();
      onAddExercise(addExBtn).catch(reportErr);
      return;
    }
    const focusToggle = t.closest('.mwl-focus-toggle');
    if (focusToggle) {
      ev.preventDefault();
      onToggleFocus();
      return;
    }
    const focusPrev = t.closest('.mwl-focus-prev');
    if (focusPrev) {
      ev.preventDefault();
      onFocusNav(-1);
      return;
    }
    const focusNext = t.closest('.mwl-focus-next');
    if (focusNext) {
      ev.preventDefault();
      onFocusNav(1);
      return;
    }
    // Gập/mở bài khi chạm tiêu đề bài (đặt cuối để không nuốt các nút bên trong).
    const head = t.closest('.mwl-item-head');
    if (head && head.getAttribute('data-entry-id')) {
      ev.preventDefault();
      onToggleCollapse(head);
    }
  }

  function onContainerChange(ev) {
    const t = ev.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('mwl-set-input')) {
      onInputChange(t).catch(reportErr);
      return;
    }
    if (t.classList.contains('mwl-note-input')) {
      const sid = t.getAttribute('data-session-id');
      commitMeta(sid, { note: t.value }).catch(reportErr);
      return;
    }
    if (t.classList.contains('mwl-bw-input')) {
      const sid = t.getAttribute('data-session-id');
      commitMeta(sid, { bodyweight: t.value }).catch(reportErr);
    }
  }

  function onContainerInput(ev) {
    const t = ev.target;
    if (t && t.classList && t.classList.contains('mwl-client-search')) {
      onClientSearch(t);
    }
  }

  // Gắn delegation MỘT LẦN cho container (idempotent qua cờ trên node).
  function wireContainer(container) {
    if (!container || container._mwlWired) return;
    container._mwlWired = true;
    container.addEventListener('click', onContainerClick);
    container.addEventListener('change', onContainerChange);
    container.addEventListener('input', onContainerInput);
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

  // Ngày hôm nay theo lịch địa phương (YYYY-MM-DD).
  function todayISO() {
    if (_ctx && _ctx.opts && typeof _ctx.opts.todayISO === 'string') return _ctx.opts.todayISO;
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  // Khách đầu tiên (theo thứ tự) có buổi vào ngày `iso`.
  function clientWithSessionOn(sessions, clients, iso) {
    for (const c of clients) {
      if (sessions.some((s) => String((s && s.clientName) || '') === c && String((s && s.date) || '') === iso)) {
        return c;
      }
    }
    return null;
  }

  // Nạp "Lần trước" + biểu đồ tiến bộ mini (bất đồng bộ, không chặn render).
  function injectHistory(session) {
    if (!session || !session.clientId) return;
    const hist = g && g.MWLHistory;
    if (!hist || typeof hist.getClientHistory !== 'function') return;
    Promise.resolve()
      .then(() => hist.getClientHistory(session.clientId, session.date))
      .then((res) => {
        if (!res || !_ctx || !_ctx.container || !_ctx.container.getElementsByClassName) return;
        const byEntry = res.byEntry || {};
        const byName = res.byName || {};
        const pick = (eid, item) => {
          let rec = byEntry[eid];
          if ((!rec || !rec.series || !rec.series.length) && item && item.name) {
            rec = byName[String(item.name).trim().toLowerCase()];
          }
          return rec;
        };

        // "Lần trước"
        const prevs = Array.prototype.slice.call(_ctx.container.getElementsByClassName('mwl-prev'));
        for (const span of prevs) {
          const eid = span.getAttribute('data-entry-id');
          const rec = pick(eid, findItem(session, eid));
          if (rec && rec.last) {
            const txt = hist.formatResult(rec.last);
            if (txt) span.textContent = 'Lần trước: ' + txt;
          }
        }

        // Biểu đồ tiến bộ mini (chuỗi kg×reps qua các buổi).
        const progs = Array.prototype.slice.call(_ctx.container.getElementsByClassName('mwl-prog'));
        for (const box of progs) {
          const eid = box.getAttribute('data-entry-id');
          const rec = pick(eid, findItem(session, eid));
          const series = rec && Array.isArray(rec.series) ? rec.series : [];
          if (series.length < 2) continue; // cần ≥2 buổi mới thể hiện tiến bộ
          renderSeriesInto(box, series);
        }
      })
      .catch(() => {
        /* lịch sử là phụ trợ — lỗi không ảnh hưởng ghi buổi */
      });
  }

  // Vẽ chuỗi tiến bộ dạng chip "14/6 35×10 → 16/6 37.5×10".
  function renderSeriesInto(box, series) {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(h('span', { class: 'mwl-prog-label', text: '📈' }));
    series.forEach((p, i) => {
      if (i > 0) box.appendChild(h('span', { class: 'mwl-prog-arrow', text: '→' }));
      const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.date || ''));
      const dlabel = dm ? Number(dm[3]) + '/' + Number(dm[2]) : String(p.date || '');
      const wv = p.weight != null ? p.weight : '–';
      const rv = p.reps != null ? p.reps : '–';
      box.appendChild(
        h('span', { class: 'mwl-prog-pt' }, [
          h('b', { text: dlabel + ' ' }),
          h('span', { text: wv + '×' + rv }),
        ])
      );
    });
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

    // 1) Khách hàng — chọn mặc định nếu lựa chọn cũ không còn (ưu tiên khách có buổi HÔM NAY).
    const clients = uniqueClients(sessions);
    const today = todayISO();
    if (!clients.includes(_nav.client)) {
      _nav.client = clientWithSessionOn(sessions, clients, today) || clients[0];
    }

    // 2) Ngày của khách đã chọn (ưu tiên HÔM NAY nếu có).
    const dates = datesForClient(sessions, _nav.client);
    if (!dates.includes(_nav.date)) {
      _nav.date = dates.includes(today) ? today : dates[0] || null;
    }

    // 3) Buổi của khách + ngày.
    const daySessions = sessionsForClientDate(sessions, _nav.client, _nav.date);
    const sessionIds = daySessions.map((s) => s.sessionId);
    if (!sessionIds.includes(_nav.sessionId)) _nav.sessionId = sessionIds[0] || null;

    // --- Thanh chọn gọn ---
    const toolbar = h('div', { class: 'mwl-toolbar' }, []);

    // Ô tìm khách khi danh sách đông (mục 7).
    if (clients.length > 6) {
      toolbar.appendChild(
        h('div', { class: 'mwl-searchrow' }, [
          h('input', { class: 'mwl-client-search', type: 'text', placeholder: '🔍 Tìm khách…' }),
        ])
      );
    }

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

    // Nút bật/tắt chế độ tập trung 1 bài (mục 8).
    toolbar.appendChild(
      h('div', { class: 'mwl-focusrow' }, [
        h('button', {
          type: 'button',
          class: 'mwl-focus-toggle' + (_focus ? ' is-active' : ''),
          text: _focus ? '🎯 Đang tập trung — xem tất cả' : '🎯 Tập trung 1 bài',
        }),
      ])
    );

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

    // Nạp "Lần trước" (bất đồng bộ, không chặn render).
    if (selected) injectHistory(selected);

    // --- Thanh "Lưu & đồng bộ" (dính đáy) ---
    const savebar = h('div', { class: 'mwl-savebar' }, [
      h('button', { type: 'button', class: 'mwl-undo-btn', title: 'Hoàn tác', text: '↶' }),
      h('button', { type: 'button', class: 'mwl-save-btn', text: '💾 Lưu & đồng bộ' }),
      h('span', { class: 'mwl-save-state', text: '' }),
    ]);
    container.appendChild(savebar);
    refreshSaveStateFromSync();
    updateUndoBtn();

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
