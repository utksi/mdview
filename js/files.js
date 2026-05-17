/* ============================================================
   files.js — open / save / drag-drop / clipboard paste
   ============================================================ */
(function () {
  'use strict';

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(reader.error); };
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.readAsText(file);
    });
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/markdown') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      a.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }

  function isMarkdownFile(file) {
    if (!file) return false;
    const name = (file.name || '').toLowerCase();
    if (/\.(md|markdown|mdown|mkd|mkdn|txt)$/.test(name)) return true;
    const type = (file.type || '').toLowerCase();
    return type === 'text/markdown' || type === 'text/plain' || type === '';
  }

  function buildStandaloneHtml(title, bodyHtml) {
    // Pull computed font/colors from the current theme so the export
    // looks roughly like what the user sees.
    const isDark = document.documentElement.classList.contains('theme-dark');
    const css = String.raw`
      :root { color-scheme: ${isDark ? 'dark' : 'light'}; }
      body {
        font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
              "Helvetica Neue", Arial, sans-serif;
        max-width: 76ch;
        margin: 40px auto;
        padding: 0 20px;
        color: ${isDark ? '#e6edf3' : '#1f2328'};
        background: ${isDark ? '#0d1117' : '#ffffff'};
      }
      h1,h2,h3,h4,h5,h6 { line-height: 1.25; margin: 1.6em 0 .6em; }
      h1,h2 { padding-bottom: .3em; border-bottom: 1px solid ${isDark ? '#21262d' : '#eaeef2'}; }
      a { color: ${isDark ? '#4493f8' : '#0969da'}; }
      pre {
        padding: 14px 16px; overflow: auto; border-radius: 6px;
        background: ${isDark ? '#161b22' : '#f6f8fa'};
        border: 1px solid ${isDark ? '#21262d' : '#eaeef2'};
        font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      :not(pre) > code {
        font: .9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        background: ${isDark ? '#161b22' : '#f6f8fa'};
        padding: .15em .4em; border-radius: 4px;
      }
      blockquote {
        border-left: .25em solid ${isDark ? '#30363d' : '#d1d9e0'};
        padding: 0 1em;
        color: ${isDark ? '#9198a1' : '#59636e'};
      }
      table { border-collapse: collapse; margin: 1em 0; }
      th, td { border: 1px solid ${isDark ? '#30363d' : '#d1d9e0'}; padding: 6px 13px; }
      th { background: ${isDark ? '#161b22' : '#f6f8fa'}; }
      img { max-width: 100%; height: auto; }
      .mermaid svg { max-width: 100%; height: auto; }
      mark { background: ${isDark ? 'rgba(255,222,121,.2)' : 'rgba(255,222,121,.55)'}; padding: 0 .15em; border-radius: 2px; }
      .anchor { display: none; }
    `;
    return '<!doctype html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(title) + '</title>\n' +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">\n' +
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/' +
      (isDark ? 'github-dark' : 'github') + '.min.css">\n' +
      '<style>' + css + '</style>\n' +
      '</head>\n<body>\n' + bodyHtml + '\n</body>\n</html>\n';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function defaultFilename(currentName, ext) {
    let base = (currentName || 'untitled').replace(/\.[^.]+$/, '');
    if (!base) base = 'untitled';
    return base + '.' + ext;
  }

  window.MdvFiles = {
    readTextFile: readTextFile,
    downloadText: downloadText,
    isMarkdownFile: isMarkdownFile,
    buildStandaloneHtml: buildStandaloneHtml,
    defaultFilename: defaultFilename
  };
})();
