/* ============================================================
   sync.js — synchronized scroll and selection between
             the CodeMirror editor and the rendered preview
   ============================================================ */
(function () {
  'use strict';

  function create(opts) {
    const cm = opts.editor;
    const previewScroll = opts.previewScroll; // scroll container
    const previewRoot   = opts.previewRoot;   // .markdown-body
    const onActivePreviewLine = opts.onActivePreviewLine || function () {};

    let sourceMap = []; // array of {line, top, el} sorted by line
    let lock = null;    // 'editor' | 'preview' | null — prevents feedback
    let enabled = true;
    let active = true; // disabled when workspace mode is editor/preview only

    /* Build the line->element table after each render. */
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
      const baseTop = previewRoot.getBoundingClientRect().top -
                      previewScroll.getBoundingClientRect().top +
                      previewScroll.scrollTop;
      for (let i = 0; i < sourceMap.length; i++) {
        const r = sourceMap[i].el.getBoundingClientRect();
        const top = r.top - previewScroll.getBoundingClientRect().top + previewScroll.scrollTop;
        sourceMap[i].top = top;
        sourceMap[i].height = r.height;
      }
    }

    /* Find {prev, next} pair surrounding a line. */
    function findPair(line) {
      if (!sourceMap.length) return null;
      let prev = sourceMap[0];
      let next = sourceMap[sourceMap.length - 1];
      // Binary search would be faster on huge docs, linear is fine for typical use.
      for (let i = 0; i < sourceMap.length; i++) {
        if (sourceMap[i].line <= line) prev = sourceMap[i];
        if (sourceMap[i].line > line) { next = sourceMap[i]; break; }
      }
      return { prev: prev, next: next };
    }

    /* Get the smoothed editor scroll line at the very top of the viewport,
       including fractional offset for sub-line precision. */
    function editorTopLine() {
      const info = cm.getScrollInfo();
      const top = info.top;
      const lineH = cm.defaultTextHeight();
      const topLine = cm.lineAtHeight(top, 'local');
      // Compute offset within the top line (0..1)
      const lineTop = cm.heightAtLine(topLine, 'local');
      const frac = Math.min(0.999, Math.max(0, (top - lineTop) / lineH));
      return topLine + frac;
    }

    /* Editor -> Preview */
    function syncFromEditor() {
      if (!enabled || !active) return;
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

    /* Preview -> Editor */
    function syncFromPreview() {
      if (!enabled || !active) return;
      if (lock === 'editor') return;
      if (!sourceMap.length) return;

      const scrollTop = previewScroll.scrollTop;
      // Find pair where prev.top <= scrollTop < next.top
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
      onActivePreviewLine(Math.round(line));
    }

    /* Selection mirroring */

    /* When editor selection changes, highlight the corresponding rendered
       elements. We don't programmatically apply a selection to the preview
       (that's both fragile and intrusive) — we apply a highlight class. */
    function mirrorEditorToPreview() {
      if (!active) { clearPreviewHighlights(); return; }
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
      // Inclusive: any source-line element whose line is in [lineStart, lineEnd+1)
      // Plus the prev element if its line is <= lineStart and the next is > lineStart
      let firstIdx = -1, lastIdx = -1;
      for (let i = 0; i < sourceMap.length; i++) {
        const l = sourceMap[i].line;
        if (l <= lineEnd) lastIdx = i;
        if (firstIdx === -1 && sourceMap[i].line >= lineStart) firstIdx = i;
      }
      if (firstIdx === -1) firstIdx = lastIdx;
      // Include the element just above lineStart (covers the case where
      // the selection starts inside a multi-line block).
      if (firstIdx > 0 && sourceMap[firstIdx].line > lineStart) firstIdx--;
      for (let i = firstIdx; i <= lastIdx && i < sourceMap.length; i++) {
        sourceMap[i].el.classList.add('source-line-active');
      }
    }

    /* When preview selection changes, mirror that to editor by selecting
       the corresponding line range in the editor. */
    function mirrorPreviewToEditor() {
      if (!active) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      // Confirm selection is inside preview
      if (!previewRoot.contains(range.startContainer) ||
          !previewRoot.contains(range.endContainer)) return;
      const startLine = findContainingLine(range.startContainer);
      const endLine   = findContainingLine(range.endContainer);
      if (startLine == null && endLine == null) return;
      const a = startLine != null ? startLine : endLine;
      const b = endLine   != null ? endLine   : startLine;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const hiLineLen = cm.getLine(hi) ? cm.getLine(hi).length : 0;
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

    /* Wiring */
    cm.on('scroll', throttleRaf(syncFromEditor));
    cm.on('cursorActivity', debounce(mirrorEditorToPreview, 80));

    previewScroll.addEventListener('scroll', throttleRaf(syncFromPreview), { passive: true });

    // Preview selection: fire on mouseup/keyup (within preview)
    previewRoot.addEventListener('mouseup', debounce(mirrorPreviewToEditor, 50));
    previewRoot.addEventListener('keyup', debounce(mirrorPreviewToEditor, 50));

    // When the window resizes or preview reflows, recache offsets.
    let resizeQueued = false;
    const ro = new ResizeObserver(function () {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(function () { resizeQueued = false; cacheOffsets(); });
    });
    ro.observe(previewRoot);

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
      setEnabled: function (v) { enabled = !!v; },
      setActive:  function (v) {
        active = !!v;
        if (!active) clearPreviewHighlights();
      },
      isEnabled: function () { return enabled; }
    };
  }

  window.MdvSync = { create: create };
})();
