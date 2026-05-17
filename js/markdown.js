/* ============================================================
   markdown.js — render pipeline
     1. extract math + mermaid blocks to placeholders (so md doesn't
        mangle their inner content)
     2. markdown-it -> HTML, with source-line attributes on blocks
     3. DOMPurify -> sanitized HTML
     4. inject into DOM, restore placeholders into real elements
     5. KaTeX render + mermaid render (lazy)
   ============================================================ */
(function () {
  'use strict';

  /* ---------- markdown-it setup ----------
     html: true is safe because every render passes through DOMPurify
     before being injected. This lets users write <details>, <mark>,
     and other inline HTML in their markdown source. */
  const md = window.markdownit({
    html: true,
    xhtmlOut: false,
    breaks: false,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
      // Mermaid is handled separately; never highlight it here.
      if (lang === 'mermaid') return '';
      if (lang && window.hljs && window.hljs.getLanguage(lang)) {
        try {
          return '<pre><code class="hljs language-' + escapeAttr(lang) + '">' +
            window.hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            '</code></pre>';
        } catch (_) { /* fall through */ }
      }
      const value = md.utils.escapeHtml(str);
      return '<pre><code class="hljs">' + value + '</code></pre>';
    }
  });

  function escapeAttr(s) {
    return String(s).replace(/[<>"&]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c];
    });
  }

  /* External links open in new tab */
  const defaultLinkOpen = md.renderer.rules.link_open || function (tokens, idx, opts, env, self) {
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.link_open = function (tokens, idx, opts, env, self) {
    const token = tokens[idx];
    const href = token.attrGet('href') || '';
    if (/^https?:\/\//i.test(href)) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };

  /* Heading anchors + source-line on heading_open */
  md.renderer.rules.heading_open = function (tokens, idx, opts, env, self) {
    const token = tokens[idx];
    const inline = tokens[idx + 1];
    const text = inline && inline.children
      ? inline.children.filter(t => t.type === 'text' || t.type === 'code_inline').map(t => t.content).join('')
      : '';
    const slug = slugify(text);
    if (slug) {
      const counts = env.slugCounts = env.slugCounts || Object.create(null);
      const n = counts[slug] = (counts[slug] || 0) + 1;
      const id = n === 1 ? slug : slug + '-' + n;
      token.attrSet('id', id);
      inline.children.unshift({
        type: 'html_inline',
        content: '<a class="anchor" href="#' + id + '" aria-hidden="true">§</a>'
      });
    }
    markSourceLine(token);
    return self.renderToken(tokens, idx, opts, env, self);
  };

  function slugify(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  /* Source-line tracking — attach data-source-line to every top-level
     block-open token so sync scroll can map editor lines to elements. */
  function markSourceLine(token) {
    if (token.map && token.level === 0) {
      token.attrJoin('class', 'source-line');
      token.attrSet('data-source-line', String(token.map[0]));
    }
  }

  const blockOpenTokens = ['paragraph_open', 'blockquote_open',
    'bullet_list_open', 'ordered_list_open',
    'table_open', 'hr', 'code_block', 'fence', 'html_block', 'dl_open'];
  blockOpenTokens.forEach(function (name) {
    const orig = md.renderer.rules[name];
    md.renderer.rules[name] = function (tokens, idx, opts, env, self) {
      markSourceLine(tokens[idx]);
      return orig ? orig(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts, env, self);
    };
  });

  /* Task lists implemented as a core rule */
  md.core.ruler.after('inline', 'mdv-task-lists', function (state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== 'list_item_open') continue;
      const para = tokens[i + 1];
      const inline = tokens[i + 2];
      if (!para || para.type !== 'paragraph_open') continue;
      if (!inline || inline.type !== 'inline') continue;
      const m = /^\[([ xX])\]\s+/.exec(inline.content);
      if (!m) continue;
      const checked = m[1].toLowerCase() === 'x';
      inline.content = inline.content.slice(m[0].length);
      if (inline.children && inline.children.length) {
        const first = inline.children[0];
        if (first.type === 'text') {
          first.content = first.content.replace(/^\[[ xX]\]\s+/, '');
        }
      }
      const cb = new state.Token('html_inline', '', 0);
      cb.content = '<input type="checkbox" class="task-list-checkbox"' +
        (checked ? ' checked' : '') + ' disabled> ';
      inline.children = inline.children || [];
      inline.children.unshift(cb);
      tokens[i].attrJoin('class', 'task-list-item');
    }
  });

  /* ---------- math + mermaid extraction ----------
     Pre-process the source so markdown-it never sees math content as
     markdown text (which would mangle e.g. underscores in TeX into <em>).

     Pipeline:
       1. Extract mermaid fences to slots.
       2. Temporarily shelf remaining code fences and inline code so
          math regexes don't fire on `$` characters inside code.
       3. Extract block math, then inline math.
       4. Restore code from the shelf — markdown-it now sees real code.

     We use Private Use Area characters as delimiters because markdown-it
     strips NUL chars (replacing them with U+FFFD via its normalize rule).
     PUA chars won't appear in user content and pass through unchanged. */
  const BD = ''; // block delim
  const ID = ''; // inline delim
  const CD = ''; // code-protection delim
  const BLOCK_RE      = new RegExp(BD + '(\\d+)' + BD, 'g');
  const INLINE_RE     = new RegExp(ID + '(\\d+)' + ID, 'g');
  const CODE_RE       = new RegExp(CD + '(\\d+)' + CD, 'g');
  const PARA_BLOCK_RE = new RegExp('<p\\b[^>]*>\\s*' + BD + '(\\d+)' + BD + '\\s*<\\/p>', 'g');

  function extractBlocks(src) {
    const slots = [];
    const codeShelf = [];
    let out = src.replace(/\r\n?/g, '\n');

    // 1. Mermaid fences — these become block slots immediately.
    out = out.replace(/^([ \t]*)```[ \t]*mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm,
      function (m, indent, body, offset) {
        const id = slots.length;
        slots.push({ kind: 'mermaid', body: body, line: lineFromOffset(out, offset) });
        return padLines(m, '\n' + BD + id + BD + '\n');
      });

    // 2. Shelf remaining fenced code blocks so math regexes can't fire
    //    on `$` characters inside them.
    out = out.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*$/gm,
      function (m) {
        const id = codeShelf.length;
        codeShelf.push(m);
        return padLines(m, '\n' + CD + id + CD + '\n');
      });

    // 3. Shelf inline code spans (single-line approximation of CommonMark).
    out = out.replace(/(`+)([^`\n]+?)\1/g, function (m) {
      const id = codeShelf.length;
      codeShelf.push(m);
      return CD + id + CD;
    });

    // 4a. Block math with $$ delimiters on their own line(s).
    out = out.replace(/(^|\n)[ \t]*\$\$\n?([\s\S]+?)\n?\$\$[ \t]*(?=\n|$)/g,
      function (m, pre, body, offset) {
        const realOffset = offset + pre.length;
        const id = slots.length;
        slots.push({ kind: 'math-block', body: body, line: lineFromOffset(out, realOffset) });
        return padLines(m, pre + '\n' + BD + id + BD + '\n');
      });

    // 4b. Block math with LaTeX \[ ... \] delimiters on their own line(s).
    out = out.replace(/(^|\n)[ \t]*\\\[\n?([\s\S]+?)\n?\\\][ \t]*(?=\n|$)/g,
      function (m, pre, body, offset) {
        const realOffset = offset + pre.length;
        const id = slots.length;
        slots.push({ kind: 'math-block', body: body, line: lineFromOffset(out, realOffset) });
        return padLines(m, pre + '\n' + BD + id + BD + '\n');
      });

    // 5a. Inline math with $...$. Avoid currency by requiring non-space
    //     neighbors and a non-digit char after the closing $.
    out = out.replace(/(^|[^\\$])\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/g,
      function (m, pre, body) {
        const id = slots.length;
        slots.push({ kind: 'math-inline', body: body });
        return pre + ID + id + ID;
      });

    // 5b. Inline math with LaTeX \( ... \) delimiters.
    out = out.replace(/\\\(([^\n]+?)\\\)/g, function (m, body) {
      const id = slots.length;
      slots.push({ kind: 'math-inline', body: body });
      return ID + id + ID;
    });

    // 6. Restore code from the shelf — markdown-it now sees the original
    //    code blocks and inline spans, unmodified.
    out = out.replace(CODE_RE, function (_, idx) { return codeShelf[+idx]; });

    return { src: out, slots: slots };
  }

  /* Keep replacement's newline count equal to the original match's so
     markdown-it's source-line numbers remain stable for content below.
     We pad with trailing newlines if short, or trim trailing newlines
     if long (but always keep at least one for paragraph separation). */
  function padLines(original, replacement) {
    const want = (original.match(/\n/g) || []).length;
    const got = (replacement.match(/\n/g) || []).length;
    if (got === want) return replacement;
    if (got < want) return replacement + '\n'.repeat(want - got);
    const trail = (replacement.match(/\n+$/) || [''])[0].length;
    const removable = Math.max(0, trail - 1);
    const toRemove = Math.min(got - want, removable);
    return toRemove ? replacement.slice(0, replacement.length - toRemove) : replacement;
  }

  function lineFromOffset(src, offset) {
    let line = 0;
    const end = Math.min(offset, src.length);
    for (let i = 0; i < end; i++) {
      if (src.charCodeAt(i) === 10) line++;
    }
    return line;
  }

  /* Restore placeholders after rendering, before sanitization. */
  function restorePlaceholders(html, slots) {
    // markdown-it wraps the bare block marker in <p ...>...</p>.
    // Replace the whole <p> with the real block element.
    html = html.replace(PARA_BLOCK_RE, function (_, idx) {
      return renderBlockSlot(slots[+idx]);
    });
    // Defensive: stray block markers that escaped the <p> wrap.
    html = html.replace(BLOCK_RE, function (_, idx) {
      return renderBlockSlot(slots[+idx]);
    });
    // Inline markers
    html = html.replace(INLINE_RE, function (_, idx) {
      const slot = slots[+idx];
      if (!slot) return '';
      return '<span class="mdv-math" data-display="inline">' +
        escapeAttr(slot.body) + '</span>';
    });
    return html;
  }

  function renderBlockSlot(slot) {
    if (!slot) return '';
    if (slot.kind === 'mermaid') {
      return '<div class="mermaid mdv-slot source-line" data-source-line="' +
        slot.line + '" data-mdv-kind="mermaid">' + escapeAttr(slot.body) + '</div>';
    }
    if (slot.kind === 'math-block') {
      return '<div class="mdv-math source-line" data-source-line="' +
        slot.line + '" data-display="block">' + escapeAttr(slot.body) + '</div>';
    }
    return '';
  }

  /* ---------- DOMPurify config ---------- */
  const PURIFY_CONFIG = {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: ['target', 'data-source-line', 'data-mdv-kind', 'data-display', 'aria-hidden', 'id'],
    ADD_TAGS: ['details', 'summary', 'mark'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit'],
    ALLOW_DATA_ATTR: true
  };

  if (window.DOMPurify) {
    // Allow task list checkboxes (disabled only)
    window.DOMPurify.addHook('uponSanitizeElement', function (node, data) {
      if (data.tagName === 'input') {
        const type = (node.getAttribute('type') || '').toLowerCase();
        const cls = node.getAttribute('class') || '';
        if (type === 'checkbox' && /\btask-list-checkbox\b/.test(cls)) {
          node.setAttribute('disabled', '');
        } else if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    });
    window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  /* ---------- mermaid (lazy load) ---------- */
  let mermaidLoading = null;
  function ensureMermaid() {
    if (window.mermaid && window.__mdvMermaidReady) return Promise.resolve(window.mermaid);
    if (mermaidLoading) return mermaidLoading;
    mermaidLoading = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
      s.async = true;
      s.onload = function () {
        try {
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: document.documentElement.classList.contains('theme-dark') ? 'dark' : 'default',
            flowchart: { htmlLabels: true, useMaxWidth: true },
            fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-sans') || 'sans-serif'
          });
          window.__mdvMermaidReady = true;
        } catch (e) { /* ignore */ }
        resolve(window.mermaid);
      };
      s.onerror = function () {
        mermaidLoading = null;
        reject(new Error('mermaid load failed'));
      };
      document.head.appendChild(s);
    });
    return mermaidLoading;
  }

  function reinitMermaidTheme() {
    if (window.mermaid && window.__mdvMermaidReady) {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.classList.contains('theme-dark') ? 'dark' : 'default',
          flowchart: { htmlLabels: true, useMaxWidth: true }
        });
      } catch (_) { /* ignore */ }
    }
  }

  function renderMermaidBlocks(container) {
    const blocks = container.querySelectorAll('div.mermaid:not([data-processed])');
    if (!blocks.length) return Promise.resolve();
    return ensureMermaid().then(function (m) {
      const promises = [];
      blocks.forEach(function (block, i) {
        block.setAttribute('data-processed', '1');
        const id = 'mermaid-' + Date.now().toString(36) + '-' + i;
        const body = block.textContent;
        promises.push(
          m.render(id, body)
            .then(function (out) {
              block.innerHTML = out.svg;
              if (out.bindFunctions) out.bindFunctions(block);
            })
            .catch(function (err) {
              block.classList.add('mermaid-error');
              block.textContent = String((err && err.message) || err);
            })
        );
      });
      return Promise.all(promises);
    }).catch(function (err) {
      blocks.forEach(function (block) {
        block.classList.add('mermaid-error');
        block.textContent = 'Failed to load mermaid: ' + ((err && err.message) || err);
      });
    });
  }

  /* ---------- KaTeX rendering ---------- */
  function renderMath(container) {
    if (!window.katex) return;
    const nodes = container.querySelectorAll('.mdv-math');
    nodes.forEach(function (node) {
      const display = node.getAttribute('data-display') === 'block';
      const tex = node.textContent;
      try {
        window.katex.render(tex, node, {
          displayMode: display,
          throwOnError: false,
          errorColor: 'var(--color-danger)',
          strict: 'ignore',
          trust: false,
          output: 'html'
        });
      } catch (e) {
        node.textContent = tex;
        node.classList.add('mermaid-error');
      }
    });
  }

  /* ---------- main render ---------- */
  function render(src, target) {
    const extracted = extractBlocks(src || '');
    let html;
    try {
      html = md.render(extracted.src);
    } catch (e) {
      html = '<p class="mermaid-error">Render error: ' +
        escapeAttr(e.message || String(e)) + '</p>';
    }
    html = restorePlaceholders(html, extracted.slots);

    const sanitized = window.DOMPurify
      ? window.DOMPurify.sanitize(html, PURIFY_CONFIG)
      : html;

    target.innerHTML = sanitized;

    renderMath(target);
    if (window.MdvAttachments && window.MdvAttachments.rewriteImageSrcs) {
      window.MdvAttachments.rewriteImageSrcs(target);
    }
    return renderMermaidBlocks(target);
  }

  /* Build a sorted list of [{line, top, el}] for sync scroll. */
  function buildSourceMap(container) {
    const out = [];
    const els = container.querySelectorAll('[data-source-line]');
    els.forEach(function (el) {
      const n = parseInt(el.getAttribute('data-source-line'), 10);
      if (!Number.isFinite(n)) return;
      out.push(el);
    });
    return out;
  }

  /* ---------- exports ---------- */
  window.MdvMarkdown = {
    render: render,
    buildSourceMap: buildSourceMap,
    reinitMermaidTheme: reinitMermaidTheme
  };
})();
