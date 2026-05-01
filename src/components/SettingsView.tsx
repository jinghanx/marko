import { useEffect, useState } from 'react';
import { settings, useSettings, type ThemeMode, SEARCH_ENGINES, type SearchEngineId } from '../state/settings';
import { EDITOR_THEMES, type EditorTheme } from '../lib/editorTheme';
import { LIGHT_THEMES, DARK_THEMES } from '../lib/themes';

const FONT_PRESETS = {
  content: [
    { label: 'New York (default)', value: `'New York', 'Iowan Old Style', 'PT Serif', Georgia, serif` },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Iowan Old Style', value: `'Iowan Old Style', Georgia, serif` },
    { label: 'Charter', value: `'Charter', 'Iowan Old Style', Georgia, serif` },
    { label: 'System sans', value: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif` },
    { label: 'Helvetica Neue', value: `'Helvetica Neue', Helvetica, Arial, sans-serif` },
  ],
  ui: [
    { label: 'System (default)', value: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif` },
    { label: 'Helvetica Neue', value: `'Helvetica Neue', Helvetica, Arial, sans-serif` },
    { label: 'Inter', value: `'Inter', -apple-system, sans-serif` },
  ],
  code: [
    { label: 'SF Mono (default)', value: `'SF Mono', Menlo, Monaco, Consolas, monospace` },
    { label: 'Menlo', value: 'Menlo, Monaco, Consolas, monospace' },
    { label: 'JetBrains Mono', value: `'JetBrains Mono', 'SF Mono', Menlo, monospace` },
    { label: 'Fira Code', value: `'Fira Code', 'SF Mono', Menlo, monospace` },
    { label: 'IBM Plex Mono', value: `'IBM Plex Mono', 'SF Mono', Menlo, monospace` },
  ],
};

export function SettingsView() {
  const s = useSettings();

  return (
    <div className="settings-view">
      <div className="settings-view-header">
        <h2>Settings</h2>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (window.confirm('Reset all preferences to defaults?')) settings.reset();
          }}
        >
          Reset to defaults
        </button>
      </div>

      <div className="settings-view-body">
          <Section label="Appearance">
            <Row label="Theme">
              <ThemeSelector value={s.theme} onChange={(theme) => settings.update({ theme })} />
            </Row>
            <Row label="Light scheme">
              <ColorThemeSelect
                themes={LIGHT_THEMES}
                value={s.lightThemeId}
                onChange={(id) => settings.update({ lightThemeId: id })}
              />
            </Row>
            <Row label="Dark scheme">
              <ColorThemeSelect
                themes={DARK_THEMES}
                value={s.darkThemeId}
                onChange={(id) => settings.update({ darkThemeId: id })}
              />
            </Row>
            <Row label="Editor theme">
              <EditorThemeSelector
                value={s.editorTheme}
                onChange={(editorTheme) => settings.update({ editorTheme })}
              />
            </Row>
          </Section>

          <Section label="Typography">
            <Row label="Editor font">
              <FontSelect
                presets={FONT_PRESETS.content}
                value={s.contentFont}
                onChange={(contentFont) => settings.update({ contentFont })}
              />
            </Row>
            <Row label="UI font">
              <FontSelect
                presets={FONT_PRESETS.ui}
                value={s.uiFont}
                onChange={(uiFont) => settings.update({ uiFont })}
              />
            </Row>
            <Row label="Code font">
              <FontSelect
                presets={FONT_PRESETS.code}
                value={s.codeFont}
                onChange={(codeFont) => settings.update({ codeFont })}
              />
            </Row>
            <Row label="Font size">
              <div className="slider-row">
                <input
                  type="range"
                  min={12}
                  max={24}
                  step={1}
                  value={s.fontSize}
                  onChange={(e) => settings.update({ fontSize: Number(e.target.value) })}
                />
                <span className="slider-value">{s.fontSize}px</span>
              </div>
            </Row>
          </Section>

          <Section label="Layout">
            <Row label="Max content width">
              <div className="slider-row">
                <input
                  type="range"
                  min={0}
                  max={1400}
                  step={20}
                  value={s.maxContentWidth}
                  onChange={(e) => settings.update({ maxContentWidth: Number(e.target.value) })}
                />
                <span className="slider-value">
                  {s.maxContentWidth === 0 ? 'No limit' : `${s.maxContentWidth}px`}
                </span>
              </div>
            </Row>
          </Section>

          <Section label="Editor">
            <Row label="Vim mode">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={s.vimMode}
                  onChange={(e) => settings.update({ vimMode: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-hint">Applies to code & text files (not markdown).</span>
              </label>
            </Row>
          </Section>

          <Section label="Files">
            <Row label="Show hidden files">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={s.showHiddenFiles}
                  onChange={(e) => settings.update({ showHiddenFiles: e.target.checked })}
                />
                <span className="toggle-track" />
                <span className="toggle-hint">Reveal dotfiles (.git, .env, .DS_Store, …) in the tree and folder views.</span>
              </label>
            </Row>
          </Section>

          <Section label="Search">
            <Row label="Web search engine">
              <div className="font-select">
                <select
                  value={s.searchEngine}
                  onChange={(e) => settings.update({ searchEngine: e.target.value as SearchEngineId })}
                >
                  {SEARCH_ENGINES.map((eng) => (
                    <option key={eng.id} value={eng.id}>
                      {eng.name}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
              </div>
            </Row>
            {s.searchEngine === 'custom' && (
              <Row label="Custom URL">
                <div className="font-select">
                  <input
                    type="text"
                    className="font-custom"
                    value={s.customSearchUrl}
                    spellCheck={false}
                    placeholder="https://example.com/search?q={q}"
                    onChange={(e) => settings.update({ customSearchUrl: e.target.value })}
                  />
                  <span className="settings-hint">
                    Use <code>{'{q}'}</code> where the query goes; the value is URL-encoded.
                  </span>
                </div>
              </Row>
            )}
          </Section>

          <AiProvidersSection />
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-label">{label}</div>
      <div className="settings-section-rows">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">{label}</div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function ColorThemeSelect({
  themes,
  value,
  onChange,
}: {
  themes: { id: string; name: string; bg: string; accent: string; text: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="theme-grid">
      {themes.map((t) => (
        <button
          key={t.id}
          className={`theme-swatch ${value === t.id ? 'theme-swatch--active' : ''}`}
          onClick={() => onChange(t.id)}
          title={t.name}
        >
          <span
            className="theme-swatch-preview"
            style={{
              background: t.bg,
              borderColor: value === t.id ? t.accent : 'var(--border)',
            }}
          >
            <span className="theme-swatch-dot" style={{ background: t.accent }} />
            <span className="theme-swatch-text" style={{ color: t.text }}>Aa</span>
          </span>
          <span className="theme-swatch-name">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

function ThemeSelector({ value, onChange }: { value: ThemeMode; onChange: (v: ThemeMode) => void }) {
  return (
    <div className="seg-control">
      {(['system', 'light', 'dark'] as ThemeMode[]).map((opt) => (
        <button
          key={opt}
          className={`seg-control-item ${value === opt ? 'seg-control-item--active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt[0].toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  );
}

function EditorThemeSelector({
  value,
  onChange,
}: {
  value: EditorTheme;
  onChange: (v: EditorTheme) => void;
}) {
  const current = EDITOR_THEMES.find((t) => t.value === value) ?? EDITOR_THEMES[0];
  return (
    <div className="font-select">
      <select value={value} onChange={(e) => onChange(e.target.value as EditorTheme)}>
        {EDITOR_THEMES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <span className="settings-hint">{current.description}</span>
    </div>
  );
}

function FontSelect({
  presets,
  value,
  onChange,
}: {
  presets: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const matchIdx = presets.findIndex((p) => p.value === value);
  const isCustom = matchIdx < 0;

  return (
    <div className="font-select">
      <select
        value={isCustom ? '__custom__' : String(matchIdx)}
        onChange={(e) => {
          if (e.target.value === '__custom__') return;
          onChange(presets[Number(e.target.value)].value);
        }}
      >
        {presets.map((p, i) => (
          <option key={i} value={i}>
            {p.label}
          </option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
      {isCustom && (
        <input
          type="text"
          className="font-custom"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="font-family CSS value"
        />
      )}
    </div>
  );
}

function AiProvidersSection() {
  const [providers, setProviders] = useState<import('../types/marko').AiProvider[]>([]);
  const [haveKey, setHaveKey] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    baseURL: '',
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
  });

  const load = async () => {
    const list = await window.marko.aiProviders();
    setProviders(list);
    const flags: Record<string, boolean> = {};
    for (const p of list) {
      if (p.needsKey) flags[p.id] = await window.marko.aiHasKey(p.id);
    }
    setHaveKey(flags);
  };

  useEffect(() => {
    void load();
  }, []);

  const saveKey = async (id: string) => {
    if (!keyInput.trim()) return;
    const r = await window.marko.aiSetKey(id, keyInput.trim());
    if (r.ok) {
      setEditing(null);
      setKeyInput('');
      await load();
    } else {
      window.alert(r.error ?? 'Failed to save key');
    }
  };

  const removeKey = async (id: string) => {
    if (!window.confirm('Remove API key?')) return;
    await window.marko.aiDeleteKey(id);
    await load();
  };

  const removeProvider = async (id: string) => {
    if (!window.confirm('Remove this provider?')) return;
    await window.marko.aiProviderDelete(id);
    await load();
  };

  const saveDraft = async () => {
    if (!draft.name.trim() || !draft.baseURL.trim()) return;
    const id = `custom-${Date.now()}`;
    await window.marko.aiProviderSave({
      id,
      name: draft.name.trim(),
      baseURL: draft.baseURL.trim(),
      defaultModel: draft.defaultModel.trim(),
      needsKey: draft.needsKey,
      isLocal: !draft.needsKey,
    });
    setAdding(false);
    setDraft({ name: '', baseURL: '', defaultModel: 'gpt-4o-mini', needsKey: true });
    await load();
  };
  const cancelDraft = () => {
    setAdding(false);
    setDraft({ name: '', baseURL: '', defaultModel: 'gpt-4o-mini', needsKey: true });
  };

  return (
    <Section label="AI">
      <div className="ai-providers">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`ai-provider-row${editing === p.id ? ' ai-provider-row--editing' : ''}`}
          >
            <div className="ai-provider-top">
              <div className="ai-provider-info">
                <div className="ai-provider-name">
                  {p.name}
                  {p.isLocal && <span className="ai-provider-tag">local</span>}
                  {p.needsKey && (
                    <span className={`ai-provider-tag ${haveKey[p.id] ? 'ai-provider-tag--ok' : 'ai-provider-tag--warn'}`}>
                      {haveKey[p.id] ? 'key set' : 'no key'}
                    </span>
                  )}
                </div>
                <div className="ai-provider-url">
                  {p.baseURL} · default: <code>{p.defaultModel}</code>
                </div>
              </div>
              <div className="ai-provider-actions">
                {p.needsKey && editing !== p.id && (
                  <>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setEditing(p.id);
                        setKeyInput('');
                      }}
                    >
                      {haveKey[p.id] ? 'Replace key' : 'Set key'}
                    </button>
                    {haveKey[p.id] && (
                      <button className="btn btn-ghost" onClick={() => void removeKey(p.id)}>
                        Remove key
                      </button>
                    )}
                  </>
                )}
                {p.id.startsWith('custom-') && (
                  <button className="btn btn-ghost" onClick={() => void removeProvider(p.id)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
            {editing === p.id && (
              <div className="ai-key-edit">
                <input
                  type="password"
                  className="ai-key-input"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveKey(p.id);
                    if (e.key === 'Escape') {
                      setEditing(null);
                      setKeyInput('');
                    }
                  }}
                  placeholder="paste API key"
                  autoFocus
                />
                <button
                  className="btn btn-primary"
                  onClick={() => void saveKey(p.id)}
                  disabled={!keyInput.trim()}
                >
                  Save
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditing(null);
                    setKeyInput('');
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
        {adding ? (
          <div className="ai-provider-row ai-provider-form">
            <div className="ai-form-grid">
              <label className="ai-form-row">
                <span>Name</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="My Custom Provider"
                  autoFocus
                />
              </label>
              <label className="ai-form-row">
                <span>Base URL</span>
                <input
                  value={draft.baseURL}
                  onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
                  placeholder="http://localhost:8080/v1"
                />
              </label>
              <label className="ai-form-row">
                <span>Default model</span>
                <input
                  value={draft.defaultModel}
                  onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
                  placeholder="gpt-4o-mini"
                />
              </label>
              <label className="ai-form-row ai-form-row--check">
                <input
                  type="checkbox"
                  checked={draft.needsKey}
                  onChange={(e) => setDraft({ ...draft, needsKey: e.target.checked })}
                />
                <span>Requires API key</span>
              </label>
              <div className="ai-form-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => void saveDraft()}
                  disabled={!draft.name.trim() || !draft.baseURL.trim()}
                >
                  Add
                </button>
                <button className="btn btn-ghost" onClick={cancelDraft}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost ai-add-btn" onClick={() => setAdding(true)}>
            + Add provider
          </button>
        )}
      </div>
    </Section>
  );
}
