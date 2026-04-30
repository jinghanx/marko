import { useEffect, useMemo, useRef, useState } from 'react';
import { Fzf, type FzfResultItem } from 'fzf';
import { workspace, type TabKind } from '../state/workspace';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FileType {
  name: string;
  ext: string; // includes leading dot
  kind: TabKind;
  language?: string; // CodeMirror language name
  hint: string;
}

const TYPES: FileType[] = [
  { name: 'Markdown',       ext: '.md',   kind: 'markdown',                              hint: 'Default — WYSIWYG editor' },
  { name: 'Plain Text',     ext: '.txt',  kind: 'code',                                  hint: 'Unstyled text' },
  { name: 'JavaScript',     ext: '.js',   kind: 'code', language: 'javascript',          hint: 'ES module' },
  { name: 'TypeScript',     ext: '.ts',   kind: 'code', language: 'typescript',          hint: '' },
  { name: 'TSX',            ext: '.tsx',  kind: 'code', language: 'tsx',                 hint: 'React TypeScript' },
  { name: 'JSX',            ext: '.jsx',  kind: 'code', language: 'jsx',                 hint: 'React JavaScript' },
  { name: 'Python',         ext: '.py',   kind: 'code', language: 'python',              hint: '' },
  { name: 'Rust',           ext: '.rs',   kind: 'code', language: 'rust',                hint: '' },
  { name: 'Go',             ext: '.go',   kind: 'code', language: 'go',                  hint: '' },
  { name: 'Java',           ext: '.java', kind: 'code', language: 'java',                hint: '' },
  { name: 'C',              ext: '.c',    kind: 'code', language: 'c',                   hint: '' },
  { name: 'C++',            ext: '.cpp',  kind: 'code', language: 'c++',                 hint: '' },
  { name: 'Ruby',           ext: '.rb',   kind: 'code', language: 'ruby',                hint: '' },
  { name: 'PHP',            ext: '.php',  kind: 'code', language: 'php',                 hint: '' },
  { name: 'Swift',          ext: '.swift',kind: 'code', language: 'swift',               hint: '' },
  { name: 'JSON',           ext: '.json', kind: 'code', language: 'json',                hint: '' },
  { name: 'YAML',           ext: '.yml',  kind: 'code', language: 'yaml',                hint: '' },
  { name: 'TOML',           ext: '.toml', kind: 'code',                                  hint: '' },
  { name: 'CSV',            ext: '.csv',  kind: 'code',                                  hint: 'Comma-separated values' },
  { name: 'TSV',            ext: '.tsv',  kind: 'code',                                  hint: 'Tab-separated values' },
  { name: 'HTML',           ext: '.html', kind: 'code', language: 'html',                hint: '' },
  { name: 'CSS',            ext: '.css',  kind: 'code', language: 'css',                 hint: '' },
  { name: 'SCSS',           ext: '.scss', kind: 'code', language: 'sass',                hint: '' },
  { name: 'XML',            ext: '.xml',  kind: 'code', language: 'xml',                 hint: '' },
  { name: 'SQL',            ext: '.sql',  kind: 'code', language: 'sql',                 hint: '' },
  { name: 'Shell',          ext: '.sh',   kind: 'code', language: 'shell',               hint: 'bash/sh' },
  { name: 'Dockerfile',     ext: '',      kind: 'code',                                  hint: 'Container build script' },
  { name: 'Makefile',       ext: '',      kind: 'code',                                  hint: '' },
  { name: 'Vue',            ext: '.vue',  kind: 'code', language: 'vue',                 hint: '' },
  { name: 'Svelte',         ext: '.svelte', kind: 'code', language: 'svelte',            hint: '' },
];

export function NewFilePicker({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const fzf = useMemo(
    () => new Fzf(TYPES, { selector: (t) => `${t.name} ${t.ext} ${t.language ?? ''}` }),
    [],
  );

  const results: FzfResultItem<FileType>[] = useMemo(() => {
    if (!query) {
      return TYPES.map(
        (t) =>
          ({
            item: t,
            positions: new Set<number>(),
            start: 0,
            end: 0,
            score: 0,
          } as FzfResultItem<FileType>),
      );
    }
    return fzf.find(query);
  }, [fzf, query]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1));
  }, [results.length, activeIndex]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const choose = (i: number) => {
    const t = results[i]?.item;
    if (!t) return;
    onClose();
    workspace.openNewTab({
      kind: t.kind,
      language: t.language,
      ext: t.ext || undefined,
      title: t.ext ? `Untitled${t.ext}` : t.name,
    });
    workspace.requestEditorFocus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="New file — type to filter (Markdown, Python, JSON…)"
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette-results" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">No matches.</div>}
          {results.map((r, i) => (
            <Row
              key={r.item.name}
              type={r.item}
              positions={r.positions}
              index={i}
              active={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(i)}
            />
          ))}
        </div>
        <div className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> create</span>
          <span><kbd>esc</kbd> cancel</span>
        </div>
      </div>
    </div>
  );
}

function Row({
  type,
  positions,
  index,
  active,
  onMouseEnter,
  onClick,
}: {
  type: FileType;
  positions: Set<number>;
  index: number;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <div
      data-index={index}
      className={`palette-row newfile-row ${active ? 'palette-row--active' : ''}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="newfile-name">{highlight(type.name, positions, 0)}</span>
      <span className="newfile-ext">{type.ext || '—'}</span>
      {type.hint && <span className="newfile-hint">{type.hint}</span>}
    </div>
  );
}

function highlight(text: string, positions: Set<number>, offset: number) {
  if (!positions.size) return text;
  const out: React.ReactNode[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    if (positions.has(i + offset)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      out.push(
        <span key={i} className="palette-match">
          {text[i]}
        </span>,
      );
    } else {
      buf += text[i];
    }
  }
  if (buf) out.push(buf);
  return out;
}
