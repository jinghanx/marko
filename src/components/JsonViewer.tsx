import { useMemo, useState } from 'react';
import { workspace, useWorkspace } from '../state/workspace';
import { CodeEditor } from './CodeEditor';

interface Props {
  tabId: string;
  filePath: string | null;
  initialValue: string;
}

/** JSON tab: tree | raw | split. Mirrors the markdown view-mode pattern.
 *  Tree view is read-only; edits go through the raw CodeMirror pane. */
export function JsonViewer({ tabId, filePath, initialValue }: Props) {
  const mode = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.viewMode ?? 'tree');
  const setMode = (m: 'tree' | 'raw' | 'split') =>
    workspace.setMarkdownViewMode(tabId, m);

  return (
    <div className="json-viewer">
      <div className="md-mode-toggle" title="JSON view (⌘⇧M cycles)">
        <button
          className={`md-mode-btn${mode === 'tree' ? ' md-mode-btn--active' : ''}`}
          onClick={() => setMode('tree')}
          title="Tree"
          aria-label="Tree"
        >
          <TreeIcon />
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
      {mode === 'raw' && (
        <div className="json-raw-pane">
          <CodeEditor
            tabId={tabId}
            initialValue={initialValue}
            filePath={filePath}
            language="json"
          />
        </div>
      )}
      {mode === 'tree' && <JsonTreePane tabId={tabId} />}
      {mode === 'split' && (
        <div className="json-split">
          <div className="json-split-pane">
            <CodeEditor
              tabId={tabId}
              initialValue={initialValue}
              filePath={filePath}
              language="json"
            />
          </div>
          <div className="json-split-pane json-split-pane--tree">
            <JsonTreePane tabId={tabId} />
          </div>
        </div>
      )}
    </div>
  );
}

function JsonTreePane({ tabId }: { tabId: string }) {
  const content = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.content ?? '');
  const parsed = useMemo<{ ok: true; value: unknown } | { ok: false; error: string }>(() => {
    try {
      return { ok: true, value: JSON.parse(content) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [content]);

  if (!parsed.ok) {
    return (
      <div className="json-tree-pane json-tree-pane--error">
        <span className="json-tree-error-tag">parse error</span>
        <span className="json-tree-error-msg">{parsed.error}</span>
      </div>
    );
  }
  return (
    <div className="json-tree-pane">
      <JsonNode value={parsed.value} keyName={null} depth={0} />
    </div>
  );
}

interface NodeProps {
  value: unknown;
  keyName: string | number | null;
  depth: number;
}

function JsonNode({ value, keyName, depth }: NodeProps) {
  // Auto-collapse only at deeper levels; shallow data should be visible by default.
  const [collapsed, setCollapsed] = useState(depth >= 3);

  const keyLabel =
    keyName === null
      ? null
      : typeof keyName === 'number'
        ? `${keyName}`
        : `"${keyName}"`;

  if (value === null) return <Leaf keyLabel={keyLabel} cls="json-null" text="null" />;
  if (typeof value === 'string')
    return <Leaf keyLabel={keyLabel} cls="json-string" text={JSON.stringify(value)} />;
  if (typeof value === 'number')
    return <Leaf keyLabel={keyLabel} cls="json-number" text={String(value)} />;
  if (typeof value === 'boolean')
    return <Leaf keyLabel={keyLabel} cls="json-bool" text={String(value)} />;

  if (Array.isArray(value)) {
    const len = value.length;
    return (
      <div className="json-row json-row--container">
        <span
          className="json-toggle"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▶' : '▼'}
        </span>
        {keyLabel && <span className="json-key">{keyLabel}: </span>}
        <span className="json-bracket">[</span>
        {collapsed ? (
          <>
            <span className="json-summary">{len} items</span>
            <span className="json-bracket">]</span>
          </>
        ) : (
          <div className="json-children">
            {value.map((v, i) => (
              <JsonNode key={i} value={v} keyName={i} depth={depth + 1} />
            ))}
            <span className="json-bracket json-bracket--close">]</span>
          </div>
        )}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="json-row json-row--container">
        <span
          className="json-toggle"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▶' : '▼'}
        </span>
        {keyLabel && <span className="json-key">{keyLabel}: </span>}
        <span className="json-bracket">{'{'}</span>
        {collapsed ? (
          <>
            <span className="json-summary">{entries.length} keys</span>
            <span className="json-bracket">{'}'}</span>
          </>
        ) : (
          <div className="json-children">
            {entries.map(([k, v]) => (
              <JsonNode key={k} value={v} keyName={k} depth={depth + 1} />
            ))}
            <span className="json-bracket json-bracket--close">{'}'}</span>
          </div>
        )}
      </div>
    );
  }

  return <Leaf keyLabel={keyLabel} cls="json-other" text={String(value)} />;
}

function Leaf({
  keyLabel,
  cls,
  text,
}: {
  keyLabel: string | null;
  cls: string;
  text: string;
}) {
  return (
    <div className="json-row">
      {keyLabel && <span className="json-key">{keyLabel}: </span>}
      <span className={cls}>{text}</span>
    </div>
  );
}

function TreeIcon() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden fill="none">
      <path
        d="M3 4 H6 M3 8 H8 M3 12 H6 M3 4 V12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="9" cy="4" r="1.2" fill="currentColor" />
      <circle cx="11" cy="8" r="1.2" fill="currentColor" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" />
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
