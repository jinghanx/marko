import { useWorkspace, workspace, type LeafNode } from '../state/workspace';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';

interface Props {
  leaf: LeafNode;
}

export function Pane({ leaf }: Props) {
  const focused = useWorkspace((s) => s.focusedLeafId === leaf.id);

  return (
    <div
      className={`pane ${focused ? 'pane--focused' : ''}`}
      onMouseDown={() => {
        if (!focused) workspace.setFocusedPane(leaf.id);
      }}
    >
      <TabBar paneId={leaf.id} />
      <EditorPane paneId={leaf.id} />
    </div>
  );
}
