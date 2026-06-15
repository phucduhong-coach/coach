'use strict';

// Feature: mobile-workout-logger
// pwa/rest-timer.js — Đồng hồ nghỉ tự động giữa các set.
// Web/JS thuần, KHÔNG bước build, KHÔNG thư viện ngoài. Chỉ chạy trong trình duyệt
// (guard qua document); node --check vẫn xanh.
//
// Khi HLV đánh dấu xong một set, logger-ui gọi MWLRestTimer.start(seconds) để đếm
// ngược đúng thời gian "Nghỉ" đã kê đơn, kèm rung + tiếng bíp khi hết giờ.
//
// API: window.MWLRestTimer = { start(seconds, label?), stop(), parseRest(str), _format(s) }

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

  let _timer = null;
  let _remaining = 0;
  let _bar = null;
  let _audioCtx = null;

  // parseRest("1:30" | "90" | "1'" | "1'30" | "1m30s" | 90) → số giây, hoặc null.
  function parseRest(input) {
    if (input == null || input === '') return null;
    if (typeof input === 'number' && Number.isFinite(input)) return input > 0 ? Math.round(input) : null;
    const s = String(input).trim().toLowerCase();
    if (s === '') return null;
    // dạng mm:ss
    let m = /^(\d+):(\d{1,2})$/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    // dạng 1'30 hoặc 1' 30 (phút có dấu phẩy/nháy)
    m = /^(\d+)\s*['′]\s*(\d{1,2})?$/.exec(s);
    if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
    // dạng 1m30s, 1m, 30s
    m = /^(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/.exec(s);
    if (m && (m[1] || m[2])) return (Number(m[1]) || 0) * 60 + (Number(m[2]) || 0);
    // số thuần (giây)
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
    return null;
  }

  function _format(sec) {
    const s = Math.max(0, Math.round(sec));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function vibrate(pattern) {
    try {
      if (g && g.navigator && typeof g.navigator.vibrate === 'function') g.navigator.vibrate(pattern);
    } catch (_) {
      /* best-effort */
    }
  }

  // Bíp ngắn bằng WebAudio (không cần file âm thanh).
  function beep() {
    try {
      const AC = g && (g.AudioContext || g.webkitAudioContext);
      if (!AC) return;
      if (!_audioCtx) _audioCtx = new AC();
      const ctx = _audioCtx;
      const t0 = ctx.currentTime;
      [0, 0.18].forEach((off) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, t0 + off);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + off + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + off);
        osc.stop(t0 + off + 0.16);
      });
    } catch (_) {
      /* bỏ qua nếu trình duyệt chặn audio */
    }
  }

  function ensureBar() {
    const d = doc();
    if (!d) return null;
    if (_bar && _bar.parentNode) return _bar;
    const bar = d.createElement('div');
    bar.className = 'mwl-rest-bar';
    bar.innerHTML =
      '<button type="button" class="mwl-rest-adj" data-adj="-15">−15</button>' +
      '<div class="mwl-rest-mid"><span class="mwl-rest-label">Nghỉ</span>' +
      '<span class="mwl-rest-time">0:00</span></div>' +
      '<button type="button" class="mwl-rest-adj" data-adj="15">+15</button>' +
      '<button type="button" class="mwl-rest-skip" aria-label="Bỏ qua nghỉ">✕</button>';
    bar.addEventListener('click', function (ev) {
      const t = ev.target;
      if (!t) return;
      if (t.classList.contains('mwl-rest-skip')) {
        stop();
        return;
      }
      if (t.classList.contains('mwl-rest-adj')) {
        const delta = Number(t.getAttribute('data-adj')) || 0;
        _remaining = Math.max(0, _remaining + delta);
        paint();
      }
    });
    (d.body || d.documentElement).appendChild(bar);
    _bar = bar;
    return bar;
  }

  function paint() {
    if (!_bar) return;
    const timeEl = _bar.querySelector('.mwl-rest-time');
    if (timeEl) timeEl.textContent = _format(_remaining);
    _bar.classList.toggle('is-low', _remaining <= 5 && _remaining > 0);
  }

  function tick() {
    _remaining -= 1;
    if (_remaining <= 0) {
      paint();
      beep();
      vibrate([200, 80, 200]);
      finish();
      return;
    }
    paint();
  }

  function finish() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
    if (_bar) {
      _bar.classList.add('is-done');
      const lbl = _bar.querySelector('.mwl-rest-label');
      if (lbl) lbl.textContent = 'Hết nghỉ!';
      const self = _bar;
      setTimeout(function () {
        if (self && self.parentNode && self === _bar) stop();
      }, 2500);
    }
  }

  // start(seconds, label?) — bắt đầu đếm ngược. seconds<=0/không hợp lệ ⇒ bỏ qua.
  function start(seconds, label) {
    const sec = Number(seconds);
    if (!Number.isFinite(sec) || sec <= 0) return false;
    const bar = ensureBar();
    if (!bar) return false;
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
    _remaining = Math.round(sec);
    bar.classList.remove('is-done');
    bar.classList.add('is-active');
    const lbl = bar.querySelector('.mwl-rest-label');
    if (lbl) lbl.textContent = label || 'Nghỉ';
    paint();
    vibrate(30);
    const setI = (g && g.setInterval) || setInterval;
    _timer = setI(tick, 1000);
    return true;
  }

  function stop() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
    _remaining = 0;
    if (_bar && _bar.parentNode) {
      _bar.parentNode.removeChild(_bar);
    }
    _bar = null;
  }

  const api = { start, stop, parseRest, _format };
  if (g) g.MWLRestTimer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
