'use strict';

// Feature: mobile-workout-logger
// pwa/plate-calc.js — Máy tính bánh tạ: nhập mức tạ mục tiêu → gợi ý xếp bánh mỗi bên.
// Web/JS thuần, KHÔNG bước build. Phần tính là hàm THUẦN (test được); phần UI guard DOM.
//
// API: window.MWLPlateCalc = { compute(target, bar, plates?), open(prefill?), _format }

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
  function doc() {
    return g && g.document ? g.document : null;
  }

  // Bánh tạ phổ biến (kg), giảm dần.
  const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  const DEFAULT_BAR = 20;

  // compute(target, bar, plates?) → { perSide:[{plate,count}], leftover, bar, target }
  // Tính tham lam số bánh mỗi bên cho (target - bar)/2.
  function compute(target, bar, plates) {
    const t = Number(target);
    const b = Number(bar);
    const list = (Array.isArray(plates) && plates.length ? plates.slice() : DEFAULT_PLATES.slice())
      .map(Number)
      .filter((x) => Number.isFinite(x) && x > 0)
      .sort((a, c) => c - a);
    if (!Number.isFinite(t) || !Number.isFinite(b) || t < b) {
      return { perSide: [], leftover: Number.isFinite(t) ? Math.max(0, t) : 0, bar: b || 0, target: t || 0 };
    }
    let perSideWeight = (t - b) / 2;
    const perSide = [];
    for (const p of list) {
      let count = 0;
      while (perSideWeight + 1e-9 >= p) {
        perSideWeight -= p;
        count += 1;
      }
      if (count > 0) perSide.push({ plate: p, count });
    }
    const leftover = Math.round(perSideWeight * 1000) / 1000; // phần dư không xếp được
    return { perSide, leftover, bar: b, target: t };
  }

  function _format(res) {
    if (!res || !res.perSide.length) return 'Không xếp được (tạ nhỏ hơn đòn).';
    const parts = res.perSide.map((x) => x.count + '×' + x.plate + 'kg');
    let s = 'Mỗi bên: ' + parts.join(' + ');
    if (res.leftover > 0) s += ' (dư ' + res.leftover + 'kg)';
    return s;
  }

  // --- UI modal đơn giản ---------------------------------------------------
  let _modal = null;

  function close() {
    if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal);
    _modal = null;
  }

  function render(target, bar) {
    if (!_modal) return;
    const res = compute(target, bar);
    const body = _modal.querySelector('.mwl-pc-result');
    if (!body) return;
    if (!res.perSide.length) {
      body.innerHTML = '<p class="mwl-pc-empty">Nhập mức tạ ≥ trọng lượng đòn (' + bar + 'kg).</p>';
      return;
    }
    const rows = res.perSide
      .map(
        (x) =>
          '<div class="mwl-pc-row"><span class="mwl-pc-count">' +
          x.count +
          ' ×</span><span class="mwl-pc-plate">' +
          x.plate +
          ' kg</span></div>'
      )
      .join('');
    body.innerHTML =
      '<div class="mwl-pc-headline">Mỗi bên đòn:</div>' +
      rows +
      (res.leftover > 0 ? '<div class="mwl-pc-leftover">Còn dư ' + res.leftover + ' kg</div>' : '');
  }

  // open(prefill?) — mở hộp thoại máy tính tạ; prefill = mức tạ gợi ý ban đầu.
  function open(prefill) {
    const d = doc();
    if (!d) return;
    close();
    const modal = d.createElement('div');
    modal.className = 'mwl-pc-modal';
    modal.innerHTML =
      '<div class="mwl-pc-card">' +
      '<div class="mwl-pc-head">🏋️ Máy tính bánh tạ<button type="button" class="mwl-pc-x" aria-label="Đóng">✕</button></div>' +
      '<div class="mwl-pc-inputs">' +
      '<label>Mức tạ (kg)<input type="text" inputmode="decimal" class="mwl-pc-target" value="' +
      (prefill != null && prefill !== '' ? String(prefill) : '') +
      '"></label>' +
      '<label>Đòn (kg)<input type="text" inputmode="decimal" class="mwl-pc-bar" value="' +
      DEFAULT_BAR +
      '"></label>' +
      '</div>' +
      '<div class="mwl-pc-result"></div>' +
      '</div>';
    const targetEl = modal.querySelector('.mwl-pc-target');
    const barEl = modal.querySelector('.mwl-pc-bar');
    const update = function () {
      render(targetEl.value, barEl.value);
    };
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal || (ev.target && ev.target.classList.contains('mwl-pc-x'))) close();
    });
    targetEl.addEventListener('input', update);
    barEl.addEventListener('input', update);
    (d.body || d.documentElement).appendChild(modal);
    _modal = modal;
    update();
    try {
      targetEl.focus();
    } catch (_) {
      /* noop */
    }
  }

  const api = { compute, open, close, _format, DEFAULT_PLATES, DEFAULT_BAR };
  if (g) g.MWLPlateCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
