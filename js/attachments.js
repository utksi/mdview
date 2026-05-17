/* ============================================================
   attachments.js — in-memory image attachments
     - Add via file picker, drag-drop, or clipboard paste
     - Each attachment gets a stable filename (collisions resolved)
       and a session-scoped object URL
     - Markdown references like ![alt](./name.png) or (name.png) are
       rewritten on render to point at the object URL
     - On download, every attachment is downloaded alongside the .md
   ============================================================ */
(function () {
  'use strict';

  const items = [];          // [{ name, type, size, blob, url }]
  const listeners = [];

  function notify() {
    listeners.forEach(function (cb) { try { cb(); } catch (_) {} });
  }
  function onChange(cb) { listeners.push(cb); }

  function list() { return items.slice(); }
  function count() { return items.length; }

  function find(name) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].name === name) return items[i];
    }
    return null;
  }

  function uniqueName(name) {
    if (!find(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext  = dot > 0 ? name.slice(dot)    : '';
    let i = 2;
    while (find(base + '_' + i + ext)) i++;
    return base + '_' + i + ext;
  }

  function sanitizeFilename(raw) {
    let name = String(raw || 'image');
    name = name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim();
    if (!name) name = 'image';
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
      name += '.png';
    }
    return name;
  }

  /* Add a Blob/File. Returns the stored item. */
  function add(file, suggestedName) {
    const raw = suggestedName || (file && file.name) || 'image';
    const name = uniqueName(sanitizeFilename(raw));
    const blob = file instanceof Blob ? file : new Blob([file]);
    const item = {
      name: name,
      type: (file && file.type) || blob.type || 'image/png',
      size: blob.size,
      blob: blob,
      url:  URL.createObjectURL(blob),
      added: Date.now()
    };
    items.push(item);
    notify();
    return item;
  }

  function remove(name) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].name === name) {
        try { URL.revokeObjectURL(items[i].url); } catch (_) {}
        items.splice(i, 1);
        notify();
        return true;
      }
    }
    return false;
  }

  function clear() {
    while (items.length) {
      try { URL.revokeObjectURL(items[0].url); } catch (_) {}
      items.shift();
    }
    notify();
  }

  /* Walk the rendered preview tree and rewrite <img> src/srcset that
     reference attachments by relative name. */
  function rewriteImageSrcs(root) {
    if (!root) return;
    const imgs = root.querySelectorAll('img[src]');
    imgs.forEach(function (img) {
      const original = img.getAttribute('data-mdv-orig-src') || img.getAttribute('src');
      if (!img.getAttribute('data-mdv-orig-src')) {
        img.setAttribute('data-mdv-orig-src', original);
      }
      const resolved = resolveRef(original);
      if (resolved) {
        img.setAttribute('src', resolved);
        img.removeAttribute('srcset');
      } else if (img.getAttribute('src') !== original) {
        img.setAttribute('src', original);
      }
    });
  }

  /* If `ref` matches an attachment (either bare name or ./name),
     return its object URL. Otherwise return null. */
  function resolveRef(ref) {
    if (!ref) return null;
    // Don't touch absolute URLs, data: or blob:
    if (/^(https?:|data:|blob:|file:|mailto:|#)/i.test(ref)) return null;
    let name = ref;
    if (name.startsWith('./')) name = name.slice(2);
    // Strip any querystring or hash
    name = name.split(/[?#]/)[0];
    // Take just the basename
    const slash = name.lastIndexOf('/');
    if (slash >= 0) name = name.slice(slash + 1);
    const item = find(name);
    return item ? item.url : null;
  }

  /* Trigger sequential downloads of every attached image. Browsers may
     prompt for the first one or batch; we space them slightly. */
  function downloadAll(progressCb) {
    if (!items.length) return Promise.resolve(0);
    let i = 0;
    function next() {
      if (i >= items.length) return Promise.resolve(items.length);
      const item = items[i++];
      const a = document.createElement('a');
      a.href = item.url;
      a.download = item.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (progressCb) try { progressCb(i, items.length); } catch (_) {}
      return new Promise(function (res) { setTimeout(res, 220); }).then(next);
    }
    return next();
  }

  /* Suggest a markdown reference string for the given attachment. */
  function referenceFor(name) {
    return '![' + name.replace(/\.[^.]+$/, '') + '](./' + name + ')';
  }

  window.MdvAttachments = {
    add: add,
    remove: remove,
    clear: clear,
    list: list,
    count: count,
    find: find,
    onChange: onChange,
    rewriteImageSrcs: rewriteImageSrcs,
    referenceFor: referenceFor,
    downloadAll: downloadAll
  };
})();
