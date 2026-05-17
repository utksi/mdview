/* ============================================================
   sync.js — synchronized scroll, selection mirroring,
             scroll-to-top floating buttons
   ============================================================ */
(function () {
  'use strict';

  function create(opts) {
    const cm = opts.editor;
    const previewScroll = opts.previewScroll;
    const previewRoot   = opts.previewRoot;

    let sourceMap = [];
    let lock = null;
    let scrollEnabled = true;
    let active = true;
    let lastProgrammaticSel = 0;

    /* ---------- source-line map ---------- */
    function rebuild() {
      sourceMap.length = 0;
      const els = previewRoot.querySelectorAll('[data-source-line]');
      els.forEach(function (el) {
        const n = parseInt(el.getAttribute('data-source-line'), 10);
        if (!Number.isFinite(n)) return;
        sourceMap.push({ line: n, el: el });
      });
      sourceMap.sort(function (a, b) { return a.line - b.line; });
      cacheOffsets();
      updateTopButtons();
    }

    function cacheOffsets() {
      const baseTop = previewScroll.getBoundingClientRect().top;
      for (let i = 0; i < sourceMap.length; i++) {
        const r = sourceMap[i].el.getBoundingClientRect();
        sourceMap[i].top = r.top - baseTop + previewScroll.scrollTop;
        sourceMap[i].height = r.height;
      }
    }

    function findPair(line) {
      if (!sourceMap.length) return null;
      let prev = sourceMap[0];
      let next = sourceMap[sourceMap.length - 1];
      for (let i = 0; i < sourceMap.length; i++) {
        if (sourceMap[i].line <= line) prev = sourceMap[i];
        if (sourceMap[i].line > line) { next = sourceMap[i]; break; }
      }
      return { prev: prev, next: next };
    }

    function editorTopLine() {
      const info = cm.getScrollInfo();
      const top = info.top;
      const lineH = cm.defaultTextHeight();
      const topLine = cm.lineAtHeight(top, 'local');
      const lineTop = cm.heightAtLine(topLine, 'local');
      const frac = Math.min(0.999, Math.max(0, (top - lineTop) / lineH));
      return topLine + frac;
    }

    /* ---------- sync scroll ---------- */
    function syncFromEditor() {
      if (!scrollEnabled || !active) return;
      if (lock === 'preview') return;
      if (!sourceMap.length) return;

      const line = editorTopLine();
      const pair = findPair(line);
      if (!pair) return;
      let target;
      if (pair.prev === pair.next || pair.prev.line >= line) {
        target = pair.prev.top;
      } else {
        const range = pair.next.line - pair.prev.line || 1;
        const progress = (line - pair.prev.line) / range;
        target = pair.prev.top + (pair.next.top - pair.prev.top) * progress;
      }
      lock = 'editor';
      previewScroll.scrollTop = target;
      requestAnimationFrame(function () { lock = null; });
    }

    function syncFromPreview() {
      if (!scrollEnabled || !active) return;
      if (lock === 'editor') return;
      if (!sourceMap.length) return;

      const scrollTop = previewScroll.scrollTop;
      let prev = sourceMap[0], next = sourceMap[sourceMap.length - 1];
      for (let i = 0; i < sourceMap.length; i++) {
        if (sourceMap[i].top <= scrollTop) prev = sourceMap[i];
        if (sourceMap[i].top > scrollTop)  { next = sourceMap[i]; break; }
      }
      let line;
      if (prev === next || prev.top >= scrollTop) {
        line = prev.line;
      } else {
        const range = next.top - prev.top || 1;
        const progress = (scrollTop - prev.top) / range;
        const lineRange = next.line - prev.line || 1;
        line = prev.line + lineRange * progress;
      }
      const targetTop = cm.heightAtLine(Math.floor(line), 'local') +
                        (line - Math.floor(line)) * cm.defaultTextHeight();
      lock = 'preview';
      cm.scrollTo(null, targetTop);
      requestAnimationFrame(function () { lock = null; });
    }

    /* ---------- selection mirroring ---------- */
    function mirrorEditorToPreview() {
      if (!active) { clearPreviewHighlights(); return; }

      /* If the user has an active selection inside the preview, don't add
         our line-range highlight — the browser's native selection already
         marks the relevant area, and our highlight would persist after the
         user double-clicks a word. */
      const docSel = window.getSelection();
      if (docSel && docSel.rangeCount && !docSel.isCollapsed) {
        const ancestor = docSel.getRangeAt(0).commonAncestorContainer;
        if (ancestor && previewRoot.contains(ancestor)) {
          clearPreviewHighlights();
          return;
        }
      }

      /* Skip mirroring back when we just set the editor selection
         programmatically (preview->editor mirror). */
      const now = (window.performance || Date).now();
      if (now - lastProgrammaticSel < 300) {
        clearPreviewHighlights();
        return;
      }

      const sel = cm.listSelections()[0];
      if (!sel) return;
      const aIdx = cm.indexFromPos(sel.anchor);
      const hIdx = cm.indexFromPos(sel.head);
      if (aIdx === hIdx) { clearPreviewHighlights(); return; }
      const from = aIdx < hIdx ? sel.anchor : sel.head;
      const to   = aIdx < hIdx ? sel.head   : sel.anchor;
      highlightPreviewRange(from.line, to.line);
    }

    function clearPreviewHighlights() {
      previewRoot.querySelectorAll('.source-line-active')
        .forEach(function (el) { el.classList.remove('source-line-active'); });
    }

    function highlightPreviewRange(lineStart, lineEnd) {
      clearPreviewHighlights();
      if (!sourceMap.length) return;
      let firstIdx = -1, lastIdx = -1;
      for (let i = 0; i < sourceMap.length; i++) {
        const l = sourceMap[i].line;
        if (l <= lineEnd) lastIdx = i;
        if (firstIdx === -1 && l >= lineStart) firstIdx = i;
      }
      if (firstIdx === -1) firstIdx = lastIdx;
      if (firstIdx > 0 && sourceMap[firstIdx].line > lineStart) firstIdx--;
      for (let i = firstIdx; i <= lastIdx && i < sourceMap.length; i++) {
        sourceMap[i].el.classList.add('source-line-active');
      }
    }

    function mirrorPreviewToEditor() {
      if (!active) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!previewRoot.contains(range.startContainer) ||
          !previewRoot.contains(range.endContainer)) return;
      const startLine = findContainingLine(range.startContainer);
      const endLine   = findContainingLine(range.endContainer);
      if (startLine == null && endLine == null) return;
      const a = startLine != null ? startLine : endLine;
      const b = endLine   != null ? endLine   : startLine;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const hiLineLen = cm.getLine(hi) ? cm.getLine(hi).length : 0;
      lastProgrammaticSel = (window.performance || Date).now();
      cm.setSelection(
        { line: lo, ch: 0 },
        { line: hi, ch: hiLineLen },
        { scroll: false }
      );
    }

    function findContainingLine(node) {
      while (node && node !== previewRoot) {
        if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-source-line')) {
          const n = parseInt(node.getAttribute('data-source-line'), 10);
          if (Number.isFinite(n)) return n;
        }
        node = node.parentNode;
      }
      return null;
    }

    /* ---------- scroll-to-top buttons (per pane) ---------- */
    const SCROLL_TOP_THRESHOLD = 80;
    let topEditor, topPreview;

    function installTopButtons() {
      const editorPane  = document.querySelector('.pane--editor');
      const previewPane = document.querySelector('.pane--preview');
      if (editorPane && !editorPane.querySelector('.scroll-top')) {
        topEditor = document.createElement('button');
        topEditor.type = 'button';
        topEditor.className = 'scroll-top';
        topEditor.setAttribute('aria-label', 'Scroll editor to top');
        topEditor.title = 'Scroll editor to top';
        topEditor.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/></svg>';
        topEditor.addEventListener('click', function () {
          cm.scrollTo(null, 0);
          if (scrollEnabled && active) previewScroll.scrollTo({ top: 0, behavior: 'smooth' });
          updateTopButtons();
        });
        editorPane.appendChild(topEditor);
      }
      if (previewPane && !previewPane.querySelector('.scroll-top')) {
        topPreview = document.createElement('button');
        topPreview.type = 'button';
        topPreview.className = 'scroll-top';
        topPreview.setAttribute('aria-label', 'Scroll preview to top');
        topPreview.title = 'Scroll preview to top';
        topPreview.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/></svg>';
        topPreview.addEventListener('click', function () {
          previewScroll.scrollTo({ top: 0, behavior: 'smooth' });
          if (scrollEnabled && active) cm.scrollTo(null, 0);
          updateTopButtons();
        });
        previewPane.appendChild(topPreview);
      }
    }

    function updateTopButtons() {
      try {
        const info = cm.getScrollInfo ? cm.getScrollInfo() : { top: 0 };
        const editorAt = (info && info.top || 0) > SCROLL_TOP_THRESHOLD;
        const previewAt = previewScroll.scrollTop > SCROLL_TOP_THRESHOLD;
        if (topEditor)  topEditor.classList.toggle('is-show',  editorAt);
        if (topPreview) topPreview.classList.toggle('is-show', previewAt);
      } catch (_) { /* ignore */ }
    }

    /* ---------- wiring ---------- */
    /* Always call updateTopButtons on scroll regardless of sync state. */
    cm.on('scroll', throttleRaf(function () {
      syncFromEditor();
      updateTopButtons();
    }));
    cm.on('cursorActivity', debounce(mirrorEditorToPreview, 80));

    previewScroll.addEventListener('scroll', throttleRaf(function () {
      syncFromPreview();
      updateTopButtons();
    }), { passive: true });

    document.addEventListener('selectionchange', debounce(function () {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      if (!anchor || !previewRoot.contains(anchor)) return;
      mirrorPreviewToEditor();
    }, 80));

    let resizeQueued = false;
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(function () {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(function () {
          resizeQueued = false;
          cacheOffsets();
          updateTopButtons();
        });
      });
      ro.observe(previewRoot);
    }

    installTopButtons();
    setTimeout(updateTopButtons, 100);

    function throttleRaf(fn) {
      let queued = false;
      return function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; fn(); });
      };
    }
    function debounce(fn, ms) {
      let t;
      return function () {
        clearTimeout(t);
        const args = arguments, self = this;
        t = setTimeout(function () { fn.apply(self, args); }, ms);
      };
    }

    return {
      rebuild: rebuild,
      cacheOffsets: cacheOffsets,
      clearHighlights: clearPreviewHighlights,
      mirrorEditorToPreview: mirrorEditorToPreview,
      updateTopButtons: updateTopButtons,
      setEnabled: function (v) { scrollEnabled = !!v; },
      setActive:  function (v) {
        active = !!v;
        if (!active) clearPreviewHighlights();
        updateTopButtons();
      },
      isEnabled: function () { return scrollEnabled; }
    };
  }

  window.MdvSync = { create: create };
})();
