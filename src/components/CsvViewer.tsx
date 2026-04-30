import { useMemo, useState } from 'react';
import { isTsvPath } from '../lib/fileType';
import { workspace, useWorkspace } from '../state/workspace';
import { CodeEditor } from './CodeEditor';

interface Props {
  tabId: string;
  filePath: string | null;
  initialValue: string;
}

/** CSV / TSV tab. Rendered (table) is the default; Raw drops into a
 *  CodeMirror editor so you can edit the source. View modes use the same
 *  toggle styling as the markdown / json viewers. */
export function CsvViewer({ tabId, filePath, initialValue }: Props) {
  // CSV uses 'rendered' (table) and 'raw' (CodeMirror). 'split' is also
  // supported via the workspace's shared viewMode field.
  const mode = useWorkspace(
    (s) => (s.tabs.find((t) => t.id === tabId)?.viewMode as 'rendered' | 'raw' | 'split' | undefined) ?? 'rendered',
  );
  const setMode = (m: 'rendered' | 'raw' | 'split') =>
    workspace.setMarkdownViewMode(tabId, m);

  return (
    <div className="csv-viewer">
      <div className="md-mode-toggle" title="CSV view">
        <button
          className={`md-mode-btn${mode === 'rendered' ? ' md-mode-btn--active' : ''}`}
          onClick={() => setMode('rendered')}
          title="Table"
          aria-label="Table"
        >
          <TableIcon />
        </button>
        <button
          className={`md-mode-btn${mode === 'split' ? ' md-mode-btn--active' : ''}`}
          onClick={() => setMode('split')}
          title="Split"
          aria-label="Split"
        >
          <SplitIcon />
        </button>
        <button
          className={`md-mode-btn${mode === 'raw' ? ' md-mode-btn--active' : ''}`}
          onClick={() => setMode('raw')}
          title="Raw"
          aria-label="Raw"
        >
          <RawIcon />
        </button>
      </div>
      {mode === 'rendered' && <CsvTablePane tabId={tabId} filePath={filePath} />}
      {mode === 'raw' && (
        <div className="csv-raw-pane">
          <CodeEditor
            tabId={tabId}
            initialValue={initialValue}
            filePath={filePath}
          />
        </div>
      )}
      {mode === 'split' && (
        <div className="csv-split">
          <div className="csv-split-pane">
            <CodeEditor
              tabId={tabId}
              initialValue={initialValue}
              filePath={filePath}
            />
          </div>
          <div className="csv-split-pane csv-split-pane--table">
            <CsvTablePane tabId={tabId} filePath={filePath} />
          </div>
        </div>
      )}
    </div>
  );
}

type SortDir = 'asc' | 'desc' | null;

function CsvTablePane({ tabId, filePath }: { tabId: string; filePath: string | null }) {
  const content = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.content ?? '');
  const delimiter = filePath && isTsvPath(filePath) ? '\t' : ',';
  const rows = useMemo(() => parseCsv(content, delimiter), [content, delimiter]);
  const headers = rows[0] ?? [];
  const dataRows = useMemo(() => rows.slice(1), [rows]);

  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const sortedRows = useMemo(() => {
    if (sortCol === null || sortDir === null) return dataRows;
    const idx = sortCol;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...dataRows].sort((a, b) => {
      const av = a[idx] ?? '';
      const bv = b[idx] ?? '';
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
      return av.localeCompare(bv) * dir;
    });
  }, [dataRows, sortCol, sortDir]);

  const onHeaderClick = (idx: number) => {
    if (sortCol !== idx) {
      setSortCol(idx);
      setSortDir('asc');
      return;
    }
    if (sortDir === 'asc') setSortDir('desc');
    else if (sortDir === 'desc') {
      setSortCol(null);
      setSortDir(null);
    } else setSortDir('asc');
  };

  return (
    <div className="csv-table-pane">
      <div className="csv-toolbar">
        <span className="csv-meta">
          {dataRows.length} row{dataRows.length === 1 ? '' : 's'} · {headers.length} col
          {headers.length === 1 ? '' : 's'}
        </span>
        <span className="csv-kind">{delimiter === '\t' ? 'TSV' : 'CSV'}</span>
      </div>
      <div className="csv-scroll">
        <table className="csv-table">
          <thead>
            <tr>
              <th className="csv-th csv-th--num" />
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={`csv-th${sortCol === i ? ' csv-th--sorted' : ''}`}
                  onClick={() => onHeaderClick(i)}
                  title={h}
                >
                  <span className="csv-th-name">{h || `col ${i + 1}`}</span>
                  {sortCol === i && (
                    <span className="csv-sort-arrow">
                      {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => (
              <tr key={ri}>
                <td className="csv-num">{ri + 1}</td>
                {headers.map((_, ci) => (
                  <td key={ci} className="csv-cell">
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Minimal RFC-4180 CSV parser. Handles double-quoted fields and embedded
 *  newlines/quotes ("" → "). For TSV pass `'\t'` as the delimiter. */
function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function TableIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RawIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <path
        d="M6 4 L2 8 L6 12 M10 4 L14 8 L10 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
