import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { AiProvider, AiChatMessage } from '../types/marko';
import { workspace, useWorkspace, getActiveSession, getAllLeaves } from '../state/workspace';
import type { ChatHistoryEntry } from '../types/marko';

interface Props {
  tabId: string;
  initialValue: string;
}

interface ChatState {
  /** Stable id used for the on-disk archive (~/.marko/chats/<id>.json).
   *  Assigned when the user sends the first message. */
  chatId?: string;
  providerId: string;
  model: string;
  messages: AiChatMessage[];
  systemPrompt?: string;
  showSystem?: boolean;
}

interface Attachment {
  id: string;
  /** Display label (basename or short hint). */
  label: string;
  /** Absolute path / source descriptor — shown as chip tooltip. */
  source: string;
  /** Actual content injected into the next user message. */
  content: string;
}

function parseChatState(text: string): ChatState | null {
  if (!text || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as ChatState;
    if (!parsed.messages || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function serializeChat(s: ChatState): string {
  return JSON.stringify(s);
}

const DEFAULT_SYSTEM = 'You are a helpful coding assistant inside Marko, a desktop editor.';

/** Render assistant markdown to safe HTML. We wrap each fenced code block in
 *  a div with a copy button (the click handler is attached via delegation
 *  on the messages container so it survives re-renders cheaply). */
const codeRenderer = new marked.Renderer();
codeRenderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const langLabel = lang ? `<span class="chat-code-lang">${lang}</span>` : '';
  return `<div class="chat-code-block">${langLabel}<button class="chat-code-copy" data-action="copy-code" type="button">Copy</button><pre><code>${escaped}</code></pre></div>`;
};

function renderMarkdown(text: string): string {
  if (!text) return '';
  const html = marked.parse(text, { renderer: codeRenderer, async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-action'],
  });
}

/** Streaming AI chat tab. The conversation lives in `tab.content` as JSON, so
 *  it round-trips through Marko's persistence. Streaming runs in the main
 *  process — we just subscribe to chunk events here. */
export function ChatView({ tabId, initialValue }: Props) {
  // Subscribe to live tab.content so cross-pane sync works (same chat tab open
  // in two panes shows the same conversation).
  const tabContent = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.content ?? '');

  const initial = useMemo(() => parseChatState(initialValue), [initialValue]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [providerId, setProviderId] = useState(initial?.providerId ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [messages, setMessages] = useState<AiChatMessage[]>(initial?.messages ?? []);
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? DEFAULT_SYSTEM);
  const [showSystem, setShowSystem] = useState(false);
  const chatIdRef = useRef<string | undefined>(initial?.chatId);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Picker shown when the user has multiple open file tabs. */
  const [openTabPicker, setOpenTabPicker] = useState<Array<{ id: string; label: string; path: string }> | null>(null);
  // History sidebar — list of archived chats from ~/.marko/chats/.
  const [showHistory, setShowHistory] = useState(true);
  const [history, setHistory] = useState<ChatHistoryEntry[]>([]);
  const [historyFilter, setHistoryFilter] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);
  const reqIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const skipNextSyncRef = useRef(false);

  // Load providers once.
  useEffect(() => {
    void window.marko.aiProviders().then((list) => {
      setProviders(list);
      if (!providerId && list.length > 0) {
        setProviderId(list[0].id);
        if (!model) setModel(list[0].defaultModel);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check whether the current cloud provider has a key. Surfaces "Add key in
  // Settings" hint instead of a cryptic error.
  useEffect(() => {
    const p = providers.find((x) => x.id === providerId);
    if (!p) return;
    if (!p.needsKey) {
      setKeyMissing(false);
      return;
    }
    void window.marko.aiHasKey(providerId).then((has) => setKeyMissing(!has));
  }, [providerId, providers]);

  // Persist the conversation back to tab.content whenever it changes locally.
  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    if (!providerId) return;
    const next = serializeChat({
      chatId: chatIdRef.current,
      providerId,
      model,
      messages,
      systemPrompt,
    });
    if (next === tabContent) return;
    workspace.updateContent(tabId, next);
    // We just wrote — don't loop on the next tabContent read.
    skipNextSyncRef.current = true;

    // Mirror to the persistent archive once we have at least one message.
    if (chatIdRef.current && messages.length > 0) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const preview = (lastUser?.content ?? '').replace(/\s+/g, ' ').slice(0, 120);
      const tabRecord = workspace.getState().tabs.find((t) => t.id === tabId);
      const title = tabRecord?.title ?? 'Chat';
      void window.marko.chatHistorySave(chatIdRef.current, {
        id: chatIdRef.current,
        title,
        providerId,
        model,
        systemPrompt,
        messages,
        preview,
        updatedAt: Date.now(),
      });
    }
  }, [tabId, providerId, model, messages, systemPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull external changes (cross-pane edits, hydrate) into local state.
  useEffect(() => {
    const parsed = parseChatState(tabContent);
    if (!parsed) return;
    if (JSON.stringify(parsed.messages) === JSON.stringify(messages)) return;
    setMessages(parsed.messages);
    if (parsed.providerId && parsed.providerId !== providerId) setProviderId(parsed.providerId);
    if (parsed.model && parsed.model !== model) setModel(parsed.model);
  }, [tabContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom when messages append or stream.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Copy-code event delegation. Buttons are rendered into the assistant
  // markdown via a custom marked renderer; click flips the label briefly.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        'button[data-action="copy-code"]',
      );
      if (!target) return;
      const block = target.closest('.chat-code-block');
      const code = block?.querySelector('code');
      if (!code) return;
      void navigator.clipboard.writeText(code.textContent ?? '');
      const orig = target.textContent ?? 'Copy';
      target.textContent = 'Copied!';
      target.classList.add('chat-code-copy--ok');
      setTimeout(() => {
        target.textContent = orig;
        target.classList.remove('chat-code-copy--ok');
      }, 1200);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);

  /** File-content attachments. Wraps each one in fenced code with the
   *  source path so the model can cite it; appended above the user's text. */
  const buildContextPrefix = (): string => {
    if (attachments.length === 0) return '';
    return (
      attachments
        .map((a) => `**${a.source}**:\n\`\`\`\n${a.content}\n\`\`\``)
        .join('\n\n') + '\n\n---\n\n'
    );
  };

  const attachOpenFile = async () => {
    const result = await window.marko.openFileDialog();
    if (!result) return;
    const name = result.filePath.split('/').pop() ?? 'file';
    addAttachment({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: name,
      source: result.filePath,
      content: result.content,
    });
  };

  /** Iterate the active session's open tabs (excluding chat/binary/folder/etc)
   *  and let the user pick one. Reads content via existing IPC if it's not
   *  already loaded into the tab. */
  const attachOpenTab = async () => {
    const s = workspace.getState();
    const session = getActiveSession(s);
    const allLeafTabIds = new Set<string>();
    for (const leaf of getAllLeaves(session.root)) {
      for (const id of leaf.tabIds) allLeafTabIds.add(id);
    }
    const openFileTabs = s.tabs.filter(
      (t) =>
        allLeafTabIds.has(t.id) &&
        t.filePath &&
        (t.kind === 'code' ||
          t.kind === 'markdown' ||
          t.kind === 'json' ||
          t.kind === 'csv'),
    );
    if (openFileTabs.length === 0) {
      setError('No open file tabs to attach. Open a file first, or use "Attach file…".');
      return;
    }
    // Inline picker: prompt the user. With multiple tabs, show a select.
    if (openFileTabs.length === 1) {
      const t = openFileTabs[0];
      addAttachment({
        id: `att-${Date.now()}`,
        label: t.title,
        source: t.filePath!,
        content: t.content,
      });
      return;
    }
    setOpenTabPicker(openFileTabs.map((t) => ({ id: t.id, label: t.title, path: t.filePath! })));
  };

  const addAttachment = (a: Attachment) => {
    setAttachments((cur) => [...cur, a]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    if (!providerId) {
      setError('Pick a provider first');
      return;
    }
    setError(null);
    if (!chatIdRef.current) {
      // Stable id for the on-disk archive — assigned on first send.
      chatIdRef.current = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const prefix = buildContextPrefix();
    const composed = prefix ? prefix + text : text;
    const next: AiChatMessage[] = [...messages, { role: 'user', content: composed }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setAttachments([]);
    setStreaming(true);
    // Derive a tab title from the first user message — keeps the tab strip
    // navigable when many chats are open.
    if (messages.length === 0) {
      const title = text.replace(/\s+/g, ' ').trim().slice(0, 48);
      if (title) {
        workspace.setState((prev) => ({
          tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
        }));
      }
    }
    // Keep the cursor in the input so the user can type the next message
    // while the assistant streams. requestAnimationFrame waits for React's
    // re-render after setState above.
    requestAnimationFrame(() => inputRef.current?.focus());

    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    reqIdRef.current = reqId;
    let assistantContent = '';

    const offChunk = window.marko.onAiChatChunk(reqId, (chunk) => {
      assistantContent += chunk;
      setMessages((cur) => {
        const copy = [...cur];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant') {
          copy[copy.length - 1] = { ...last, content: assistantContent };
        }
        return copy;
      });
    });
    const offDone = window.marko.onAiChatDone(reqId, (result) => {
      offChunk();
      offDone();
      setStreaming(false);
      reqIdRef.current = null;
      if (!result.ok) {
        setError(result.error ?? 'Request failed');
        // Drop the empty assistant placeholder if no content arrived.
        setMessages((cur) =>
          cur.length > 0 && cur[cur.length - 1].role === 'assistant' && !cur[cur.length - 1].content
            ? cur.slice(0, -1)
            : cur,
        );
      }
    });

    const startResult = await window.marko.aiChatStart(reqId, {
      providerId,
      model,
      messages: next,
      systemPrompt: systemPrompt || DEFAULT_SYSTEM,
    });
    if (!startResult.ok) {
      offChunk();
      offDone();
      setStreaming(false);
      reqIdRef.current = null;
      setError(startResult.error ?? 'Could not start request');
      setMessages((cur) =>
        cur.length > 0 && cur[cur.length - 1].role === 'assistant' && !cur[cur.length - 1].content
          ? cur.slice(0, -1)
          : cur,
      );
    }
  };

  const cancel = () => {
    const reqId = reqIdRef.current;
    if (!reqId) return;
    void window.marko.aiChatCancel(reqId);
  };

  const reset = () => {
    if (streaming) cancel();
    setMessages([]);
    setError(null);
  };

  // Reload sidebar list whenever it's open and the message count changes (so
  // the current chat moves to the top after a turn).
  const loadHistory = async () => {
    const list = await window.marko.chatHistoryList();
    setHistory(list);
  };
  useEffect(() => {
    if (!showHistory) return;
    void loadHistory();
  }, [showHistory]);
  useEffect(() => {
    if (!showHistory || messages.length === 0) return;
    const t = setTimeout(loadHistory, 250);
    return () => clearTimeout(t);
  }, [messages, showHistory]);

  /** Reset the in-tab state for a fresh conversation. We deliberately don't
   *  open a new tab — same window, new chat, same as ChatGPT's "+ New chat". */
  const newChat = () => {
    if (streaming) cancel();
    chatIdRef.current = undefined;
    setMessages([]);
    setInput('');
    setAttachments([]);
    setError(null);
    workspace.setState((prev) => ({
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, title: 'Chat' } : t)),
    }));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** Load an archived chat into the current tab — replaces the visible
   *  conversation but keeps the tab. Future messages keep saving back to
   *  the same archive entry (chatId is restored). */
  const loadArchivedChat = async (entry: ChatHistoryEntry) => {
    if (streaming) cancel();
    const raw = await window.marko.chatHistoryLoad(entry.id);
    if (!raw) return;
    try {
      const obj = JSON.parse(raw);
      chatIdRef.current = obj.id;
      setMessages(obj.messages ?? []);
      setSystemPrompt(obj.systemPrompt ?? DEFAULT_SYSTEM);
      if (obj.providerId) setProviderId(obj.providerId);
      if (obj.model) setModel(obj.model);
      setAttachments([]);
      setInput('');
      setError(null);
      workspace.setState((prev) => ({
        tabs: prev.tabs.map((t) =>
          t.id === tabId ? { ...t, title: obj.title ?? entry.title } : t,
        ),
      }));
    } catch {
      // ignore corrupt entry
    }
  };

  const deleteArchivedChat = async (entry: ChatHistoryEntry) => {
    const ok = await window.marko.confirm({
      message: `Delete chat "${entry.title}"?`,
      detail: 'This removes the archived conversation from disk.',
      confirmLabel: 'Delete',
      dangerous: true,
    });
    if (!ok) return;
    await window.marko.chatHistoryDelete(entry.id);
    if (chatIdRef.current === entry.id) {
      // We deleted the chat we were just viewing — clear it.
      newChat();
    }
    await loadHistory();
  };

  const filteredHistory = historyFilter.trim()
    ? history.filter((e) => {
        const q = historyFilter.toLowerCase();
        return (
          e.title.toLowerCase().includes(q) || e.preview.toLowerCase().includes(q)
        );
      })
    : history;

  // Rough token estimate: ~4 chars/token is the standard ballpark for
  // English. Includes message history + system + pending attachments + draft
  // input so the user can see what each "Send" will cost.
  const tokenEstimate = useMemo(() => {
    let chars = systemPrompt.length;
    for (const m of messages) chars += m.content.length;
    for (const a of attachments) chars += a.content.length + a.source.length + 20;
    chars += input.length;
    return Math.round(chars / 4);
  }, [messages, attachments, systemPrompt, input]);

  /** Save the conversation as a `.md` file via the existing save dialog,
   *  rendering each message as `### user` / `### assistant` blocks. */
  const exportAsMarkdown = async () => {
    if (messages.length === 0) return;
    const lines: string[] = [];
    if (systemPrompt && systemPrompt !== DEFAULT_SYSTEM) {
      lines.push('## System', '', systemPrompt, '');
    }
    for (const m of messages) {
      lines.push(`## ${m.role === 'user' ? 'You' : 'Assistant'}`, '');
      lines.push(m.content, '');
    }
    const content = lines.join('\n');
    const filePath = await window.marko.saveAsDialog('chat.md');
    if (!filePath) return;
    await window.marko.writeFile(filePath, content);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  /** Accept files dropped from Finder (native) or from the in-app folder
   *  view (`application/x-marko-files` MIME). Each file becomes an
   *  attachment chip. */
  const onDragOver = (e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes('Files') ||
      e.dataTransfer.types.includes('application/x-marko-files')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const paths: string[] = [];
    // In-app: paths come as a JSON array under our custom MIME.
    const markoData = e.dataTransfer.getData('application/x-marko-files');
    if (markoData) {
      try {
        const arr = JSON.parse(markoData) as string[];
        if (Array.isArray(arr)) paths.push(...arr);
      } catch {
        // ignore
      }
    }
    // Native: Finder etc. drops attach the absolute path on the File object.
    for (const f of Array.from(e.dataTransfer.files ?? [])) {
      const p = (f as File & { path?: string }).path;
      if (p) paths.push(p);
    }
    for (const p of paths) {
      try {
        const content = await window.marko.readFile(p);
        const name = p.split('/').pop() ?? p;
        addAttachment({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: name,
          source: p,
          content,
        });
      } catch {
        // skip files that fail to read (binary, missing, etc.)
      }
    }
  };

  return (
    <div className="chat-view" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="chat-toolbar">
        <select
          className="chat-provider"
          value={providerId}
          onChange={(e) => {
            const id = e.target.value;
            setProviderId(id);
            const p = providers.find((x) => x.id === id);
            if (p) setModel(p.defaultModel);
          }}
          disabled={streaming}
        >
          {providers.length === 0 && <option value="">No providers configured</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          className="chat-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model"
          disabled={streaming}
        />
        <span className="chat-spacer" />
        <span className="chat-tokens" title="Rough token estimate (chars/4)">
          ~{formatTokens(tokenEstimate)}t
        </span>
        <button
          className={`chat-btn${showSystem ? ' chat-btn--active' : ''}`}
          onClick={() => setShowSystem((v) => !v)}
          title="Edit system prompt"
        >
          System
        </button>
        <button
          className={`chat-btn${showHistory ? ' chat-btn--active' : ''}`}
          onClick={() => setShowHistory((v) => !v)}
          title="Browse past chats"
        >
          History
        </button>
        <button
          className="chat-btn"
          onClick={() => void exportAsMarkdown()}
          disabled={messages.length === 0}
          title="Export conversation as markdown"
        >
          Export
        </button>
        <button className="chat-btn" onClick={newChat} disabled={streaming}>
          New chat
        </button>
      </div>

      {showSystem && (
        <div className="chat-system">
          <textarea
            className="chat-system-input"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={DEFAULT_SYSTEM}
            rows={3}
            spellCheck={false}
          />
          <div className="chat-system-hint">
            System prompt sets the assistant's behavior. Saved per chat.
            <button
              className="chat-system-reset"
              onClick={() => setSystemPrompt(DEFAULT_SYSTEM)}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}

      {keyMissing && (
        <div className="chat-banner">
          No API key set for this provider. Add one in Settings → AI.
        </div>
      )}

      <div className="chat-body">
        {showHistory && (
          <aside className="chat-history-sidebar">
            <button className="chat-history-new" onClick={newChat}>
              + New chat
            </button>
            <input
              className="chat-history-filter"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              placeholder="Filter…"
              spellCheck={false}
            />
            <div className="chat-history-list">
              {history.length === 0 ? (
                <div className="chat-history-side-empty">
                  No saved chats yet.
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="chat-history-side-empty">No matches.</div>
              ) : (
                filteredHistory.map((e) => {
                  const active = chatIdRef.current === e.id;
                  return (
                    <div
                      key={e.id}
                      className={`chat-history-side-row${active ? ' chat-history-side-row--active' : ''}`}
                      onClick={() => void loadArchivedChat(e)}
                    >
                      <div className="chat-history-side-title" title={e.title}>
                        {e.title}
                      </div>
                      <div className="chat-history-side-meta">
                        <span>{formatRelative(e.updatedAt)}</span>
                        <span>·</span>
                        <span>{e.messageCount} msgs</span>
                      </div>
                      <button
                        className="chat-history-side-del"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void deleteArchivedChat(e);
                        }}
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        <div className="chat-main">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <div className="chat-empty">
            <div className="chat-empty-title">Start a conversation</div>
            <div className="chat-empty-sub">
              {providers.length === 0
                ? 'Add a provider in Settings → AI.'
                : 'Type below and press Enter.'}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={i} role={m.role} content={m.content} />
        ))}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-attach-bar">
        {attachments.map((a) => (
          <span key={a.id} className="chat-chip" title={a.source}>
            <span className="chat-chip-icon">📎</span>
            <span className="chat-chip-label">{a.label}</span>
            <button
              className="chat-chip-remove"
              onClick={() => removeAttachment(a.id)}
              aria-label="Remove attachment"
            >
              ×
            </button>
          </span>
        ))}
        <button
          className="chat-attach-btn"
          onClick={() => void attachOpenTab()}
          title="Attach an open file tab"
        >
          + Open tab
        </button>
        <button
          className="chat-attach-btn"
          onClick={() => void attachOpenFile()}
          title="Attach a file from disk"
        >
          + File…
        </button>
      </div>

      {openTabPicker && (
        <div className="chat-tab-picker">
          <div className="chat-tab-picker-title">Pick a tab to attach:</div>
          {openTabPicker.map((t) => (
            <button
              key={t.id}
              className="chat-tab-picker-item"
              onClick={() => {
                const tab = workspace.getState().tabs.find((x) => x.id === t.id);
                if (tab) {
                  addAttachment({
                    id: `att-${Date.now()}`,
                    label: tab.title,
                    source: tab.filePath ?? tab.title,
                    content: tab.content,
                  });
                }
                setOpenTabPicker(null);
              }}
            >
              <span className="chat-tab-picker-name">{t.label}</span>
              <span className="chat-tab-picker-path">{t.path}</span>
            </button>
          ))}
          <button
            className="chat-tab-picker-cancel"
            onClick={() => setOpenTabPicker(null)}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={streaming ? 'Streaming… (you can type the next message)' : 'Ask anything (Enter to send, Shift+Enter newline)'}
          rows={2}
        />
        {streaming ? (
          <button className="chat-send chat-send--stop" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button
            className="chat-send"
            onClick={() => void send()}
            disabled={!input.trim() || !providerId}
          >
            Send
          </button>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}

function formatRelative(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `${days}d`;
  return new Date(ms).toLocaleDateString();
}

function Message({ role, content }: { role: AiChatMessage['role']; content: string }) {
  if (role === 'system') return null;
  return (
    <div className={`chat-msg chat-msg--${role}`}>
      <div className="chat-msg-role">{role === 'user' ? 'you' : 'assistant'}</div>
      {role === 'assistant' ? (
        <AssistantBody content={content} />
      ) : (
        <div className="chat-msg-body">{content || <span className="chat-msg-cursor">▍</span>}</div>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function AssistantBody({ content }: { content: string }) {
  // Memoize the marked+sanitize pass so we don't redo it for every keystroke
  // in the input box (only when the actual assistant content changes).
  const html = useMemo(() => renderMarkdown(content), [content]);
  if (!content) {
    return (
      <div className="chat-msg-body">
        <span className="chat-msg-cursor">▍</span>
      </div>
    );
  }
  return (
    <div
      className="chat-msg-body chat-msg-body--md"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
