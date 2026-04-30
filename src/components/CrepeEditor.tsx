import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { workspace, useWorkspace, findLeaf } from '../state/workspace';
import { attachBlockDragPreview } from '../lib/blockDragPreview';

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
  }, [tabId, initialValue]);

  const focusToken = useWorkspace((s) => s.focusToken);
  const isActive = useWorkspace((s) => {
    const focused = findLeaf(s.root, s.focusedLeafId);
    return focused?.activeTabId === tabId;
  });
  const seenToken = useRef(focusToken);
  useEffect(() => {
    // Only react to explicit focus requests, not to activation/mount.
    if (focusToken === seenToken.current) return;
    seenToken.current = focusToken;
    if (!isActive) return;
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
