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
    lineNumbers: true,
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
    btnAttach: $('#btn-attach'),
    btnSave: $('#btn-save'),
    btnExportHtml: $('#btn-export-html'),
    btnPrint: $('#btn-print'),
    btnLineNums: $('#btn-linenums'),
    btnSync: $('#btn-sync'),
    btnGuide: $('#btn-guide'),
    btnTheme: $('#btn-theme'),
    btnHelp: $('#btn-help'),
    helpDialog: $('#help-dialog'),
    dropOverlay: $('#drop-overlay'),
    toast: $('#toast'),
    mobileTabs: $('#mobile-tabs'),
    attachPopover: $('#attach-popover'),
    attachClose:   $('#attach-close'),
    attachList:    $('#attach-list'),
    attachEmpty:   $('#attach-empty'),
    attachAdd:     $('#attach-add'),
    attachInsert:  $('#attach-insert'),
    attachInput:   $('#attach-input'),
    attachCount:   $('#attach-count')
  };
  let selectedAttachment = null;

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
    document.title = state.filename + ' · mdview';
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
      setEditorContent(text);
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
    const attachCount = window.MdvAttachments ? window.MdvAttachments.count() : 0;
    if (attachCount > 0) {
      // Download every image after a short delay so the browser separates them
      setTimeout(function () {
        window.MdvAttachments.downloadAll();
      }, 250);
      toast('Saved ' + name + ' + ' + attachCount +
        ' attachment' + (attachCount === 1 ? '' : 's') +
        '; keep them in the same folder');
    } else {
      toast('Saved ' + name);
    }
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
      const files = (e.dataTransfer && e.dataTransfer.files) ? Array.from(e.dataTransfer.files) : [];
      if (!files.length) return;
      const images = files.filter(function (f) { return /^image\//.test(f.type); });
      const others = files.filter(function (f) { return !/^image\//.test(f.type); });
      if (images.length) {
        addAttachmentsFromFiles(images);
      }
      if (others.length) {
        openFileObject(others[0]);
      }
    });
  }

  /* Paste markdown text directly */
  function installPaste() {
    document.addEventListener('paste', function (e) {
      const cd = e.clipboardData;
      if (!cd) return;
      // Look for an image first — works from screenshot tools / file copy.
      const imgItem = Array.prototype.find && Array.prototype.find.call(
        cd.items || [],
        function (it) { return it.kind === 'file' && /^image\//.test(it.type); }
      );
      if (imgItem) {
        const f = imgItem.getAsFile();
        if (f) {
          e.preventDefault();
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          addAttachmentsFromFiles([f], 'pasted-' + stamp + '.' + ext);
          return;
        }
      }
      // Otherwise fall back to pasting markdown text, but only when the
      // user is not typing into a field.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (t && t.closest && t.closest('.CodeMirror')) return;
      const text = cd.getData('text/plain');
      if (text && /[#*`>\-_\[]/.test(text) && text.length > 8) {
        e.preventDefault();
        if (cm.getValue().trim() && !confirm('Replace current content with pasted markdown?')) return;
        setFilename('pasted.md');
        setEditorContent(text);
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

  /* Line-numbers toggle.

     We let CodeMirror itself manage the gutter — it has the gutter-width
     bookkeeping and the sizer-margin update wired up correctly. Our CSS
     fallback (the :root.no-line-numbers class) used to also hide the
     gutter and zero the sizer margin, which collided with CM's own state
     on the re-enable path and caused the gutter to be re-measured at the
     wrong width. Now the class is only a styling hook; the actual hide
     happens via cm.setOption. After toggling we refresh twice across two
     frames so the gutter width is recomputed against the now-correct
     visibility state. */
  function applyLineNumbers() {
    if (els.btnLineNums) {
      els.btnLineNums.setAttribute('aria-pressed', state.lineNumbers ? 'true' : 'false');
    }
    document.documentElement.classList.toggle('no-line-numbers', !state.lineNumbers);
    if (cm) {
      try { cm.setOption('lineNumbers', state.lineNumbers); } catch (_) {}
      requestAnimationFrame(function () {
        try { cm.refresh(); } catch (_) {}
        requestAnimationFrame(function () {
          try { cm.refresh(); } catch (_) {}
        });
      });
    }
  }
  function toggleLineNumbers() {
    state.lineNumbers = !state.lineNumbers;
    applyLineNumbers();
    window.MdvStorage.set('lineNumbers', state.lineNumbers);
    toast('Line numbers ' + (state.lineNumbers ? 'on' : 'off'));
  }

  /* Restore persisted state */
  function restoreState() {
    state.theme = window.MdvStorage.get('theme', 'auto');
    state.mode = window.MdvStorage.get('mode', initialMode());
    state.splitRatio = +window.MdvStorage.get('splitRatio', 0.5) || 0.5;
    state.syncEnabled = window.MdvStorage.get('syncEnabled', true);
    state.lineNumbers = window.MdvStorage.get('lineNumbers', true);
    if (els.btnSync) els.btnSync.setAttribute('aria-pressed', state.syncEnabled ? 'true' : 'false');
    if (els.btnLineNums) els.btnLineNums.setAttribute('aria-pressed', state.lineNumbers ? 'true' : 'false');
    document.documentElement.classList.toggle('no-line-numbers', !state.lineNumbers);
  }
  function initialMode() {
    if (window.matchMedia('(max-width: 720px)').matches) return 'preview';
    return 'split-h';
  }

  /* CodeMirror */
  let cm, sync;
  function initEditor() {
    cm = window.MdvEditor.create(els.editorArea);
    cm.setOption('lineNumbers', state.lineNumbers);
    cm.on('change', function () {
      state.dirty = true;
      scheduleRender();
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

  /* Set editor content and re-measure gutter widths once the content
     has been laid out. Used wherever cm.setValue is called. Also resets
     the dirty flag so the guide / open buttons know whether the user
     has unsaved changes relative to the most recently loaded file. */
  function setEditorContent(text) {
    cm.setValue(text);
    // cm.setValue triggers the 'change' handler which would have just set
    // state.dirty = true; clear it again so a freshly-loaded file is clean.
    state.dirty = false;
    cm.scrollTo(0, 0);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (cm) cm.refresh(); });
    });
  }

  /* Load (or reload) the bundled welcome guide. If the user has unsaved
     changes, confirm before replacing — they can cancel and download the
     current document first. */
  function loadGuide() {
    if (state.dirty && cm.getValue().trim()) {
      const ok = window.confirm(
        'Replace the current document with the welcome guide?\n\n' +
        'Unsaved changes will be lost. To keep them, cancel and download ' +
        'the document first.'
      );
      if (!ok) return;
    }
    function useFallback() {
      setFilename('welcome.md');
      setEditorContent(FALLBACK_WELCOME);
      toast('Loaded welcome guide (fallback)');
    }
    if (typeof window.fetch !== 'function') { useFallback(); return; }
    try {
      window.fetch(WELCOME_URL, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('No welcome doc');
        return r.text();
      }).then(function (txt) {
        setFilename('welcome.md');
        setEditorContent(txt);
        toast('Loaded welcome guide');
      }).catch(useFallback);
    } catch (_) {
      useFallback();
    }
  }

  /* ---------- attachments UI ---------- */
  function addAttachmentsFromFiles(files, overrideName) {
    let added = 0;
    const last = files[files.length - 1];
    for (let i = 0; i < files.length; i++) {
      const name = overrideName && i === files.length - 1 ? overrideName : null;
      const item = window.MdvAttachments.add(files[i], name);
      added++;
      // Insert a markdown reference at the cursor for the last image
      if (files[i] === last && cm) {
        const ref = window.MdvAttachments.referenceFor(item.name);
        cm.replaceSelection(ref + '\n');
        cm.focus();
        selectedAttachment = item.name;
      }
    }
    if (added > 0) {
      toast('Attached ' + added + ' image' + (added === 1 ? '' : 's'));
      scheduleRender();
    }
  }

  function renderAttachmentList() {
    if (!window.MdvAttachments) return;
    const list = window.MdvAttachments.list();
    els.attachList.innerHTML = '';
    if (!list.length) {
      els.attachEmpty.hidden = false;
      els.attachInsert.disabled = true;
      els.attachCount.hidden = true;
      els.attachCount.textContent = '0';
      selectedAttachment = null;
      return;
    }
    els.attachEmpty.hidden = true;
    els.attachCount.hidden = false;
    els.attachCount.textContent = String(list.length);

    list.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'attach-item';
      if (item.name === selectedAttachment) li.classList.add('is-selected');
      li.addEventListener('click', function (e) {
        if (e.target.closest('.attach-remove')) return;
        selectedAttachment = item.name;
        els.attachInsert.disabled = false;
        renderAttachmentList();
      });

      const img = document.createElement('img');
      img.src = item.url;
      img.alt = '';
      li.appendChild(img);

      const meta = document.createElement('div');
      meta.className = 'attach-meta';
      const name = document.createElement('span');
      name.className = 'attach-name';
      name.textContent = item.name;
      name.title = item.name;
      const size = document.createElement('span');
      size.className = 'attach-size';
      size.textContent = formatBytes(item.size);
      meta.appendChild(name);
      meta.appendChild(size);
      li.appendChild(meta);

      const rm = document.createElement('button');
      rm.className = 'btn btn--icon attach-remove';
      rm.setAttribute('aria-label', 'Remove ' + item.name);
      rm.title = 'Remove';
      rm.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>';
      rm.addEventListener('click', function (e) {
        e.stopPropagation();
        window.MdvAttachments.remove(item.name);
        if (selectedAttachment === item.name) selectedAttachment = null;
        toast('Removed ' + item.name);
      });
      li.appendChild(rm);

      els.attachList.appendChild(li);
    });
    els.attachInsert.disabled = !selectedAttachment;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function positionAttachPopover() {
    if (!els.btnAttach || !els.attachPopover) return;
    const r = els.btnAttach.getBoundingClientRect();
    const pop = els.attachPopover;
    pop.style.top  = (r.bottom + 6) + 'px';
    const desiredLeft = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8);
    pop.style.left = Math.max(8, desiredLeft) + 'px';
  }

  function toggleAttachments(force) {
    const show = (force !== undefined) ? !!force : els.attachPopover.hidden;
    els.attachPopover.hidden = !show;
    els.btnAttach.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      renderAttachmentList();
      positionAttachPopover();
    }
  }

  function installAttachmentsUI() {
    if (!window.MdvAttachments) return;
    window.MdvAttachments.onChange(function () {
      renderAttachmentList();
      // Re-render to refresh image src URLs
      scheduleRender();
    });
    els.btnAttach.addEventListener('click', function () { toggleAttachments(); });
    els.attachClose.addEventListener('click', function () { toggleAttachments(false); });
    els.attachAdd.addEventListener('click', function () {
      els.attachInput.value = '';
      els.attachInput.click();
    });
    els.attachInput.addEventListener('change', function () {
      const files = els.attachInput.files;
      if (files && files.length) {
        addAttachmentsFromFiles(Array.from(files));
        renderAttachmentList();
      }
    });
    els.attachInsert.addEventListener('click', function () {
      if (!selectedAttachment) return;
      const ref = window.MdvAttachments.referenceFor(selectedAttachment);
      cm.replaceSelection(ref);
      cm.focus();
      toggleAttachments(false);
      toast('Inserted reference');
    });
    // Close on outside click or Escape
    document.addEventListener('click', function (e) {
      if (els.attachPopover.hidden) return;
      if (els.attachPopover.contains(e.target)) return;
      if (els.btnAttach.contains(e.target)) return;
      toggleAttachments(false);
    });
    window.addEventListener('resize', function () {
      if (!els.attachPopover.hidden) positionAttachPopover();
    });
    renderAttachmentList();
  }

  /* Welcome doc */
  const WELCOME_URL = 'examples/welcome.md';
  function loadWelcome() {
    const draft = window.MdvStorage.get('draft', null);
    if (draft && draft.text) {
      setFilename(draft.filename || 'untitled.md');
      setEditorContent(draft.text);
      toast('Restored last session');
      return;
    }
    function useFallback() {
      setEditorContent(FALLBACK_WELCOME);
      setFilename('welcome.md');
    }
    if (typeof window.fetch !== 'function') { useFallback(); return; }
    try {
      window.fetch(WELCOME_URL).then(function (r) {
        if (!r.ok) throw new Error('No welcome doc');
        return r.text();
      }).then(function (txt) {
        setFilename('welcome.md');
        setEditorContent(txt);
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

  /* Toolbar wiring. Each binding is independent so a single missing
     element doesn't prevent the rest from being wired up. */
  function bind(el, ev, fn) {
    if (el) el.addEventListener(ev, fn);
    else if (window.console && console.warn) console.warn('[mdview] missing element for', ev, fn);
  }
  bind(els.btnOpen,        'click', pickFile);
  bind(els.btnSave,        'click', saveFile);
  bind(els.btnExportHtml,  'click', exportHtml);
  bind(els.btnPrint,       'click', printPreview);
  bind(els.btnLineNums,    'click', toggleLineNumbers);
  bind(els.btnSync,        'click', toggleSync);
  bind(els.btnTheme,       'click', toggleTheme);
  bind(els.btnGuide,       'click', loadGuide);
  bind(els.btnHelp,        'click', toggleHelp);

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

  /* Boot. Each step is isolated so one failing installer can't take the
     others (and their button handlers) down with it. */
  function safeRun(label, fn) {
    try { fn(); }
    catch (e) {
      if (window.console && console.error) console.error('[mdview] ' + label + ' failed:', e);
    }
  }
  function boot() {
    safeRun('restoreState',     restoreState);
    safeRun('applyTheme',       applyTheme);
    safeRun('initEditor',       initEditor);
    safeRun('initSync',         initSync);
    safeRun('setMode',          function () { setMode(state.mode); });
    safeRun('applySplitRatio',  applySplitRatio);
    safeRun('installSplitter',  installSplitter);
    safeRun('installDragDrop',  installDragDrop);
    safeRun('installPaste',     installPaste);
    safeRun('installMobileTabs',installMobileTabs);
    safeRun('installAttachmentsUI', installAttachmentsUI);
    window.MdvShortcuts.install({
      openFile: pickFile,
      saveFile: saveFile,
      exportHtml: exportHtml,
      beforePrint: function () { /* could switch to preview-only here */ },
      setMode: setMode,
      resetSplit: resetSplit,
      toggleTheme: toggleTheme,
      toggleSync: toggleSync,
      toggleLineNumbers: toggleLineNumbers,
      toggleHelp: toggleHelp,
      loadGuide: loadGuide,
      escape: function () {
        if (els.attachPopover && !els.attachPopover.hidden) {
          toggleAttachments(false);
          return;
        }
        if (els.helpDialog.open) els.helpDialog.close();
      }
    });
    loadWelcome();
    // CodeMirror caches gutter width based on the line count at init time.
    // The welcome doc loads later (and its source may have 3-digit line
    // numbers), so the gutter needs to be re-measured after content lands.
    // Refresh aggressively: next frame, after window.load (fonts settle),
    // and whenever the editor pane resizes.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (cm) cm.refresh(); });
    });
    if (document.readyState !== 'complete') {
      window.addEventListener('load', function () {
        if (cm) cm.refresh();
        if (sync) sync.cacheOffsets();
      }, { once: true });
    }
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(function () {
        if (cm) cm.refresh();
      });
      const editorPane = document.querySelector('.pane--editor');
      if (editorPane) ro.observe(editorPane);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
