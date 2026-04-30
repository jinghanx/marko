type Mode = 'copy' | 'cut';

let state: { mode: Mode; paths: string[] } | null = null;
const listeners = new Set<() => void>();

export const fileClipboard = {
  get(): { mode: Mode; paths: string[] } | null {
    return state;
  },
  set(mode: Mode, paths: string[]) {
    state = { mode, paths: [...paths] };
    listeners.forEach((fn) => fn());
  },
  clear() {
    state = null;
    listeners.forEach((fn) => fn());
  },
  isCutPath(path: string): boolean {
    return !!state && state.mode === 'cut' && state.paths.includes(path);
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
