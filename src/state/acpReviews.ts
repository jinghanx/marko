/** Global store of pending agent-write reviews, keyed by absolute
 *  file path. Populated by AgentView instances (each one subscribes
 *  to its session's events and pushes new/changed reviews here);
 *  consumed by EditorPane (decides whether to render the inline-diff
 *  review view in place of the regular editor) and by AgentView
 *  itself (renders the cross-file pending-changes panel).
 *
 *  Multi-session note: a review carries its owning `reqId`. When an
 *  AgentView refreshes its reqId's reviews, it replaces the whole
 *  slice for that reqId — removing any reviews that were resolved
 *  out from under it. Cross-session collisions on the same path are
 *  unlikely in practice (you'd have two agents editing the same
 *  file concurrently); if it happens, "last write wins" in this
 *  store, but each review still has its own id in main and resolves
 *  independently. */

import { useSyncExternalStore } from 'react';
import type { AcpReviewSummary } from '../types/milu';

interface State {
  /** Snapshot map: absolute path → review. */
  byPath: Map<string, AcpReviewSummary & { reqId: string }>;
}

let state: State = { byPath: new Map() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function setState(next: State) {
  state = next;
  emit();
}

export const acpReviews = {
  getState: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Replace the slice owned by `reqId` with the latest list from
   *  main. Reviews from other reqIds stay put. */
  replaceForReqId(reqId: string, reviews: AcpReviewSummary[]) {
    const next = new Map(state.byPath);
    // Drop any prior reviews for this reqId.
    for (const [k, v] of next) {
      if (v.reqId === reqId) next.delete(k);
    }
    for (const r of reviews) {
      next.set(r.path, { ...r, reqId });
    }
    setState({ byPath: next });
  },

  /** Drop a review from the store — called after the user resolves
   *  or abandons it. */
  drop(path: string) {
    if (!state.byPath.has(path)) return;
    const next = new Map(state.byPath);
    next.delete(path);
    setState({ byPath: next });
  },

  /** Drop everything owned by a session — called when an AgentView
   *  unmounts (its session is being disposed). */
  clearReqId(reqId: string) {
    let dirty = false;
    const next = new Map(state.byPath);
    for (const [k, v] of next) {
      if (v.reqId === reqId) {
        next.delete(k);
        dirty = true;
      }
    }
    if (dirty) setState({ byPath: next });
  },
};

export function useAcpReview(path: string | null | undefined): (AcpReviewSummary & { reqId: string }) | null {
  const sub = useSyncExternalStore(
    acpReviews.subscribe,
    () => state.byPath,
  );
  if (!path) return null;
  return sub.get(path) ?? null;
}

export function useAcpReviewsForReqId(reqId: string | null | undefined): AcpReviewSummary[] {
  const sub = useSyncExternalStore(
    acpReviews.subscribe,
    () => state.byPath,
  );
  if (!reqId) return [];
  const out: AcpReviewSummary[] = [];
  for (const v of sub.values()) {
    if (v.reqId === reqId) out.push(v);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}
