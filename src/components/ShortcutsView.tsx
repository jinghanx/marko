import { useMemo, useState } from 'react';
import { SHORTCUT_SECTIONS } from '../lib/shortcuts';

export function ShortcutsView() {
  const [query, setQuery] = useState('');

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

  return (
    <div className="shortcuts-view">
      <div className="shortcuts-view-header">
        <h2>Keyboard Shortcuts</h2>
        <input
          type="text"
          value={query}
          placeholder="Filter shortcuts…"
          spellCheck={false}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="shortcuts-view-body">
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
  );
}
