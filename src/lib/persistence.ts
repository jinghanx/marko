import {
  serializeWorkspace,
  hydrateFromSnapshot,
  subscribeWorkspace,
} from '../state/workspace';

const SAVE_DEBOUNCE_MS = 600;

let saveTimer: number | null = null;
let started = false;

function scheduleSave() {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    saveTimer = null;
    try {
      const snap = serializeWorkspace();
      await window.marko.stateWrite(JSON.stringify(snap));
    } catch {
      // Best-effort; a failed save shouldn't crash the renderer.
    }
  }, SAVE_DEBOUNCE_MS);
}

/** Hydrate workspace from ~/.marko/state.json (no-op if missing/invalid),
 *  then start auto-saving on every workspace state change. Idempotent. */
export async function startWorkspacePersistence(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const raw = await window.marko.stateRead();
    if (raw) {
      const parsed = JSON.parse(raw);
      await hydrateFromSnapshot(parsed);
    }
  } catch {
    // Corrupt snapshot — leave the freshly-initialized state alone.
  }

  subscribeWorkspace(scheduleSave);
}

/** Wipe the persisted state and reload the window so the app boots from
 *  a clean default. Triggered by the "Reset Workspace" menu item. */
export async function resetWorkspaceAndReload(): Promise<void> {
  try {
    await window.marko.stateReset();
  } catch {
    // ignore
  }
  window.location.reload();
}
