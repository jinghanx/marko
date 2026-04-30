import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { workspace, useWorkspace, findLeaf, getActiveSession } from '../state/workspace';
import { attachBlockDragPreview } from '../lib/blockDragPreview';
import { installSlashMenuFix } from '../lib/slashMenuFix';

// Module-level: install the slash-menu fix once for the whole app.
installSlashMenuFix();

import '@milkdown/crepe/theme/common/style.css';

interface Props {
  tabId: string;
  initialValue: string;
}

export function CrepeEditor({ tabId, initialValue }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let firstFire = true;
    const crepe = new Crepe({
      root: host,
      defaultValue: initialValue,
    });
    crepeRef.current = crepe;

    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        if (disposed) return;
        if (firstFire) {
          firstFire = false;
          // Adopt Crepe's first parse as the saved baseline — round-trip
          // differences shouldn't mark the tab as dirty.
          workspace.rebaseSavedContent(tabId, markdown);
          return;
        }
        workspace.updateContent(tabId, markdown);
      });
    });

    let detachDragPreview: (() => void) | null = null;

    crepe
      .create()
      .then(() => {
        if (disposed) return;
        detachDragPreview = attachBlockDragPreview(host);
        // If this editor's tab is the active one in the focused pane at
        // mount time (e.g., just opened via ⌘P / ⌘O / ⌘T), give it the cursor.
        // The `seenToken` effect can't handle this — its ref initializes to
        // the current token, so a mount-time bump is missed.
        const focused = workspace.getFocusedLeaf();
        if (focused.activeTabId === tabId && !host.contains(document.activeElement)) {
          try {
            crepe.editor.action((ctx) => {
              ctx.get(editorViewCtx).focus();
            });
          } catch {
            // editor may not be fully initialized yet
          }
        }
      })
      .catch((err) => {
        console.error('Failed to create Crepe editor', err);
      });

    return () => {
      disposed = true;
      detachDragPreview?.();
      void crepe.destroy();
      crepeRef.current = null;
    };
    // initialValue is intentionally captured once at mount — Crepe owns the
    // document state after that. Updating savedContent (e.g., via rebase or
    // ⌘S) must NOT recreate the editor and steal focus from the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const focusToken = useWorkspace((s) => s.focusToken);
  const isActive = useWorkspace((s) => {
    const session = getActiveSession(s);
    const focused = findLeaf(session.root, session.focusedLeafId);
    return focused?.activeTabId === tabId;
  });
  const seenToken = useRef(focusToken);
  useEffect(() => {
    // Only react to explicit focus requests, not to activation/mount.
    if (focusToken === seenToken.current) return;
    seenToken.current = focusToken;
    if (!isActive) return;
    // Don't steal focus from the user if this editor already has it
    // (or if any input is currently focused — typing in modals etc.).
    const host = hostRef.current;
    if (host?.contains(document.activeElement)) return;
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      crepe.editor.action((ctx) => {
        ctx.get(editorViewCtx).focus();
      });
    } catch {
      // editor may not be fully initialized yet
    }
  }, [focusToken, isActive]);

  return <div ref={hostRef} className="crepe-host" />;
}
