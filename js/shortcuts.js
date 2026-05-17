/* ============================================================
   shortcuts.js — global keyboard shortcuts
   These fire regardless of focus, except where noted.
   ============================================================ */
(function () {
  'use strict';

  function install(handlers) {
    function isMod(e) { return e.ctrlKey || e.metaKey; }

    function inEditableField(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
    }

    document.addEventListener('keydown', function (e) {
      const target = e.target;
      const inField = inEditableField(target);

      // Mod shortcuts
      if (isMod(e) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'o') {
          e.preventDefault();
          handlers.openFile && handlers.openFile();
          return;
        }
        if (key === 's' && !e.shiftKey) {
          e.preventDefault();
          handlers.saveFile && handlers.saveFile();
          return;
        }
        if (key === 's' && e.shiftKey) {
          e.preventDefault();
          handlers.exportHtml && handlers.exportHtml();
          return;
        }
        if (key === 'p') {
          // Let browser handle print, but ensure preview-only first
          if (handlers.beforePrint) handlers.beforePrint();
          // browser handles the rest
          return;
        }
      }

      // Alt shortcuts (view modes)
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === '1') { e.preventDefault(); handlers.setMode && handlers.setMode('split-h'); return; }
        if (e.key === '2') { e.preventDefault(); handlers.setMode && handlers.setMode('split-v'); return; }
        if (e.key === '3') { e.preventDefault(); handlers.setMode && handlers.setMode('editor');  return; }
        if (e.key === '4') { e.preventDefault(); handlers.setMode && handlers.setMode('preview'); return; }
        if (e.key === '0') { e.preventDefault(); handlers.resetSplit && handlers.resetSplit(); return; }
        if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          handlers.toggleTheme && handlers.toggleTheme();
          return;
        }
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          handlers.toggleSync && handlers.toggleSync();
          return;
        }
        if (e.key.toLowerCase() === 'l') {
          e.preventDefault();
          handlers.toggleLineNumbers && handlers.toggleLineNumbers();
          return;
        }
      }

      // ? when not in editable field — show help
      if (!inField && !isMod(e) && !e.altKey && e.key === '?') {
        e.preventDefault();
        handlers.toggleHelp && handlers.toggleHelp();
        return;
      }

      // Escape closes dialog
      if (e.key === 'Escape' && handlers.escape) {
        handlers.escape(e);
      }
    });
  }

  window.MdvShortcuts = { install: install };
})();
