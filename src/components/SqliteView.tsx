import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SqliteSchema, SqliteSchemaTable, SqliteQueryResult } from '../types/marko';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { sql } from '@codemirror/lang-sql';
import { indentWithTab } from '@codemirror/commands';

interface Props {
  tabId: string;
  filePath: string;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function fileBasename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function formatRowCount(n: number | null): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  return n.toLocaleString();
}

function formatCell(v: unknown): { text: string; cls?: string } {
  if (v === null || v === undefined) return { text: 'NULL', cls: 'sql-cell-null' };
  if (typeof v === 'boolean') return { text: v ? 'true' : 'false' };
  if (typeof v === 'number' || typeof v === 'bigint') return { text: String(v), cls: 'sql-cell-num' };
  if (v instanceof Uint8Array) return { text: `<BLOB ${v.byteLength}B>`, cls: 'sql-cell-blob' };
  // Buffer instances cross the IPC boundary as { type: 'Buffer', data: number[] }
  if (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((v as { data?: unknown }).data)
  ) {
    const data = (v as unknown as { data: number[] }).data;
    return { text: `<BLOB ${data.length}B>`, cls: 'sql-cell-blob' };
  }
  return { text: String(v) };
}

export function SqliteView({ tabId, filePath }: Props) {
  const [schema, setSchema] = useState<SqliteSchema | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>(() => {
    const stored = sessionStorage.getItem(`marko:sqlite:query:${tabId}`);
    return stored ?? '-- Click a table on the left, or write any SQL and press ⌘↵\n';
  });
  const [result, setResult] = useState<SqliteQueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const refreshSchema = useCallback(async () => {
    const r = await window.marko.sqliteSchema(filePath);
    if (r.ok && r.data) {
      setSchema(r.data);
      setSchemaError(null);
    } else {
      setSchema(null);
      setSchemaError(r.error ?? 'Failed to read schema');
    }
  }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const open = await window.marko.sqliteOpen(filePath);
      if (cancelled) return;
      if (!open.ok) {
        setSchemaError(open.error ?? 'Failed to open database');
        return;
      }
      await refreshSchema();
    })();
    return () => {
      cancelled = true;
      // Don't close the connection on unmount — the user may switch tabs
      // and back; we'd be churning file handles. The will-quit handler in
      // main cleans up at app shutdown.
    };
  }, [filePath, refreshSchema]);

  // Persist the in-flight query so re-mounts (StrictMode, tab switching)
  // don't lose the user's draft. Tab content is empty for sqlite tabs.
  useEffect(() => {
    sessionStorage.setItem(`marko:sqlite:query:${tabId}`, query);
  }, [tabId, query]);

  const runQuery = useCallback(
    async (sql: string) => {
      const trimmed = sql.trim();
      if (!trimmed) return;
      setBusy(true);
      try {
        const r = await window.marko.sqliteQuery(filePath, trimmed);
        setResult(r);
        // Schema may have changed for write queries — refresh.
        if (r.ok && r.isReadOnly === false) {
          await refreshSchema();
        }
      } finally {
        setBusy(false);
      }
    },
    [filePath, refreshSchema],
  );

  const browseTable = useCallback(
    (tbl: SqliteSchemaTable) => {
      const sql = `SELECT * FROM ${quoteIdent(tbl.name)} LIMIT 100`;
      setQuery(sql);
      setActiveTable(tbl.name);
      void runQuery(sql);
    },
    [runQuery],
  );

  const filteredTables = useMemo(() => {
    if (!schema) return [];
    const q = filter.trim().toLowerCase();
    return schema.tables.filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [schema, filter]);

  return (
    <div className="sqlite-view">
      <aside className="sqlite-sidebar">
        <div className="sqlite-sidebar-header">
          <div className="sqlite-sidebar-title">{fileBasename(filePath)}</div>
          <div className="sqlite-sidebar-meta">
            {schema?.pragma.journalMode && (
              <span className="sqlite-pill" title="journal_mode">{schema.pragma.journalMode}</span>
            )}
            {schema?.pragma.foreignKeys && (
              <span className="sqlite-pill sqlite-pill--ok" title="PRAGMA foreign_keys = on">FK</span>
            )}
          </div>
        </div>
        <input
          className="sqlite-sidebar-filter"
          value={filter}
          placeholder="Filter tables…"
          spellCheck={false}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="sqlite-table-list">
          {schemaError ? (
            <div className="sqlite-empty">{schemaError}</div>
          ) : !schema ? (
            <div className="sqlite-empty">Loading schema…</div>
          ) : filteredTables.length === 0 ? (
            <div className="sqlite-empty">No tables match.</div>
          ) : (
            filteredTables.map((t) => (
              <SchemaTableRow
                key={`${t.type}:${t.name}`}
                table={t}
                active={activeTable === t.name}
                onBrowse={() => browseTable(t)}
              />
            ))
          )}
        </div>
      </aside>
      <div className="sqlite-main">
        <div className="sqlite-editor-wrap">
          <SqlEditor
            value={query}
            onChange={setQuery}
            onRun={() => void runQuery(query)}
          />
          <div className="sqlite-editor-toolbar">
            <button
              className="btn btn-primary"
              onClick={() => void runQuery(query)}
              disabled={busy}
              title="⌘↵"
            >
              {busy ? 'Running…' : 'Run ▶'}
            </button>
            <span className="sqlite-editor-hint">⌘↵ to run · read-only queries return rows; writes return affected count</span>
          </div>
        </div>
        <ResultPanel result={result} />
      </div>
    </div>
  );
}

function SchemaTableRow({
  table,
  active,
  onBrowse,
}: {
  table: SqliteSchemaTable;
  active: boolean;
  onBrowse: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`sqlite-table-row${active ? ' sqlite-table-row--active' : ''}`}>
      <div className="sqlite-table-row-main">
        <button
          className="sqlite-table-row-disclose"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse columns' : 'Expand columns'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button className="sqlite-table-row-name" onClick={onBrowse} title="Browse first 100 rows">
          <span className="sqlite-table-row-icon">{table.type === 'view' ? '◇' : '▦'}</span>
          <span className="sqlite-table-row-label">{table.name}</span>
          <span className="sqlite-table-row-count">{formatRowCount(table.rowCount)}</span>
        </button>
      </div>
      {expanded && (
        <div className="sqlite-column-list">
          {table.columns.map((c) => (
            <div key={c.name} className="sqlite-column-row">
              <span className={`sqlite-column-name${c.pk ? ' sqlite-column-name--pk' : ''}`}>
                {c.pk ? '🔑 ' : ''}
                {c.name}
              </span>
              <span className="sqlite-column-type">{c.type || 'BLOB'}</span>
              {c.notNull && <span className="sqlite-column-flag">NOT NULL</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: SqliteQueryResult | null }) {
  if (!result) {
    return (
      <div className="sqlite-result sqlite-result--empty">
        Run a query to see results here.
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="sqlite-result sqlite-result--error">
        <div className="sqlite-result-error-title">Query failed</div>
        <pre className="sqlite-result-error-body">{result.error}</pre>
        {result.timeMs != null && (
          <div className="sqlite-result-meta">{result.timeMs} ms</div>
        )}
      </div>
    );
  }
  if (result.isReadOnly === false) {
    return (
      <div className="sqlite-result sqlite-result--ok">
        <div>Statement executed. {result.changes} row{result.changes === 1 ? '' : 's'} changed.</div>
        {result.timeMs != null && (
          <div className="sqlite-result-meta">{result.timeMs} ms</div>
        )}
      </div>
    );
  }
  return <ResultGrid result={result} />;
}

function SqlEditor({
  value,
  onChange,
  onRun,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // We need stable refs to the latest callbacks so the editor doesn't have
  // to be re-created on every prop change.
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          syntaxHighlighting(classHighlighter),
          sql(),
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: () => {
                onRunRef.current();
                return true;
              },
            },
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally only init once — value updates flow through the
    // controlled effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value into the editor (e.g., when "Browse table" rewrites
  // the query). Skip if it's the same to avoid a feedback loop.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  return <div className="sqlite-sql-editor" ref={hostRef} />;
}

function ResultGrid({ result }: { result: SqliteQueryResult }) {
  const cols = result.columns ?? [];
  const rows = result.rows ?? [];
  return (
    <div className="sqlite-result">
      <div className="sqlite-result-meta">
        <span>
          {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
          {result.truncated && ' (truncated)'}
        </span>
        {result.timeMs != null && <span>· {result.timeMs} ms</span>}
        <span className="sqlite-result-spacer" />
      </div>
      {rows.length === 0 ? (
        <div className="sqlite-result-empty">Query ran successfully — no rows.</div>
      ) : (
        <div className="sqlite-grid-scroll">
          <table className="sqlite-grid">
            <thead>
              <tr>
                <th className="sqlite-grid-rownum">#</th>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="sqlite-grid-rownum">{i + 1}</td>
                  {row.map((cell, j) => {
                    const f = formatCell(cell);
                    return (
                      <td
                        key={j}
                        className={f.cls}
                        title={typeof cell === 'string' && cell.length > 120 ? cell : undefined}
                      >
                        {f.text.length > 200 ? f.text.slice(0, 200) + '…' : f.text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
