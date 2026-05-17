/* ============================================================
   editor.js — CodeMirror wrapper with markdown niceties
   ============================================================ */
(function () {
  'use strict';

  function create(textarea) {
    const cm = window.CodeMirror.fromTextArea(textarea, {
      mode: 'gfm',
      lineNumbers: true,
      lineWrapping: true,
      autoCloseBrackets: true,
      matchBrackets: true,
      styleActiveLine: true,
      tabSize: 2,
      indentUnit: 2,
      indentWithTabs: false,
      smartIndent: true,
      viewportMargin: 60,
      scrollbarStyle: 'native',
      inputStyle: 'contenteditable',
      spellcheck: false,
      autocorrect: false,
      autocapitalize: false,
      extraKeys: {
        'Enter': 'newlineAndIndentContinueMarkdownList',
        'Ctrl-B':  function (cm) { wrapSelection(cm, '**', '**', 'bold text'); },
        'Cmd-B':   function (cm) { wrapSelection(cm, '**', '**', 'bold text'); },
        'Ctrl-I':  function (cm) { wrapSelection(cm, '*',  '*',  'italic text'); },
        'Cmd-I':   function (cm) { wrapSelection(cm, '*',  '*',  'italic text'); },
        'Ctrl-E':  function (cm) { wrapSelection(cm, '`',  '`',  'code'); },
        'Cmd-E':   function (cm) { wrapSelection(cm, '`',  '`',  'code'); },
        'Ctrl-K':  function (cm) { wrapLink(cm); },
        'Cmd-K':   function (cm) { wrapLink(cm); },
        'Ctrl-/':  function (cm) { toggleLinePrefix(cm, '> '); },
        'Cmd-/':   function (cm) { toggleLinePrefix(cm, '> '); },
        'Tab': function (cm) {
          if (cm.somethingSelected()) cm.indentSelection('add');
          else cm.replaceSelection(cm.getOption('indentWithTabs') ? '\t' : '  ');
        },
        'Shift-Tab': function (cm) { cm.indentSelection('subtract'); }
      }
    });
    return cm;
  }

  function wrapSelection(cm, left, right, placeholder) {
    cm.operation(function () {
      const sels = cm.listSelections();
      const newSels = [];
      sels.forEach(function (sel) {
        const from = sel.anchor;
        const to = sel.head;
        let a = from, b = to;
        if (cm.indexFromPos(from) > cm.indexFromPos(to)) { a = to; b = from; }
        const text = cm.getRange(a, b);
        if (text) {
          const stripped = stripWrap(text, left, right);
          if (stripped !== null) {
            cm.replaceRange(stripped, a, b);
            newSels.push({
              anchor: a,
              head: cm.posFromIndex(cm.indexFromPos(a) + stripped.length)
            });
          } else {
            cm.replaceRange(left + text + right, a, b);
            newSels.push({
              anchor: cm.posFromIndex(cm.indexFromPos(a) + left.length),
              head: cm.posFromIndex(cm.indexFromPos(a) + left.length + text.length)
            });
          }
        } else {
          cm.replaceRange(left + placeholder + right, a);
          newSels.push({
            anchor: cm.posFromIndex(cm.indexFromPos(a) + left.length),
            head: cm.posFromIndex(cm.indexFromPos(a) + left.length + placeholder.length)
          });
        }
      });
      cm.setSelections(newSels);
    });
  }

  function stripWrap(s, left, right) {
    if (s.startsWith(left) && s.endsWith(right) && s.length >= left.length + right.length) {
      return s.slice(left.length, s.length - right.length);
    }
    return null;
  }

  function wrapLink(cm) {
    cm.operation(function () {
      const sel = cm.getSelection();
      if (/^https?:\/\//i.test(sel)) {
        cm.replaceSelection('[link text](' + sel + ')');
      } else if (sel) {
        cm.replaceSelection('[' + sel + '](https://)');
        const head = cm.getCursor();
        cm.setSelection({ line: head.line, ch: head.ch - 1 }, head);
      } else {
        const cursor = cm.getCursor();
        const text = '[link text](https://)';
        cm.replaceRange(text, cursor);
        cm.setSelection(
          { line: cursor.line, ch: cursor.ch + 1 },
          { line: cursor.line, ch: cursor.ch + 10 }
        );
      }
    });
  }

  function toggleLinePrefix(cm, prefix) {
    cm.operation(function () {
      const sels = cm.listSelections();
      sels.forEach(function (sel) {
        const a = sel.anchor, b = sel.head;
        let from = a.line < b.line || (a.line === b.line && a.ch <= b.ch) ? a : b;
        let to   = from === a ? b : a;
        const lines = [];
        for (let l = from.line; l <= to.line; l++) lines.push(cm.getLine(l));
        const allPrefixed = lines.every(function (line) { return line.startsWith(prefix); });
        for (let l = from.line; l <= to.line; l++) {
          const line = cm.getLine(l);
          if (allPrefixed) {
            cm.replaceRange('',
              { line: l, ch: 0 },
              { line: l, ch: prefix.length });
          } else if (!line.startsWith(prefix)) {
            cm.replaceRange(prefix, { line: l, ch: 0 });
          }
        }
      });
    });
  }

  /* Word/line stats */
  function stats(text) {
    if (!text) return { lines: 0, words: 0, chars: 0, readMin: 0 };
    const lines = text.split('\n').length;
    const trimmed = text.trim();
    const words = trimmed ? (trimmed.match(/\S+/g) || []).length : 0;
    const chars = text.length;
    const readMin = Math.max(1, Math.round(words / 220));
    return { lines: lines, words: words, chars: chars, readMin: readMin };
  }

  window.MdvEditor = { create: create, stats: stats };
})();
