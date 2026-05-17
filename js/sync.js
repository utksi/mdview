/* ============================================================
   sync.js — synchronized scroll, selection mirroring,
             scroll-to-top, click-to-navigate
   ============================================================ */
(function () {
  'use strict';

  function create(opts) {
    const cm = opts.editor;
    const previewScroll = opts.previewScroll;
    const previewRoot   = opts.previewRoot;

    let sourceMap = []; // [{line, top, el, height}], sorted by line
    let lock = null;    // 'editor' | 'preview' | null  (prevents feedback)
    let scrollEnabled = true;
    let active = true;          // off when in editor- or preview-only mode
    let clickNavigate = false;
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
      updateTopButtons();
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
      updateTopButtons();
    }

    /* ---------- selection mirroring ---------- */
    function mirrorEditorToPreview() {
      if (!active) { clearPreviewHighlights(); return; }

      /* If the user has an active selection inside the preview, the browser's
         native selection already highlights the relevant area; don't double
         up with our line-range class (and don't leave it lingering when the
         user double-clicks a word). Always clear stale highlights from a
         previous editor selection. */
      const docSel = window.getSelection();
      if (docSel && docSel.rangeCount && !docSel.isCollapsed) {
        const ancestor = docSel.getRangeAt(0).commonAncestorContainer;
        if (ancestor && previewRoot.contains(ancestor)) {
          clearPreviewHighlights();
          return;
        }
      }

      /* If the cursor activity we're reacting to was triggered by our own
         programmatic mirror (preview->editor), don't add the line highlight —
         the user is selecting the preview, not the editor. */
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

    /* ---------- click-to-navigate (double-click) ---------- */
    function scrollPreviewToLine(line) {
      cacheOffsets();
      if (!sourceMap.length) return;
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
      previewScroll.scrollTo({ top: Math.max(0, target - 20), behavior: 'smooth' });
      setTimeout(function () { lock = null; updateTopButtons(); }, 500);
    }

    function scrollEditorToLine(line) {
      const top = cm.heightAtLine(line, 'local');
      lock = 'preview';
      cm.scrollTo(null, Math.max(0, top - 20));
      setTimeout(function () { lock = null; updateTopButtons(); }, 500);
    }

    function onPreviewDblClick(e) {
      if (!clickNavigate) return;
      let node = e.target;
      while (node && node !== previewRoot) {
        if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-source-line')) {
          const line = parseInt(node.getAttribute('data-source-line'), 10);
          if (Number.isFinite(line)) {
            scrollEditorToLine(line);
            flashEditorLine(line);
            return;
          }
        }
        node = node.parentNode;
      }
    }

    function onEditorDblClick(e) {
      if (!clickNavigate) return;
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
      if (!pos || pos.line == null) return;
      scrollPreviewToLine(pos.line);
      flashPreviewLine(pos.line);
    }

    function flashEditorLine(line) {
      cm.addLineClass(line, 'background', 'mdv-line-flash');
      setTimeout(function () {
        cm.removeLineClass(line, 'background', 'mdv-line-flash');
      }, 900);
    }

    function flashPreviewLine(line) {
      const pair = findPair(line);
      if (!pair || !pair.prev || !pair.prev.el) return;
      const el = pair.prev.el;
      el.classList.add('mdv-block-flash');
      setTimeout(function () {
        el.classList.remove('mdv-block-flash');
      }, 900);
    }

    /* ---------- scroll-to-top buttons ---------- */
    let topEditor, topPreview;
    function installTopButtons() {
      const editorPane  = document.querySelector('.pane--editor');
      const previewPane = document.querySelector('.pane--preview');
      if (editorPane && !editorPane.querySelector('.scroll-top')) {
        topEditor = document.createElement('button');
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
      const editorAt = cm.getScrollInfo().top > 200;
      const previewAt = previewScroll.scrollTop > 200;
      if (topEditor)  topEditor.classList.toggle('is-show',  editorAt);
      if (topPreview) topPreview.classList.toggle('is-show', previewAt);
    }

    /* ---------- wiring ---------- */
    cm.on('scroll', throttleRaf(syncFromEditor));
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

    previewRoot.addEventListener('dblclick', onPreviewDblClick);
    cm.getWrapperElement().addEventListener('dblclick', onEditorDblClick);

    // Recache offsets when the preview reflows (image load, font load, etc.).
    let resizeQueued = false;
    const ro = new ResizeObserver(function () {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(function () { resizeQueued = false; cacheOffsets(); });
    });
    ro.observe(previewRoot);

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
      },
      setClickNavigate: function (v) { clickNavigate = !!v; },
      isEnabled: function () { return scrollEnabled; },
      isClickNavigate: function () { return clickNavigate; }
    };
  }

  window.MdvSync = { create: create };
})();
