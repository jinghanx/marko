import { useEffect } from 'react';
import { settings, useSettings, type ThemeMode } from '../state/settings';
import { EDITOR_THEMES, type EditorTheme } from '../lib/editorTheme';

interface Props {
  open: boolean;
  onClose: () => void;
}

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

export function SettingsModal({ open, onClose }: Props) {
  const s = useSettings();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Preferences</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <Section label="Appearance">
            <Row label="Theme">
              <ThemeSelector value={s.theme} onChange={(theme) => settings.update({ theme })} />
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
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (window.confirm('Reset all preferences to defaults?')) settings.reset();
            }}
          >
            Reset to defaults
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
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
