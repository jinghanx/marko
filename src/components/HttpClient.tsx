import { useEffect, useMemo, useState } from 'react';
import type { HttpHeader, HttpResponseInfo } from '../types/marko';
import { workspace } from '../state/workspace';

interface Props {
  tabId: string;
  initialValue: string;
}

interface RequestState {
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const DEFAULT_REQUEST: RequestState = {
  method: 'GET',
  url: 'https://httpbin.org/get',
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  body: '',
};

function parseRequest(text: string): RequestState | null {
  if (!text || !text.trim()) return null;
  try {
    const r = JSON.parse(text) as RequestState;
    if (!r.method || !Array.isArray(r.headers)) return null;
    return r;
  } catch {
    return null;
  }
}

/** HTTP client tab — request builder + response viewer. The actual request
 *  runs in the main process (no CORS, can hit any host). The request config
 *  persists in tab.content as JSON so it survives restarts. */
export function HttpClient({ tabId, initialValue }: Props) {
  const [req, setReq] = useState<RequestState>(parseRequest(initialValue) ?? DEFAULT_REQUEST);
  const [response, setResponse] = useState<HttpResponseInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [reqTab, setReqTab] = useState<'headers' | 'body'>('headers');
  const [resTab, setResTab] = useState<'body' | 'headers'>('body');

  // Persist request config (debounced via React's natural batching).
  useEffect(() => {
    workspace.updateContent(tabId, JSON.stringify(req));
  }, [tabId, req]);

  const send = async () => {
    if (!req.url.trim()) return;
    setLoading(true);
    setResponse(null);
    try {
      const r = await window.marko.httpRequest({
        method: req.method,
        url: req.url.trim(),
        headers: req.headers,
        body: req.body,
      });
      setResponse(r);
    } finally {
      setLoading(false);
    }
  };

  // Detect JSON response for pretty-printing.
  const prettyBody = useMemo(() => {
    if (!response?.body) return null;
    const ct = (response.headers?.['content-type'] ?? '').toLowerCase();
    if (!ct.includes('json')) return null;
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return null;
    }
  }, [response]);

  return (
    <div className="http-client">
      <div className="http-toolbar">
        <select
          className={`http-method http-method--${req.method.toLowerCase()}`}
          value={req.method}
          onChange={(e) => setReq({ ...req, method: e.target.value })}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="http-url"
          value={req.url}
          onChange={(e) => setReq({ ...req, url: e.target.value })}
          placeholder="https://api.example.com/endpoint"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="http-send"
          onClick={() => void send()}
          disabled={loading || !req.url.trim()}
          title="Send (⌘↵)"
        >
          {loading ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="http-tabs">
        <button
          className={`http-tab${reqTab === 'headers' ? ' http-tab--active' : ''}`}
          onClick={() => setReqTab('headers')}
        >
          Headers <span className="http-tab-count">{req.headers.filter((h) => h.enabled !== false && h.key).length}</span>
        </button>
        <button
          className={`http-tab${reqTab === 'body' ? ' http-tab--active' : ''}`}
          onClick={() => setReqTab('body')}
        >
          Body
        </button>
      </div>

      <div className="http-pane">
        {reqTab === 'headers' ? (
          <HeadersEditor
            headers={req.headers}
            onChange={(headers) => setReq({ ...req, headers })}
          />
        ) : (
          <textarea
            className="http-body"
            value={req.body}
            onChange={(e) => setReq({ ...req, body: e.target.value })}
            placeholder={
              req.method === 'GET' || req.method === 'HEAD'
                ? `(no body for ${req.method})`
                : '{"hello": "world"}'
            }
            spellCheck={false}
          />
        )}
      </div>

      <div className="http-response">
        {response ? (
          <>
            <div className="http-response-status">
              {response.ok ? (
                <>
                  <span
                    className={`http-status http-status--${Math.floor((response.status ?? 0) / 100)}xx`}
                  >
                    {response.status} {response.statusText}
                  </span>
                  <span className="http-response-meta">
                    {response.timeMs} ms · {formatSize(response.size ?? 0)}
                  </span>
                </>
              ) : (
                <span className="http-status http-status--err">Error: {response.error}</span>
              )}
            </div>

            <div className="http-tabs">
              <button
                className={`http-tab${resTab === 'body' ? ' http-tab--active' : ''}`}
                onClick={() => setResTab('body')}
              >
                Body
              </button>
              <button
                className={`http-tab${resTab === 'headers' ? ' http-tab--active' : ''}`}
                onClick={() => setResTab('headers')}
              >
                Headers <span className="http-tab-count">{Object.keys(response.headers ?? {}).length}</span>
              </button>
            </div>

            <div className="http-pane">
              {resTab === 'body' ? (
                <pre className="http-response-body">
                  {prettyBody ?? response.body ?? ''}
                </pre>
              ) : (
                <div className="http-headers-list">
                  {Object.entries(response.headers ?? {}).map(([k, v]) => (
                    <div key={k} className="http-headers-row">
                      <span className="http-headers-key">{k}</span>
                      <span className="http-headers-val">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="http-response-empty">Send a request to see the response.</div>
        )}
      </div>
    </div>
  );
}

function HeadersEditor({
  headers,
  onChange,
}: {
  headers: HttpHeader[];
  onChange: (h: HttpHeader[]) => void;
}) {
  const update = (i: number, patch: Partial<HttpHeader>) => {
    const next = headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h));
    onChange(next);
  };
  const remove = (i: number) => onChange(headers.filter((_, idx) => idx !== i));
  const add = () => onChange([...headers, { key: '', value: '', enabled: true }]);

  return (
    <div className="http-headers-editor">
      {headers.map((h, i) => (
        <div key={i} className="http-header-row">
          <label className="http-header-toggle">
            <input
              type="checkbox"
              checked={h.enabled !== false}
              onChange={(e) => update(i, { enabled: e.target.checked })}
            />
          </label>
          <input
            className="http-header-key"
            value={h.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder="Header"
          />
          <input
            className="http-header-val"
            value={h.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value"
          />
          <button
            className="http-header-remove"
            onClick={() => remove(i)}
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button className="http-header-add" onClick={add}>
        + Add header
      </button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
