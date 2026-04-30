import { useWorkspace, workspace, type LeafNode } from '../state/workspace';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';

interface Props {
  leaf: LeafNode;
  sessionId: string;
}

export function Pane({ leaf, sessionId }: Props) {
  const focused = useWorkspace(
    (s) =>
      s.activeSessionId === sessionId &&
      s.sessions.find((x) => x.id === sessionId)?.focusedLeafId === leaf.id,
  );

  return (
    <div
      className={`pane ${focused ? 'pane--focused' : ''}`}
      data-leaf-id={leaf.id}
      onMouseDown={(e) => {
        if (focused) return;
        workspace.setFocusedPane(leaf.id);
        // Belt-and-suspenders: force-focus the active editor inside this
        // pane on the next frame. The editors' own focus useEffect handles
        // most cases, but in multi-pane setups where another editor still
        // holds DOM focus, the React-driven path occasionally loses the
        // race. Querying the DOM directly is reliable.
        const paneEl = e.currentTarget as HTMLElement;
        requestAnimationFrame(() => {
          const editable = paneEl.querySelector<HTMLElement>(
            '.ProseMirror, .cm-content, .xterm-helper-textarea',
          );
          editable?.focus();
        });
      }}
    >
      <TabBar paneId={leaf.id} sessionId={sessionId} />
      <EditorPane paneId={leaf.id} sessionId={sessionId} />
    </div>
  );
}
