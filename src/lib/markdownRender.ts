import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

// We attach a `line` property to each top-level token before parsing so the
// renderer can stamp `data-source-line` on the corresponding HTML block. The
// preview/editor scroll-sync logic walks these markers.
type Lined<T> = T & { line?: number };

function annotateLines(tokens: Tokens.Generic[]): void {
  let line = 0;
  for (const tok of tokens) {
    (tok as Lined<Tokens.Generic>).line = line;
    const raw = tok.raw ?? '';
    for (let i = 0; i < raw.length; i++) {
      if (raw.charCodeAt(i) === 10) line++;
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attr(name: string, value: string | number | undefined): string {
  if (value === undefined || value === '') return '';
  return ` ${name}="${escapeHtml(String(value))}"`;
}

const md = new Marked({ gfm: true, breaks: false });

md.use({
  renderer: {
    heading(token: Tokens.Heading) {
      const line = (token as Lined<Tokens.Heading>).line ?? 0;
      const text = this.parser.parseInline(token.tokens);
      return `<h${token.depth} data-source-line="${line}">${text}</h${token.depth}>\n`;
    },
    paragraph(token: Tokens.Paragraph) {
      const line = (token as Lined<Tokens.Paragraph>).line ?? 0;
      return `<p data-source-line="${line}">${this.parser.parseInline(token.tokens)}</p>\n`;
    },
    blockquote(token: Tokens.Blockquote) {
      const line = (token as Lined<Tokens.Blockquote>).line ?? 0;
      const body = this.parser.parse(token.tokens);
      return `<blockquote data-source-line="${line}">\n${body}</blockquote>\n`;
    },
    list(token: Tokens.List) {
      const line = (token as Lined<Tokens.List>).line ?? 0;
      const tag = token.ordered ? 'ol' : 'ul';
      const start =
        token.ordered && token.start !== 1 ? ` start="${escapeHtml(String(token.start))}"` : '';
      let body = '';
      for (const item of token.items) body += this.listitem(item);
      return `<${tag} data-source-line="${line}"${start}>\n${body}</${tag}>\n`;
    },
    code(token: Tokens.Code) {
      const line = (token as Lined<Tokens.Code>).line ?? 0;
      const lang = (token.lang ?? '').trim().split(/\s+/)[0] ?? '';
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return `<pre data-source-line="${line}"><code${cls}>${escapeHtml(token.text)}\n</code></pre>\n`;
    },
    hr(token: Tokens.Hr) {
      const line = (token as Lined<Tokens.Hr>).line ?? 0;
      return `<hr data-source-line="${line}" />\n`;
    },
    table(token: Tokens.Table) {
      const line = (token as Lined<Tokens.Table>).line ?? 0;
      let head = '';
      for (let i = 0; i < token.header.length; i++) {
        head += this.tablecell({ ...token.header[i], header: true, align: token.align[i] });
      }
      let body = '';
      for (const row of token.rows) {
        let cells = '';
        for (let i = 0; i < row.length; i++) {
          cells += this.tablecell({ ...row[i], header: false, align: token.align[i] });
        }
        body += `<tr>${cells}</tr>\n`;
      }
      return (
        `<table data-source-line="${line}">\n` +
        `<thead>\n<tr>${head}</tr>\n</thead>\n` +
        `<tbody>${body}</tbody>\n` +
        `</table>\n`
      );
    },
  },
});

/** Parse markdown into sanitized HTML with `data-source-line` markers on
 *  top-level blocks. Code blocks are emitted plain — `highlightCodeBlocks`
 *  upgrades them after the HTML is in the DOM. */
export function renderMarkdown(content: string): string {
  const tokens = md.lexer(content);
  annotateLines(tokens as Tokens.Generic[]);
  const raw = md.parser(tokens);
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['data-source-line'],
  });
}
