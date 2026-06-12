'use strict';

// Feature: mobile-workout-logger
// Pure conflict-merge helpers for Nhật_Ký_Buổi_Tập (workout-log).
// No DOM, no I/O. Inputs are never mutated. CommonJS export via module.exports.
//
// Contract (design.md → pwa/merge.js, Sync & Conflict Flow, Properties 2/3/4):
//   mergeLogs(localLog, driveLog):
//     - Union entries by `entryId`, then sets by `setId`.
//     - A set present on only one side is KEPT (YC9.3, YC9.6).
//     - Same `setId` on both sides ⇒ keep the one with the newer `loggedAt` (YC9.4).
//     - Equal `loggedAt` + differing content ⇒ mark `conflict:true` and keep the
//       other side's values in `conflictWith` (YC9.5).
//     - rev = max(localLog.rev, driveLog.rev) + 1.
//   hasUnresolvedConflict(mergedLog) → boolean.

// Keys we add during merge; excluded when comparing the "content" of a set.
const MERGE_KEYS = ['conflict', 'conflictWith'];

// Deep clone of plain JSON-ish values (sets are flat, entries hold a sets array).
function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const k of Object.keys(value)) out[k] = clone(value[k]);
  return out;
}

// Canonical, order-independent string of a set's content (excludes merge keys).
// Used both to detect "differing content" and to pick a deterministic primary
// so the conflict outcome is identical for mergeLogs(A,B) and mergeLogs(B,A).
function canonicalContent(set) {
  const obj = {};
  for (const k of Object.keys(set)) {
    if (MERGE_KEYS.includes(k)) continue;
    obj[k] = set[k];
  }
  const keys = Object.keys(obj).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = obj[k];
  return JSON.stringify(ordered);
}

// A clean copy of a set's content with merge keys stripped (for conflictWith).
function cleanContent(set) {
  const out = {};
  for (const k of Object.keys(set)) {
    if (MERGE_KEYS.includes(k)) continue;
    out[k] = clone(set[k]);
  }
  return out;
}

// Compare loggedAt as ISO-8601 strings (lexicographic order == chronological).
// Returns >0 if a newer, <0 if b newer, 0 if equal/indeterminate.
function compareLoggedAt(a, b) {
  const la = a == null ? '' : String(a);
  const lb = b == null ? '' : String(b);
  if (la === lb) return 0;
  return la > lb ? 1 : -1;
}

// Merge two sets that share the same setId. Deterministic & order-independent.
function mergeSamePairSet(setA, setB) {
  const cmp = compareLoggedAt(setA.loggedAt, setB.loggedAt);
  if (cmp > 0) return cleanContent(setA); // A is newer
  if (cmp < 0) return cleanContent(setB); // B is newer

  // Equal loggedAt: compare content.
  const canonA = canonicalContent(setA);
  const canonB = canonicalContent(setB);
  if (canonA === canonB) {
    // Identical content ⇒ no conflict, keep a clean copy.
    return cleanContent(setA);
  }

  // Differing content with equal loggedAt ⇒ conflict.
  // Pick a deterministic primary via stable tiebreak on canonical content so the
  // recorded values (primary + conflictWith) are the same regardless of argument
  // order. This makes the conflict outcome order-independent (Property 4).
  let primary;
  let other;
  if (canonA <= canonB) {
    primary = setA;
    other = setB;
  } else {
    primary = setB;
    other = setA;
  }
  const merged = cleanContent(primary);
  merged.conflict = true;
  merged.conflictWith = cleanContent(other);
  return merged;
}

// Merge the `sets` arrays of two entries by setId.
function mergeSets(localSets, driveSets) {
  const localList = Array.isArray(localSets) ? localSets : [];
  const driveList = Array.isArray(driveSets) ? driveSets : [];

  const driveById = new Map();
  for (const s of driveList) {
    if (s && s.setId != null) driveById.set(s.setId, s);
  }
  const localById = new Map();
  for (const s of localList) {
    if (s && s.setId != null) localById.set(s.setId, s);
  }

  const result = [];
  const seen = new Set();

  // Local sets first (preserves a stable, predictable ordering).
  for (const localSet of localList) {
    if (!localSet || localSet.setId == null) continue;
    const id = localSet.setId;
    if (seen.has(id)) continue;
    seen.add(id);
    const driveSet = driveById.get(id);
    if (driveSet) {
      result.push(mergeSamePairSet(localSet, driveSet));
    } else {
      result.push(cleanContent(localSet)); // only on local ⇒ keep
    }
  }

  // Drive-only sets ⇒ keep (never dropped just because absent locally).
  for (const driveSet of driveList) {
    if (!driveSet || driveSet.setId == null) continue;
    const id = driveSet.setId;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(cleanContent(driveSet));
  }

  return result;
}

// Merge two entries that share the same entryId.
function mergeSameEntry(localEntry, driveEntry) {
  // Entry-level (non-set) fields: prefer local, fall back to drive. Set
  // membership/values come from mergeSets and are order-independent (Property 4).
  const merged = {};
  for (const k of Object.keys(driveEntry)) {
    if (k === 'sets') continue;
    merged[k] = clone(driveEntry[k]);
  }
  for (const k of Object.keys(localEntry)) {
    if (k === 'sets') continue;
    merged[k] = clone(localEntry[k]);
  }
  merged.sets = mergeSets(localEntry.sets, driveEntry.sets);
  return merged;
}

// Union entries by entryId, merging shared ones.
function mergeEntries(localEntries, driveEntries) {
  const localList = Array.isArray(localEntries) ? localEntries : [];
  const driveList = Array.isArray(driveEntries) ? driveEntries : [];

  const driveById = new Map();
  for (const e of driveList) {
    if (e && e.entryId != null) driveById.set(e.entryId, e);
  }

  const result = [];
  const seen = new Set();

  for (const localEntry of localList) {
    if (!localEntry || localEntry.entryId == null) continue;
    const id = localEntry.entryId;
    if (seen.has(id)) continue;
    seen.add(id);
    const driveEntry = driveById.get(id);
    if (driveEntry) {
      result.push(mergeSameEntry(localEntry, driveEntry));
    } else {
      const cloned = clone(localEntry);
      cloned.sets = mergeSets(localEntry.sets, []);
      result.push(cloned);
    }
  }

  for (const driveEntry of driveList) {
    if (!driveEntry || driveEntry.entryId == null) continue;
    const id = driveEntry.entryId;
    if (seen.has(id)) continue;
    seen.add(id);
    const cloned = clone(driveEntry);
    cloned.sets = mergeSets([], driveEntry.sets);
    result.push(cloned);
  }

  return result;
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Newer of two ISO strings (lexicographic == chronological); '' treated oldest.
function maxIso(a, b) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  return sa >= sb ? sa : sb;
}

/**
 * Merge a local workout-log with the Drive version without mutating either input.
 * @param {object} localLog
 * @param {object} driveLog
 * @returns {object} merged workout-log
 */
function mergeLogs(localLog, driveLog) {
  const local = localLog && typeof localLog === 'object' ? localLog : {};
  const drive = driveLog && typeof driveLog === 'object' ? driveLog : {};

  // Top-level identity fields: prefer local, fall back to drive.
  const merged = {};
  for (const k of Object.keys(drive)) {
    if (k === 'entries' || k === 'rev' || k === 'updatedAt') continue;
    merged[k] = clone(drive[k]);
  }
  for (const k of Object.keys(local)) {
    if (k === 'entries' || k === 'rev' || k === 'updatedAt') continue;
    merged[k] = clone(local[k]);
  }

  merged.entries = mergeEntries(local.entries, drive.entries);
  merged.rev = Math.max(asNumber(local.rev), asNumber(drive.rev)) + 1;

  // updatedAt: keep the newer of the two (deterministic & order-independent).
  const newest = maxIso(local.updatedAt, drive.updatedAt);
  if (newest !== '') merged.updatedAt = newest;

  return merged;
}

/**
 * @param {object} mergedLog
 * @returns {boolean} true if any set is flagged conflict === true.
 */
function hasUnresolvedConflict(mergedLog) {
  if (!mergedLog || typeof mergedLog !== 'object') return false;
  const entries = Array.isArray(mergedLog.entries) ? mergedLog.entries : [];
  for (const entry of entries) {
    const sets = entry && Array.isArray(entry.sets) ? entry.sets : [];
    for (const set of sets) {
      if (set && set.conflict === true) return true;
    }
  }
  return false;
}

const api = { mergeLogs, hasUnresolvedConflict };

// Phơi cho trình duyệt (window/self) theo quy ước script thuần của PWA.
// sync.js mong đợi global MWLMerge khi chạy trong trình duyệt.
(function exposeGlobal() {
  const g =
    (typeof self !== 'undefined' && self) ||
    (typeof window !== 'undefined' && window) ||
    (typeof globalThis !== 'undefined' && globalThis) ||
    null;
  if (g) {
    g.MWLMerge = api;
  }
})();

// Guarded CommonJS export để giữ test Node hiện có chạy được.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
