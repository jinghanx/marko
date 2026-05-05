/** ACP agent session — UI for one chat with an external agent (e.g.
 *  Claude Code) running as a subprocess in the main process.
 *
 *  Lifecycle: on mount we start the session via `acpStart`. The main
 *  process spawns the agent, runs the ACP `initialize` handshake,
 *  then `session/new`, and starts streaming `session/update`
 *  notifications back via `acp:event:${reqId}`. We translate those
 *  into transcript items, render them, and let the user submit
 *  prompts + cancel turns.
 *
 *  The transcript is held in component state, not persisted. Closing
 *  the tab disposes the subprocess; reopening (or restoring from a
 *  snapshot) starts a brand-new session — there's no `session/load`
 *  client support yet (deferred). */

import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useWorkspace, getActiveSession, workspace } from '../state/workspace';
import { useGlideCaretArea } from '../lib/useGlideCaretArea';
import { acpReviews, useAcpReviewsForReqId } from '../state/acpReviews';
import { openFileFromPath } from '../lib/actions';

interface InitialPayload {
  agentId: string;
  reqId: string;
}

type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      toolCallId: string;
      title: string;
      status: string;
      toolKind?: string;
      locations?: Array<{ path: string; line?: number }>;
    }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'system'; id: string; text: string };

interface PendingPermission {
  permId: string;
  toolCall: {
    title: string;
    toolCallId: string;
    kind?: string;
    locations?: Array<{ path: string; line?: number }>;
  };
  options: Array<{ optionId: string; name: string; kind: string }>;
}

type Status = 'connecting' | 'ready' | 'prompting' | 'cancelling' | 'errored' | 'exited';

export function AgentView({ tabId, initialValue }: { tabId: string; initialValue: string }) {
  const init = useMemo<InitialPayload | null>(() => {
    try {
      const v = JSON.parse(initialValue);
      if (v && typeof v.agentId === 'string' && typeof v.reqId === 'string') return v;
    } catch {
      // fall through
    }
    return null;
  }, [initialValue]);

  const cwd = useWorkspace((s) => getActiveSession(s).rootDir);
  const [status, setStatus] = useState<Status>('connecting');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [draft, setDraft] = useState('');

  /** Tool calls keyed by toolCallId — lets `tool_call_update` patch
   *  the in-place item rather than push a duplicate row. */
  const toolIndex = useRef(new Map<string, string>()); // toolCallId → transcript item id
  const nextItemId = useRef(0);
  const newItemId = () => `it-${++nextItemId.current}`;
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Glide-caret rig for the prompt textarea — same lerp effect as
  // the launcher input, address bar, and code editor cursor.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { mirrorRef: caretMirrorRef, caretRef, bumpInput, recompute } =
    useGlideCaretArea(textareaRef, draft);

  // Auto-scroll to bottom whenever the transcript grows.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript.length]);

  useEffect(() => {
    if (!init) return;
    let alive = true;
    const off = window.milu.onAcpEvent(init.reqId, (env) => {
      if (!alive) return;
      handleEvent(env.event, env.payload);
    });

    void window.milu
      .acpStart(init.reqId, init.agentId, cwd ?? process.env.HOME ?? '/')
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setStatus('ready');
          push({
            kind: 'system',
            id: newItemId(),
            text: 'Session started.',
          });
        } else {
          setStatus('errored');
          setErrorText(r.error ?? 'failed to start');
        }
      });

    return () => {
      alive = false;
      off();
      acpReviews.clearReqId(init.reqId);
      void window.milu.acpDispose(init.reqId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init?.reqId, init?.agentId]);

  const push = (item: TranscriptItem) =>
    setTranscript((prev) => [...prev, item]);

  const updateItem = (id: string, patch: Partial<TranscriptItem>) => {
    setTranscript((prev) =>
      prev.map((it) => (it.id === id ? ({ ...it, ...patch } as TranscriptItem) : it)),
    );
  };

  /** Append a chunk of text onto the latest assistant item; if the
   *  most-recent item isn't an assistant message, start a new one.
   *  This is how `agent_message_chunk` streams compose into a single
   *  paragraph instead of N separate rows. */
  const appendAssistant = (text: string) => {
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === 'assistant') {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { kind: 'assistant', id: newItemId(), text }];
    });
  };

  function handleEvent(event: string, payload: unknown) {
    if (event === 'update') {
      const u = (payload as { update?: { sessionUpdate: string; [k: string]: unknown } })?.update;
      if (!u) return;
      handleSessionUpdate(u);
    } else if (event === 'permission-request') {
      const p = payload as {
        permId: string;
        params: {
          toolCall: PendingPermission['toolCall'];
          options: PendingPermission['options'];
        };
      };
      setPermission({
        permId: p.permId,
        toolCall: p.params.toolCall,
        options: p.params.options,
      });
    } else if (event === 'stderr') {
      // Deliberately swallow into nothing — agent stderr is noisy
      // (auth log lines etc.). We could add a debug pane later.
    } else if (event === 'exit') {
      const code = (payload as { code?: number | null })?.code ?? 0;
      setStatus('exited');
      push({
        kind: 'system',
        id: newItemId(),
        text: `Agent exited (code ${code}).`,
      });
    } else if (event === 'error') {
      setStatus('errored');
      setErrorText(typeof payload === 'string' ? payload : 'error');
    } else if (event === 'file-written') {
      // Per the user's "overwrite" decision: any tab open on this
      // path is forcibly re-read from disk, dropping any unsaved
      // edits. Tool-call entries in the transcript already convey
      // *that* an edit happened; we just keep open buffers in sync.
      const p = (payload as { path?: string })?.path;
      if (p) {
        void invalidateTabsForPath(p);
        // The review for this path has just been settled; drop it
        // from the global store so EditorPane stops rendering the
        // inline-diff view.
        acpReviews.drop(p);
        // Re-list in case other reviews changed too.
        if (init) void refreshReviews(init.reqId);
      }
    } else if (event === 'review-created') {
      // A new pending agent write — refresh the store so the open
      // editor for that path switches into review mode.
      if (init) void refreshReviews(init.reqId);
    }
  }

  /** Pull the latest review snapshot from main and update the global
   *  store. Called after any event that might change the review
   *  list (review-created, file-written, agent exit). */
  async function refreshReviews(reqId: string) {
    try {
      const list = await window.milu.acpReviewList(reqId);
      acpReviews.replaceForReqId(reqId, list);
    } catch {
      // best effort — the next event will retry
    }
  }

  function handleSessionUpdate(u: { sessionUpdate: string; [k: string]: unknown }) {
    if (u.sessionUpdate === 'agent_message_chunk') {
      const c = u.content as { type?: string; text?: string } | undefined;
      if (c?.type === 'text' && typeof c.text === 'string') {
        appendAssistant(c.text);
      }
    } else if (u.sessionUpdate === 'tool_call') {
      const t = u as unknown as {
        toolCallId: string;
        title: string;
        status?: string;
        kind?: string;
        locations?: Array<{ path: string; line?: number }>;
      };
      const id = newItemId();
      toolIndex.current.set(t.toolCallId, id);
      push({
        kind: 'tool',
        id,
        toolCallId: t.toolCallId,
        title: t.title,
        status: t.status ?? 'pending',
        toolKind: t.kind,
        locations: t.locations,
      });
    } else if (u.sessionUpdate === 'tool_call_update') {
      const t = u as unknown as {
        toolCallId: string;
        status?: string;
        title?: string;
      };
      const id = toolIndex.current.get(t.toolCallId);
      if (id) {
        updateItem(id, {
          status: t.status,
          ...(t.title ? { title: t.title } : {}),
        } as Partial<TranscriptItem>);
      }
    }
    // Other update kinds (plan, agent_thought_chunk, mode change) are
    // ignored in v1 — the assistant message + tool call rows cover
    // the common case.
  }

  async function send() {
    const text = draft.trim();
    if (!text || !init || status !== 'ready') return;
    setDraft('');
    push({ kind: 'user', id: newItemId(), text });
    setStatus('prompting');
    const r = await window.milu.acpPrompt(init.reqId, text);
    setStatus(r.ok ? 'ready' : 'errored');
    if (!r.ok) {
      setErrorText(r.error ?? 'prompt failed');
      push({ kind: 'error', id: newItemId(), text: r.error ?? 'prompt failed' });
    }
  }

  async function cancel() {
    if (!init || status !== 'prompting') return;
    setStatus('cancelling');
    await window.milu.acpCancel(init.reqId);
    // Status will return to 'ready' when the prompt() promise resolves.
  }

  async function answerPermission(optionId: string | null) {
    if (!init || !permission) return;
    const response =
      optionId == null
        ? { outcome: { outcome: 'cancelled' as const } }
        : { outcome: { outcome: 'selected' as const, optionId } };
    await window.milu.acpResolvePermission(init.reqId, permission.permId, response);
    setPermission(null);
  }

  if (!init) {
    return (
      <div className="agent-view agent-view--errored">
        <div className="agent-error">
          Invalid agent tab — missing agentId/reqId.
          <button
            className="agent-btn"
            onClick={() => workspace.closeTab(tabId)}
          >
            Close tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-view">
      <div className="agent-toolbar">
        <span className={`agent-status agent-status--${status}`}>{status}</span>
        {status === 'prompting' && (
          <button className="agent-btn" onClick={() => void cancel()}>
            Cancel
          </button>
        )}
        {errorText && status === 'errored' && (
          <span className="agent-error-inline" title={errorText}>
            {errorText}
          </span>
        )}
      </div>

      {init && <ReviewPanel reqId={init.reqId} />}

      <div className="agent-transcript" ref={transcriptRef}>
        {transcript.map((item) => (
          <TranscriptRow key={item.id} item={item} />
        ))}
        {transcript.length === 0 && status === 'connecting' && (
          <div className="agent-placeholder">Connecting…</div>
        )}
        {transcript.length === 1 && status === 'ready' && (
          <div className="agent-placeholder">
            Type a message below to start.
          </div>
        )}
      </div>

      <div className="agent-input">
        <div className="agent-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="agent-textarea"
            value={draft}
            onChange={(e) => {
              bumpInput();
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              bumpInput();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            onKeyUp={recompute}
            onClick={recompute}
            placeholder={
              status === 'ready'
                ? 'Message the agent…   (⌘↩ to send)'
                : status === 'prompting'
                  ? 'Agent is working…'
                  : status === 'connecting'
                    ? 'Connecting…'
                    : 'Session not ready.'
            }
            disabled={status !== 'ready'}
            rows={3}
          />
          <div ref={caretMirrorRef} className="agent-textarea-mirror" aria-hidden />
          <div ref={caretRef} className="agent-caret" aria-hidden />
        </div>
        <button
          className="agent-btn agent-btn--primary"
          onClick={() => void send()}
          disabled={status !== 'ready' || !draft.trim()}
        >
          Send
        </button>
      </div>

      {permission && (
        <div className="agent-permission-overlay" onClick={() => void answerPermission(null)}>
          <div
            className="agent-permission-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="agent-permission-title">Allow this action?</div>
            <div className="agent-permission-tool">
              <strong>{permission.toolCall.title}</strong>
              {permission.toolCall.kind && (
                <span className="agent-permission-kind">{permission.toolCall.kind}</span>
              )}
            </div>
            {permission.toolCall.locations && permission.toolCall.locations.length > 0 && (
              <ul className="agent-permission-locations">
                {permission.toolCall.locations.map((l, i) => (
                  <li key={i}>
                    {l.path}
                    {l.line != null && `:${l.line}`}
                  </li>
                ))}
              </ul>
            )}
            <div className="agent-permission-options">
              {permission.options.map((o) => (
                <button
                  key={o.optionId}
                  className={`agent-btn agent-btn--${o.kind === 'allow_once' || o.kind === 'allow_always' ? 'primary' : 'secondary'}`}
                  onClick={() => void answerPermission(o.optionId)}
                >
                  {o.name}
                </button>
              ))}
              <button className="agent-btn" onClick={() => void answerPermission(null)}>
                Cancel turn
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TranscriptRow({ item }: { item: TranscriptItem }) {
  if (item.kind === 'user') {
    return (
      <div className="agent-msg agent-msg--user">
        <div className="agent-msg-role">You</div>
        <div className="agent-msg-text">{item.text}</div>
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return <AssistantRow text={item.text} />;
  }
  if (item.kind === 'tool') {
    return (
      <div className={`agent-tool agent-tool--${item.status}`}>
        <span className="agent-tool-status">{statusGlyph(item.status)}</span>
        <span className="agent-tool-title">{item.title}</span>
        {item.toolKind && <span className="agent-tool-kind">{item.toolKind}</span>}
        {item.locations && item.locations.length > 0 && (
          <span className="agent-tool-loc">
            {item.locations[0].path}
            {item.locations[0].line != null && `:${item.locations[0].line}`}
            {item.locations.length > 1 && ` +${item.locations.length - 1}`}
          </span>
        )}
      </div>
    );
  }
  if (item.kind === 'error') {
    return <div className="agent-msg agent-msg--error">{item.text}</div>;
  }
  return <div className="agent-msg agent-msg--system">{item.text}</div>;
}

function AssistantRow({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false }) as string),
    [text],
  );
  return (
    <div className="agent-msg agent-msg--assistant">
      <div className="agent-msg-role">Agent</div>
      <div className="agent-msg-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** When the agent writes to a file Milu has open in any tab, force
 *  that tab to re-read from disk. Milu's "overwrite" stance means
 *  any local unsaved edits are lost — that was the explicit decision.
 *  Editor-state tabs (terminal, web, settings) without a real
 *  filePath are skipped naturally because we filter on filePath. */
async function invalidateTabsForPath(absPath: string): Promise<void> {
  const tabs = workspace.getState().tabs.filter((t) => t.filePath === absPath);
  if (tabs.length === 0) return;
  for (const t of tabs) {
    // Only re-read kinds that hold disk-backed text content. Image
    // tabs don't keep text in `content`; they re-load on render.
    if (
      t.kind === 'markdown' ||
      t.kind === 'code' ||
      t.kind === 'json' ||
      t.kind === 'csv' ||
      t.kind === 'diff'
    ) {
      try {
        const content = await window.milu.readFile(absPath);
        workspace.rebaseSavedContent(t.id, content);
      } catch {
        // file might have been moved/deleted; leave the tab as-is
      }
    }
  }
}

/** Compact strip below the agent toolbar listing every pending file
 *  edit for this session — Cursor-style cross-file overview.
 *  Clicking a row opens that file in a tab; the EditorPane will
 *  swap into review mode automatically because the path is in the
 *  pendingReviews store. Only renders when there's at least one
 *  pending review. */
function ReviewPanel({ reqId }: { reqId: string }) {
  const reviews = useAcpReviewsForReqId(reqId);
  if (reviews.length === 0) return null;
  return (
    <div className="agent-reviews">
      <div className="agent-reviews-label">
        Pending edits ({reviews.length})
      </div>
      <div className="agent-reviews-list">
        {reviews.map((r) => {
          const accepted = r.hunks.filter((h) => h.decision === 'accepted').length;
          const rejected = r.hunks.filter((h) => h.decision === 'rejected').length;
          const pending = r.hunks.length - accepted - rejected;
          const file = r.path.split('/').pop() ?? r.path;
          return (
            <button
              key={r.id}
              className="agent-reviews-row"
              onClick={() => void openFileFromPath(r.path, { focus: true })}
              title={r.path}
            >
              <span className="agent-reviews-file">{file}</span>
              <span className="agent-reviews-counts">
                {accepted > 0 && <span className="agent-reviews-count agent-reviews-count--accept">✓{accepted}</span>}
                {rejected > 0 && <span className="agent-reviews-count agent-reviews-count--reject">✗{rejected}</span>}
                {pending > 0 && <span className="agent-reviews-count agent-reviews-count--pending">·{pending}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function statusGlyph(s: string): string {
  switch (s) {
    case 'pending': return '·';
    case 'in_progress': return '⊙';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'cancelled': return '×';
    default: return '·';
  }
}
