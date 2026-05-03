import { useEffect, useRef, useState } from 'react';
import { useWorkspace, workspace, type Session } from '../state/workspace';
import { useDragReorder } from '../lib/dragReorder';

export function SessionStrip() {
  const sessions = useWorkspace((s) => s.sessions);
  const activeId = useWorkspace((s) => s.activeSessionId);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Always render the strip — even with one workspace, the user needs
  // to see it to add a second one (and to know workspaces exist as a
  // concept). Empty-strip case has the "+" button still visible.
  return (
    <Strip
      sessions={sessions}
      activeId={activeId}
      renamingId={renamingId}
      setRenamingId={setRenamingId}
    />
  );
}

function Strip({
  sessions,
  activeId,
  renamingId,
  setRenamingId,
}: {
  sessions: Session[];
  activeId: string;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
}) {
  const { state: drag, handlers } = useDragReorder((from, to) =>
    workspace.reorderSession(from, to),
  );
  return (
    <div className="session-strip">
      {sessions.map((s, i) => {
        const isActive = s.id === activeId;
        const isDragging = drag.dragIdx === i;
        const insertSide =
          drag.dragIdx !== null && drag.overIdx === i ? drag.overSide : null;
        return (
          <div
            key={s.id}
            className={
              `session-tab ${isActive ? 'session-tab--active' : ''}` +
              (isDragging ? ' session-tab--dragging' : '') +
              (insertSide === 'before' ? ' session-tab--drop-before' : '') +
              (insertSide === 'after' ? ' session-tab--drop-after' : '')
            }
            draggable={renamingId !== s.id}
            onDragStart={handlers.onDragStart(i)}
            onDragOver={handlers.onDragOver(i)}
            onDrop={handlers.onDrop(i)}
            onDragEnd={handlers.onDragEnd}
            onClick={() => workspace.setActiveSession(s.id)}
            onDoubleClick={() => setRenamingId(s.id)}
            title={s.name}
          >
            {renamingId === s.id ? (
              <RenameInput
                initial={s.name}
                onCommit={(name) => {
                  if (name.trim()) workspace.renameSession(s.id, name.trim());
                  setRenamingId(null);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <>
                <span className="session-tab-name">{s.name}</span>
                {sessions.length > 1 && (
                  <button
                    className="session-tab-close"
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      workspace.closeSession(s.id);
                    }}
                    aria-label="Close workspace"
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      <button
        className="session-tab-new"
        onClick={() => workspace.newSession()}
        title="New workspace"
        aria-label="New workspace"
      >
        +
      </button>
    </div>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      className="session-tab-rename"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit((e.target as HTMLInputElement).value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.target.value)}
    />
  );
}
