import { LanguageDescription, type LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightTree, classHighlighter } from '@lezer/highlight';

const supportCache = new Map<string, LanguageSupport>();
const negativeCache = new Set<string>();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function loadLang(name: string): Promise<LanguageSupport | null> {
  if (negativeCache.has(name)) return null;
  const cached = supportCache.get(name);
  if (cached) return cached;
  const desc = LanguageDescription.matchLanguageName(languages, name, true);
  if (!desc) {
    negativeCache.add(name);
    return null;
  }
  const support = await desc.load();
  supportCache.set(name, support);
  // Also key by the canonical name so re-lookups (e.g., "js" vs "javascript")
  // hit the cache.
  supportCache.set(desc.name.toLowerCase(), support);
  return support;
}

/** Walk every `<code class="language-X">` under `root`, parse it with the
 *  matching CodeMirror/Lezer language, and replace its contents with
 *  `<span class="tok-*">` chunks via the same `classHighlighter` the editor
 *  uses. Aborts cleanly if `signal` fires mid-stream. */
export async function highlightCodeBlocks(
  root: HTMLElement,
  signal?: AbortSignal,
): Promise<void> {
  const codes = root.querySelectorAll<HTMLElement>('code[class*="language-"]');
  for (const codeEl of Array.from(codes)) {
    if (signal?.aborted) return;
    if (codeEl.dataset.highlighted) continue;
    const match = codeEl.className.match(/language-([^\s]+)/);
    if (!match) continue;
    const langName = match[1].toLowerCase();
    const support = await loadLang(langName);
    if (signal?.aborted) return;
    if (!support) {
      codeEl.dataset.highlighted = 'noop';
      continue;
    }
    const code = codeEl.textContent ?? '';
    const tree = support.language.parser.parse(code);
    let out = '';
    let pos = 0;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (from > pos) out += escapeHtml(code.slice(pos, from));
      out += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
      pos = to;
    });
    if (pos < code.length) out += escapeHtml(code.slice(pos));
    codeEl.innerHTML = out;
    codeEl.dataset.highlighted = 'true';
  }
}
