import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Reorder, type PanInfo } from 'framer-motion';
import { useWorkspace, workspace, type Session } from '../state/workspace';

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
  // Local mirror of the sessions array so framer's Reorder.Group can
  // animate sibling shifts during a drag without committing back to
  // the workspace store every frame. Re-syncs from the store between
  // drags (close, new, etc.).
  const [localSessions, setLocalSessions] = useState(sessions);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    if (
      sessions.length !== localSessions.length ||
      sessions.some((s, i) => s.id !== localSessions[i]?.id)
    ) {
      setLocalSessions(sessions);
    }
  }, [sessions, localSessions]);

  // Free-floating ghost rendered via portal so the dragged workspace
  // tab visually follows the cursor anywhere on screen — same pattern
  // as the file tab bar.
  const [ghost, setGhost] = useState<
    | { session: Session; x: number; y: number; width: number; height: number }
    | null
  >(null);

  const handleReorder = (next: Session[]) => {
    setLocalSessions(next);
  };

  const handleDragStart =
    (s: Session) =>
    (e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
      draggingRef.current = true;
      const target = e.target as HTMLElement | null;
      const tabEl = target?.closest('.session-tab') as HTMLElement | null;
      const r = tabEl?.getBoundingClientRect();
      if (r) {
        setGhost({
          session: s,
          x: info.point.x,
          y: info.point.y,
          width: r.width,
          height: r.height,
        });
      }
    };

  const handleDrag = (
    _e: PointerEvent | MouseEvent | TouchEvent,
    info: PanInfo,
  ) => {
    setGhost((g) => (g ? { ...g, x: info.point.x, y: info.point.y } : g));
  };

  const handleDragEnd = () => {
    draggingRef.current = false;
    setGhost(null);
    // Commit localSessions's order back to the store. Find the first
    // index where local and store disagree — that's the drop position.
    const newIds = localSessions.map((s) => s.id);
    const oldIds = sessions.map((s) => s.id);
    for (let i = 0; i < oldIds.length; i++) {
      if (oldIds[i] !== newIds[i]) {
        const movedId = newIds[i];
        const fromIdx = oldIds.indexOf(movedId);
        if (fromIdx >= 0 && fromIdx !== i) {
          workspace.reorderSession(fromIdx, i);
        }
        return;
      }
    }
  };

  return (
    <Reorder.Group
      as="div"
      axis="x"
      values={localSessions}
      onReorder={handleReorder}
      className="session-strip"
    >
      {localSessions.map((s) => {
        const isActive = s.id === activeId;
        const dragDisabled = renamingId === s.id;
        return (
          <Reorder.Item
            as="div"
            key={s.id}
            value={s}
            drag={dragDisabled ? false : 'x'}
            onDragStart={handleDragStart(s)}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            // Fade the source slot while it's lifted out — the portaled
            // ghost is what the user actually sees following the cursor.
            animate={{ opacity: ghost?.session.id === s.id ? 0.25 : 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 38, mass: 0.6 }}
            whileDrag={{ cursor: 'grabbing' }}
            className={`session-tab ${isActive ? 'session-tab--active' : ''}`}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      workspace.closeSession(s.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label="Close workspace"
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </Reorder.Item>
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

      {/* Portaled ghost — see TabBar.tsx for the same pattern. */}
      {ghost &&
        createPortal(
          <div
            className="session-tab session-tab--active session-tab-drag-ghost"
            style={{
              position: 'fixed',
              left: ghost.x,
              top: ghost.y,
              width: ghost.width,
              height: ghost.height,
              transform: 'translate(-50%, -50%) scale(1.04)',
              pointerEvents: 'none',
              zIndex: 9999,
              boxShadow:
                '0 12px 32px color-mix(in srgb, var(--text) 26%, transparent)',
            }}
          >
            <span className="session-tab-name">{ghost.session.name}</span>
          </div>,
          document.body,
        )}
    </Reorder.Group>
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
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
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
