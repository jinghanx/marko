import { useEffect, useMemo, useState } from 'react';
import { SHORTCUT_SECTIONS } from '../lib/shortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: Props) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_SECTIONS;
    return SHORTCUT_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (it) => it.label.toLowerCase().includes(q) || it.keys.toLowerCase().includes(q),
      ),
    })).filter((s) => s.items.length > 0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="shortcuts-search">
          <input
            type="text"
            value={query}
            placeholder="Filter…"
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="modal-body shortcuts-body">
          {filtered.length === 0 ? (
            <div className="shortcuts-empty">No matches.</div>
          ) : (
            <div className="shortcuts-grid">
              {filtered.map((section) => (
                <div key={section.title} className="shortcuts-section">
                  <div className="shortcuts-section-title">{section.title}</div>
                  {section.items.map((item) => (
                    <div key={item.keys + item.label} className="shortcuts-row">
                      <span className="shortcuts-keys">{item.keys}</span>
                      <span className="shortcuts-label">{item.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
