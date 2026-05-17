/* ============================================================
   app.js — wires everything together
   ============================================================ */
(function () {
  'use strict';

  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* State */
  const state = {
    filename: 'untitled.md',
    mode: 'split-h',
    theme: 'auto',     // 'auto' | 'light' | 'dark'
    splitRatio: 0.5,
    syncEnabled: true,
    dirty: false
  };

  /* Element refs */
  const els = {
    workspace: $('#workspace'),
    editorArea: $('#editor'),
    previewScroll: $('#preview-scroll'),
    preview: $('#preview'),
    splitter: $('#splitter'),
    fileInput: $('#file-input'),
    filename: $('#filename'),
    statsEditor: $('#stats-editor'),
    statsPreview: $('#stats-preview'),
    btnOpen: $('#btn-open'),
    btnSave: $('#btn-save'),
    btnExportHtml: $('#btn-export-html'),
    btnPrint: $('#btn-print'),
    btnSync: $('#btn-sync'),
    btnTheme: $('#btn-theme'),
    btnHelp: $('#btn-help'),
    helpDialog: $('#help-dialog'),
    dropOverlay: $('#drop-overlay'),
    toast: $('#toast'),
    mobileTabs: $('#mobile-tabs')
  };

  /* Theme handling */
  function applyTheme() {
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = state.theme === 'dark' || (state.theme === 'auto' && sys);
    document.documentElement.classList.toggle('theme-dark', dark);
    const dl = $('#hljs-light');
    const dd = $('#hljs-dark');
    if (dl && dd) {
      dl.disabled = dark;
      dd.disabled = !dark;
    }
    if (window.MdvMarkdown && window.MdvMarkdown.reinitMermaidTheme) {
      window.MdvMarkdown.reinitMermaidTheme();
      // Re-render so mermaid uses the new theme
      scheduleRender();
    }
    const themeColor = dark ? '#0d1117' : '#ffffff';
    $$('meta[name="theme-color"]').forEach(m => {
      if (!m.media) m.setAttribute('content', themeColor);
    });
  }

  function toggleTheme() {
    if (state.theme === 'auto') {
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
      state.theme = sys ? 'light' : 'dark';
    } else {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
    }
    window.MdvStorage.set('theme', state.theme);
    applyTheme();
    toast('Theme: ' + state.theme);
  }

  /* Mode handling */
  function setMode(mode) {
    if (!['split-h', 'split-v', 'editor', 'preview'].includes(mode)) return;
    state.mode = mode;
    els.workspace.setAttribute('data-mode', mode);
    $$('.btn--mode').forEach(b => {
      const on = b.getAttribute('data-mode') === mode;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    // CSS handles tab visibility; JS only updates aria-current state.
    $$('.mobile-tab').forEach(t => {
      t.setAttribute('aria-current', t.getAttribute('data-mode') === mode ? 'true' : 'false');
    });
    // Sync is meaningful only when both panes visible
    if (sync) sync.setActive(mode === 'split-h' || mode === 'split-v');
    // aria-orientation for the splitter
    const stacked = mode === 'split-v' ||
      (mode === 'split-h' && window.matchMedia('(max-width: 480px)').matches);
    els.splitter.setAttribute('aria-orientation', stacked ? 'horizontal' : 'vertical');
    // Ratio CSS variable
    applySplitRatio();
    window.MdvStorage.set('mode', mode);
    // Refresh CodeMirror after layout change
    requestAnimationFrame(function () {
      if (cm) cm.refresh();
      if (sync) sync.cacheOffsets();
    });
  }

  function applySplitRatio() {
    const r = Math.max(0.1, Math.min(0.9, state.splitRatio));
    els.workspace.style.setProperty('--pane-a', r + 'fr');
    els.workspace.style.setProperty('--pane-b', (1 - r) + 'fr');
    els.splitter.setAttribute('aria-valuenow', Math.round(r * 100));
  }

  function resetSplit() {
    state.splitRatio = 0.5;
    applySplitRatio();
    window.MdvStorage.set('splitRatio', state.splitRatio);
    requestAnimationFrame(function () {
      if (cm) cm.refresh();
      if (sync) sync.cacheOffsets();
    });
  }

  /* Splitter drag */
  function installSplitter() {
    let dragging = false;
    let startPos = 0, startRatio = 0;

    function pointerStart(e) {
      e.preventDefault();
      dragging = true;
      els.splitter.classList.add('is-dragging');
      const isV = state.mode === 'split-v' ||
                  (state.mode === 'split-h' && window.matchMedia('(max-width: 480px)').matches);
      startPos = isV ? (e.touches ? e.touches[0].clientY : e.clientY)
                     : (e.touches ? e.touches[0].clientX : e.clientX);
      startRatio = state.splitRatio;
      document.body.style.cursor = isV ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
    }
    function pointerMove(e) {
      if (!dragging) return;
      const isV = state.mode === 'split-v' ||
                  (state.mode === 'split-h' && window.matchMedia('(max-width: 480px)').matches);
      const pos = isV ? (e.touches ? e.touches[0].clientY : e.clientY)
                      : (e.touches ? e.touches[0].clientX : e.clientX);
      const rect = els.workspace.getBoundingClientRect();
      const total = isV ? rect.height : rect.width;
      const delta = pos - startPos;
      state.splitRatio = Math.max(0.1, Math.min(0.9, startRatio + delta / total));
      applySplitRatio();
    }
    function pointerEnd() {
      if (!dragging) return;
      dragging = false;
      els.splitter.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.MdvStorage.set('splitRatio', state.splitRatio);
      if (cm) cm.refresh();
      if (sync) sync.cacheOffsets();
    }

    els.splitter.addEventListener('mousedown', pointerStart);
    els.splitter.addEventListener('touchstart', pointerStart, { passive: false });
    window.addEventListener('mousemove', pointerMove);
    window.addEventListener('touchmove', pointerMove, { passive: false });
    window.addEventListener('mouseup', pointerEnd);
    window.addEventListener('touchend', pointerEnd);
    window.addEventListener('touchcancel', pointerEnd);

    els.splitter.addEventListener('dblclick', resetSplit);
    els.splitter.addEventListener('keydown', function (e) {
      let step = 0.05;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')   { e.preventDefault(); state.splitRatio = Math.max(0.1, state.splitRatio - step); applySplitRatio(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown'){ e.preventDefault(); state.splitRatio = Math.min(0.9, state.splitRatio + step); applySplitRatio(); }
      if (e.key === 'Home')  { e.preventDefault(); state.splitRatio = 0.1; applySplitRatio(); }
      if (e.key === 'End')   { e.preventDefault(); state.splitRatio = 0.9; applySplitRatio(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resetSplit(); }
      window.MdvStorage.set('splitRatio', state.splitRatio);
    });
  }

  /* Toast */
  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-show');
    }, 2200);
  }

  /* Filename */
  function setFilename(name) {
    state.filename = name || 'untitled.md';
    els.filename.textContent = state.filename;
    els.filename.setAttribute('title', state.filename);
    document.title = state.filename + ' — mdview';
  }

  /* Render pipeline */
  let renderTimer = null;
  let renderInflight = false;
  let needsAnotherRender = false;
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(doRender, 120);
  }
  function doRender() {
    renderTimer = null;
    if (renderInflight) { needsAnotherRender = true; return; }
    renderInflight = true;
    const src = cm.getValue();
    updateEditorStats(src);
    const p = window.MdvMarkdown.render(src, els.preview);
    Promise.resolve(p).then(function () {
      updatePreviewStats(els.preview);
      if (sync) sync.rebuild();
      els.preview.removeAttribute('aria-busy');
      renderInflight = false;
      if (needsAnotherRender) {
        needsAnotherRender = false;
        scheduleRender();
      }
    }).catch(function () {
      renderInflight = false;
    });
    saveDraft(src);
  }

  function updateEditorStats(text) {
    const s = window.MdvEditor.stats(text);
    els.statsEditor.textContent = s.lines + ' lines · ' + s.words + ' words · ' + s.chars + ' chars';
  }
  function updatePreviewStats(root) {
    // Use the rendered text content, which is closer to what is actually read.
    const text = root.innerText || root.textContent || '';
    const words = (text.trim().match(/\S+/g) || []).length;
    const minutes = Math.max(1, Math.round(words / 220));
    els.statsPreview.textContent = words + ' words · ~' + minutes + ' min read';
  }

  /* Draft persistence */
  let saveTimer = null;
  function saveDraft(src) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      window.MdvStorage.set('draft', {
        text: src,
        filename: state.filename,
        savedAt: Date.now()
      });
    }, 600);
  }

  /* File open via input */
  function pickFile() {
    els.fileInput.value = '';
    els.fileInput.click();
  }
  els.fileInput.addEventListener('change', function () {
    const f = els.fileInput.files && els.fileInput.files[0];
    if (f) openFileObject(f);
  });

  function openFileObject(file) {
    if (!window.MdvFiles.isMarkdownFile(file)) {
      if (!confirm('"' + file.name + '" does not look like a markdown file. Open anyway?')) return;
    }
    window.MdvFiles.readTextFile(file).then(function (text) {
      setFilename(file.name);
      cm.setValue(text);
      cm.scrollTo(0, 0);
      els.previewScroll.scrollTop = 0;
      toast('Opened ' + file.name);
    }, function (err) {
      toast('Open failed: ' + (err && err.message || err));
    });
  }

  /* Save / export / print */
  function saveFile() {
    const name = window.MdvFiles.defaultFilename(state.filename, 'md');
    window.MdvFiles.downloadText(name, cm.getValue());
    toast('Saved ' + name);
  }
  function exportHtml() {
    const name = window.MdvFiles.defaultFilename(state.filename, 'html');
    const title = state.filename.replace(/\.[^.]+$/, '');
    const html = window.MdvFiles.buildStandaloneHtml(title, els.preview.outerHTML);
    window.MdvFiles.downloadText(name, html, 'text/html');
    toast('Exported ' + name);
  }
  function printPreview() {
    // The print stylesheet handles hiding everything except preview.
    window.print();
  }

  /* Drag and drop */
  function installDragDrop() {
    let depth = 0;
    function show() { els.dropOverlay.classList.add('is-active'); }
    function hide() { els.dropOverlay.classList.remove('is-active'); }

    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || !Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files')) return;
      e.preventDefault();
      depth++;
      show();
    });
    window.addEventListener('dragover', function (e) {
      if (!e.dataTransfer || !Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!e.dataTransfer || !Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files')) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) hide();
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      hide();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) openFileObject(file);
    });
  }

  /* Paste markdown text directly */
  function installPaste() {
    document.addEventListener('paste', function (e) {
      // Don't hijack pastes while typing into the editor or any field
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // ignore pastes inside the CodeMirror editor area too
      if (t && t.closest && t.closest('.CodeMirror')) return;
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (text && /[#*`>\-_\[]/.test(text) && text.length > 8) {
        e.preventDefault();
        if (cm.getValue().trim() && !confirm('Replace current content with pasted markdown?')) return;
        setFilename('pasted.md');
        cm.setValue(text);
        toast('Pasted markdown');
      }
    });
  }

  /* Mobile tabs */
  function installMobileTabs() {
    $$('.mobile-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        setMode(t.getAttribute('data-mode'));
      });
    });
  }

  /* Help */
  function toggleHelp() {
    if (!els.helpDialog.showModal) return; // very old browser fallback
    if (els.helpDialog.open) els.helpDialog.close();
    else els.helpDialog.showModal();
  }

  /* Sync toggle */
  function toggleSync() {
    state.syncEnabled = !state.syncEnabled;
    sync.setEnabled(state.syncEnabled);
    els.btnSync.setAttribute('aria-pressed', state.syncEnabled ? 'true' : 'false');
    window.MdvStorage.set('syncEnabled', state.syncEnabled);
    toast('Sync scroll ' + (state.syncEnabled ? 'on' : 'off'));
  }

  /* Restore persisted state */
  function restoreState() {
    const stored = window.MdvStorage.get('theme', 'auto');
    state.theme = stored;
    state.mode = window.MdvStorage.get('mode', initialMode());
    state.splitRatio = +window.MdvStorage.get('splitRatio', 0.5) || 0.5;
    state.syncEnabled = window.MdvStorage.get('syncEnabled', true);
    els.btnSync.setAttribute('aria-pressed', state.syncEnabled ? 'true' : 'false');
  }
  function initialMode() {
    if (window.matchMedia('(max-width: 720px)').matches) return 'preview';
    return 'split-h';
  }

  /* CodeMirror */
  let cm, sync;
  function initEditor() {
    cm = window.MdvEditor.create(els.editorArea);
    cm.on('change', function () {
      state.dirty = true;
      scheduleRender();
    });
    cm.on('cursorActivity', function () {
      // Update column/line status (could add later)
    });
  }
  function initSync() {
    sync = window.MdvSync.create({
      editor: cm,
      previewScroll: els.previewScroll,
      previewRoot: els.preview
    });
    sync.setEnabled(state.syncEnabled);
    sync.setActive(state.mode === 'split-h' || state.mode === 'split-v');
  }

  /* Welcome doc */
  const WELCOME_URL = 'examples/welcome.md';
  function loadWelcome() {
    const draft = window.MdvStorage.get('draft', null);
    if (draft && draft.text) {
      setFilename(draft.filename || 'untitled.md');
      cm.setValue(draft.text);
      toast('Restored last session');
      return;
    }
    function useFallback() {
      cm.setValue(FALLBACK_WELCOME);
      setFilename('welcome.md');
    }
    if (typeof window.fetch !== 'function') { useFallback(); return; }
    try {
      window.fetch(WELCOME_URL).then(function (r) {
        if (!r.ok) throw new Error('No welcome doc');
        return r.text();
      }).then(function (txt) {
        setFilename('welcome.md');
        cm.setValue(txt);
      }).catch(useFallback);
    } catch (_) {
      useFallback();
    }
  }

  const FALLBACK_WELCOME = [
    '# Welcome to mdview',
    '',
    'Drop a markdown file anywhere, paste text, or click the open icon.',
    'Everything stays in your browser — no uploads, no server.',
    '',
    '- **Math:** $E = mc^2$ and block math too',
    '- **Code:** highlighted in `pre` blocks',
    '- **Diagrams:** ```` ```mermaid ```` blocks render with mermaid',
    '',
    '$$',
    '\\int_0^\\infty e^{-x^2}\\,dx = \\tfrac{\\sqrt{\\pi}}{2}',
    '$$',
    ''
  ].join('\n');

  /* Mode change listeners */
  $$('.btn--mode').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });

  /* Toolbar wiring */
  els.btnOpen.addEventListener('click', pickFile);
  els.btnSave.addEventListener('click', saveFile);
  els.btnExportHtml.addEventListener('click', exportHtml);
  els.btnPrint.addEventListener('click', printPreview);
  els.btnSync.addEventListener('click', toggleSync);
  els.btnTheme.addEventListener('click', toggleTheme);
  els.btnHelp.addEventListener('click', toggleHelp);

  /* React to OS theme changes */
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (state.theme === 'auto') applyTheme();
    });
  }
  let resizeTimer = null;
  window.addEventListener('resize', function () {
    if (sync) sync.cacheOffsets();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      setMode(state.mode);
    }, 120);
  });

  /* Confirm leaving if there's unsaved (modified-from-original) content */
  window.addEventListener('beforeunload', function (e) {
    // We persist a draft to localStorage; warn only if no LS available.
    if (state.dirty && !window.MdvStorage.hasLS) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* Boot */
  function boot() {
    restoreState();
    applyTheme();
    initEditor();
    initSync();
    setMode(state.mode);
    applySplitRatio();
    installSplitter();
    installDragDrop();
    installPaste();
    installMobileTabs();
    window.MdvShortcuts.install({
      openFile: pickFile,
      saveFile: saveFile,
      exportHtml: exportHtml,
      beforePrint: function () { /* could switch to preview-only here */ },
      setMode: setMode,
      resetSplit: resetSplit,
      toggleTheme: toggleTheme,
      toggleSync: toggleSync,
      toggleHelp: toggleHelp,
      escape: function () {
        if (els.helpDialog.open) els.helpDialog.close();
      }
    });
    loadWelcome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
