/* ============================================================
   storage.js — localStorage wrapper with safe fallbacks
   ============================================================ */
(function () {
  'use strict';

  const NS = 'mdview:v1';
  const MEM = Object.create(null);
  const hasLS = (function () {
    try {
      const k = '__mdview_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (_) { return false; }
  })();

  function key(k) { return NS + ':' + k; }

  function get(k, fallback) {
    try {
      const raw = hasLS ? localStorage.getItem(key(k)) : MEM[k];
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (_) { return fallback; }
  }

  function set(k, v) {
    let raw;
    try { raw = JSON.stringify(v); } catch (_) { return false; }
    try {
      if (hasLS) localStorage.setItem(key(k), raw);
      else MEM[k] = raw;
      return true;
    } catch (_) {
      // Quota exceeded - fall back to memory for this key
      MEM[k] = raw;
      return false;
    }
  }

  function remove(k) {
    try {
      if (hasLS) localStorage.removeItem(key(k));
      delete MEM[k];
    } catch (_) { /* ignore */ }
  }

  window.MdvStorage = { get: get, set: set, remove: remove, hasLS: hasLS };
})();
