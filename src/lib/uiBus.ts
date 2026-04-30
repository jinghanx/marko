type UIEvent =
  | 'open-palette'
  | 'open-settings'
  | 'open-process-viewer'
  | 'open-new-file'
  | 'focus-address';

const listeners = new Map<UIEvent, Set<() => void>>();

export const uiBus = {
  emit(event: UIEvent) {
    listeners.get(event)?.forEach((fn) => fn());
  },
  on(event: UIEvent, fn: () => void): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  },
};
