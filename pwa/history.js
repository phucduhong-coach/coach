'use strict';

// Feature: mobile-workout-logger
// pwa/history.js — Tra kết quả buổi GẦN NHẤT trước đó của một khách, theo từng bài,
// để hiển thị "Lần trước: <kg> × <reps>" giúp HLV tăng tiến.
// Web/JS thuần. Phần chọn set "tốt nhất" là hàm THUẦN (test được); phần đọc Drive guard.
//
// API: window.MWLHistory = {
//   getLastResults(clientId, beforeDate, opts?) → Promise<{ byEntry, byName }>,
//   bestSetOf(sets), clearCache()
// }

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

  const _cache = new Map(); // key: clientId|beforeDate → { byEntry, byName }

  function num(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // bestSetOf(sets) → set "nặng nhất, rồi nhiều reps nhất" có dữ liệu; null nếu không.
  function bestSetOf(sets) {
    const list = Array.isArray(sets) ? sets : [];
    let best = null;
    let bestScore = -1;
    for (const s of list) {
      if (!s) continue;
      const w = num(s.weight);
      const r = num(s.reps);
      if (w == null && r == null) continue;
      const score = (w || 0) * 1000 + (r || 0);
      if (score > bestScore) {
        bestScore = score;
        best = { weight: w, reps: r };
      }
    }
    return best;
  }

  // Định dạng "35kg × 10" / "× 10" / "35kg".
  function formatResult(res) {
    if (!res) return '';
    const w = res.weight;
    const r = res.reps;
    if (w != null && r != null) return w + 'kg × ' + r;
    if (w != null) return w + 'kg';
    if (r != null) return '× ' + r;
    return '';
  }

  // Lọc tên file logs khớp client + ngày < beforeDate; trả tên ngày gần nhất.
  function pickLatestPriorLog(files, clientId, beforeDate) {
    const prefix = clientId + '__';
    let best = null; // { name, date }
    for (const f of files) {
      const name = f && f.name ? String(f.name) : '';
      if (name.indexOf(prefix) !== 0) continue;
      const m = /__(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
      if (!m) continue;
      const date = m[1];
      if (beforeDate && date >= beforeDate) continue; // chỉ buổi TRƯỚC ngày đang ghi
      if (!best || date > best.date) best = { name, date, id: f.id };
    }
    return best;
  }

  // getLastResults(clientId, beforeDate, opts?) → { byEntry:{entryId:res}, byName:{name:res}, date }
  // Đọc nhật ký buổi gần nhất TRƯỚC beforeDate của khách. Lỗi/offline ⇒ {} (không chặn UI).
  async function getLastResults(clientId, beforeDate, opts) {
    if (!clientId) return { byEntry: {}, byName: {}, date: null };
    const cacheKey = clientId + '|' + (beforeDate || '');
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);

    const drive = (opts && opts.drive) || (g && g.MWLDrive) || null;
    const empty = { byEntry: {}, byName: {}, date: null };
    if (!drive || typeof drive.listLogFiles !== 'function' || typeof drive.readJson !== 'function') {
      return empty;
    }
    // Chỉ thử khi online (tránh treo khi mất mạng).
    const online = !(g && g.navigator && typeof g.navigator.onLine === 'boolean') || g.navigator.onLine;
    if (!online) return empty;

    try {
      const files = await drive.listLogFiles();
      const pick = pickLatestPriorLog(files || [], clientId, beforeDate);
      if (!pick) {
        _cache.set(cacheKey, empty);
        return empty;
      }
      const res = await drive.readJson('logs/' + pick.name);
      const log = res && res.data ? res.data : null;
      const out = { byEntry: {}, byName: {}, date: pick.date };
      const entries = log && Array.isArray(log.entries) ? log.entries : [];
      for (const e of entries) {
        if (!e) continue;
        const best = bestSetOf(e.sets);
        if (!best) continue;
        if (e.entryId != null) out.byEntry[e.entryId] = best;
        if (e.name) out.byName[String(e.name).trim().toLowerCase()] = best;
      }
      _cache.set(cacheKey, out);
      return out;
    } catch (_) {
      return empty;
    }
  }

  function clearCache() {
    _cache.clear();
  }

  // epley1RM(weight, reps) → ước tính 1RM theo công thức Epley: w*(1+reps/30).
  function epley1RM(weight, reps) {
    const w = num(weight);
    const r = num(reps);
    if (w == null || w <= 0) return null;
    if (r == null || r <= 1) return w;
    return Math.round(w * (1 + r / 30) * 10) / 10;
  }

  const _seriesCache = new Map();

  // getClientHistory(clientId, beforeDate, opts?) → đọc tối đa N buổi gần nhất TRƯỚC
  // beforeDate; trả { byEntry:{entryId:{last,series}}, byName:{...} } với
  //   last  = {weight,reps} buổi gần nhất, series = [{date,weight,reps}] tăng dần.
  // Lỗi/offline ⇒ rỗng. Dùng cho "Lần trước" + biểu đồ tiến bộ mini.
  async function getClientHistory(clientId, beforeDate, opts) {
    const empty = { byEntry: {}, byName: {} };
    if (!clientId) return empty;
    const N = (opts && opts.limit) || 8;
    const cacheKey = clientId + '|' + (beforeDate || '') + '|' + N;
    if (_seriesCache.has(cacheKey)) return _seriesCache.get(cacheKey);

    const drive = (opts && opts.drive) || (g && g.MWLDrive) || null;
    if (!drive || typeof drive.listLogFiles !== 'function' || typeof drive.readJson !== 'function') return empty;
    const online = !(g && g.navigator && typeof g.navigator.onLine === 'boolean') || g.navigator.onLine;
    if (!online) return empty;

    try {
      const files = await drive.listLogFiles();
      const prefix = clientId + '__';
      const dated = [];
      for (const f of files || []) {
        const name = f && f.name ? String(f.name) : '';
        if (name.indexOf(prefix) !== 0) continue;
        const m = /__(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
        if (!m) continue;
        if (beforeDate && m[1] >= beforeDate) continue;
        dated.push({ name, date: m[1] });
      }
      dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const recent = dated.slice(-N); // N buổi gần nhất, tăng dần theo ngày

      const out = { byEntry: {}, byName: {} };
      for (const d of recent) {
        // eslint-disable-next-line no-await-in-loop
        const res = await drive.readJson('logs/' + d.name);
        const log = res && res.data ? res.data : null;
        const entries = log && Array.isArray(log.entries) ? log.entries : [];
        for (const e of entries) {
          if (!e) continue;
          const best = bestSetOf(e.sets);
          if (!best) continue;
          const point = { date: d.date, weight: best.weight, reps: best.reps };
          if (e.entryId != null) {
            if (!out.byEntry[e.entryId]) out.byEntry[e.entryId] = { last: null, series: [] };
            out.byEntry[e.entryId].series.push(point);
            out.byEntry[e.entryId].last = best;
          }
          if (e.name) {
            const key = String(e.name).trim().toLowerCase();
            if (!out.byName[key]) out.byName[key] = { last: null, series: [] };
            out.byName[key].series.push(point);
            out.byName[key].last = best;
          }
        }
      }
      _seriesCache.set(cacheKey, out);
      return out;
    } catch (_) {
      return empty;
    }
  }

  function clearAllCache() {
    _cache.clear();
    _seriesCache.clear();
  }

  const api = {
    getLastResults,
    getClientHistory,
    bestSetOf,
    formatResult,
    pickLatestPriorLog,
    epley1RM,
    clearCache,
    clearAllCache,
  };
  if (g) g.MWLHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
