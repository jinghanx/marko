/** Cursor-style inline review of an agent-proposed file write.
 *  Shown in place of the regular code editor whenever the open file
 *  has a pending review (see EditorPane). The user can:
 *   - Accept / reject individual hunks (each hunk gets a small pill
 *     button row).
 *   - Accept all / reject all in one click via the toolbar.
 *   - Cancel — abandons the review entirely; the agent's
 *     writeTextFile call rejects, which it'll surface in the
 *     transcript as a tool failure.
 *  Once the user picks Accept all / Reject all / Apply (partial),
 *  main writes the merged content to disk + the editor flips back
 *  to its normal mode showing the new content. */

import { useEffect, useMemo, useState } from 'react';
import { parseUnifiedDiff, type DiffHunk } from '../lib/diffHunks';
import type { AcpReviewDetail } from '../types/milu';
import { acpReviews } from '../state/acpReviews';

type Decision = 'pending' | 'accepted' | 'rejected';

interface Props {
  reviewId: string;
  filePath: string;
}

export function DiffReviewView({ reviewId, filePath }: Props) {
  const [detail, setDetail] = useState<AcpReviewDetail | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.milu.acpReviewGet(reviewId).then((d) => {
      if (!alive) return;
      if (d) {
        setDetail(d);
        setDecisions(d.hunks.map((h) => h.decision));
      }
    });
    return () => {
      alive = false;
    };
  }, [reviewId]);

  const parsed = useMemo(
    () => (detail ? parseUnifiedDiff(detail.unifiedDiff) : null),
    [detail],
  );

  /** Pair each parsed-hunk render with its decision index. The diff
   *  parser walks the same hunks in the same order as `diff`'s
   *  structuredPatch, so indices line up 1:1. */
  const setHunk = async (hi: number, d: Decision) => {
    setDecisions((prev) => {
      const next = [...prev];
      next[hi] = d;
      return next;
    });
    try {
      await window.milu.acpReviewSetHunk(reviewId, hi, d);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resolve = async (mode: 'accept-all' | 'reject-all' | 'partial') => {
    setBusy(true);
    try {
      const r = await window.milu.acpReviewResolve(reviewId, mode);
      if (!r.ok) {
        setError(r.error ?? 'resolve failed');
        setBusy(false);
        return;
      }
      acpReviews.drop(filePath);
      // No setBusy(false) — the parent EditorPane will swap us out for
      // the regular editor as soon as the store update lands.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await window.milu.acpReviewAbandon(reviewId);
      acpReviews.drop(filePath);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!detail || !parsed) {
    return <div className="diff-review diff-review--loading">Loading review…</div>;
  }

  const acceptedCount = decisions.filter((d) => d === 'accepted').length;
  const rejectedCount = decisions.filter((d) => d === 'rejected').length;
  const total = decisions.length;
  const pendingCount = total - acceptedCount - rejectedCount;

  return (
    <div className="diff-review">
      <div className="diff-review-toolbar">
        <div className="diff-review-counts">
          <strong>Agent proposed {total} hunk{total === 1 ? '' : 's'}</strong>
          {' · '}
          <span className="diff-review-count diff-review-count--accept">
            {acceptedCount} accepted
          </span>
          {' · '}
          <span className="diff-review-count diff-review-count--reject">
            {rejectedCount} rejected
          </span>
          {pendingCount > 0 && (
            <>
              {' · '}
              <span className="diff-review-count diff-review-count--pending">
                {pendingCount} pending
              </span>
            </>
          )}
        </div>
        <div className="diff-review-actions">
          <button
            className="diff-review-btn"
            onClick={() => void cancel()}
            disabled={busy}
            title="Discard the entire review — the agent's writeTextFile call rejects"
          >
            Cancel
          </button>
          <button
            className="diff-review-btn"
            onClick={() => void resolve('reject-all')}
            disabled={busy}
            title="Keep the file unchanged — the agent's writeTextFile call still resolves successfully"
          >
            Reject all
          </button>
          <button
            className="diff-review-btn diff-review-btn--primary"
            onClick={() => void resolve('partial')}
            disabled={busy || pendingCount > 0}
            title={pendingCount > 0 ? 'Decide every hunk first, or use Accept all / Reject all' : 'Apply the accepted hunks to disk'}
          >
            Apply
          </button>
          <button
            className="diff-review-btn diff-review-btn--primary"
            onClick={() => void resolve('accept-all')}
            disabled={busy}
            title="Accept every hunk and write to disk"
          >
            Accept all
          </button>
        </div>
      </div>
      {error && <div className="diff-review-error">{error}</div>}
      <div className="diff-review-body">
        {parsed.fileHeader.map((line, i) => (
          <div key={`fh-${i}`} className="git-diff-line git-diff-line--meta">
            {line || ' '}
          </div>
        ))}
        {parsed.hunks.map((hunk, hi) => (
          <ReviewHunk
            key={hi}
            hunk={hunk}
            decision={decisions[hi] ?? 'pending'}
            onAccept={() => void setHunk(hi, decisions[hi] === 'accepted' ? 'pending' : 'accepted')}
            onReject={() => void setHunk(hi, decisions[hi] === 'rejected' ? 'pending' : 'rejected')}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewHunk({
  hunk,
  decision,
  onAccept,
  onReject,
}: {
  hunk: DiffHunk;
  decision: Decision;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className={`diff-review-hunk diff-review-hunk--${decision}`}>
      <div className="diff-review-hunk-bar">
        <span className="git-diff-line git-diff-line--hunk diff-review-hunk-header">
          {hunk.header}
        </span>
        <div className="diff-review-hunk-actions">
          <button
            className={`diff-review-hunk-btn${decision === 'rejected' ? ' diff-review-hunk-btn--active' : ''}`}
            onClick={onReject}
            title={decision === 'rejected' ? 'Click again to set back to pending' : 'Reject this hunk — keep the original lines'}
          >
            ✗ Reject
          </button>
          <button
            className={`diff-review-hunk-btn diff-review-hunk-btn--accept${decision === 'accepted' ? ' diff-review-hunk-btn--active' : ''}`}
            onClick={onAccept}
            title={decision === 'accepted' ? 'Click again to set back to pending' : 'Accept this hunk — apply the agent\'s lines'}
          >
            ✓ Accept
          </button>
        </div>
      </div>
      {hunk.body.map((line, li) => {
        let cls = 'git-diff-line';
        if (line.startsWith('+')) cls += ' git-diff-line--added';
        else if (line.startsWith('-')) cls += ' git-diff-line--removed';
        return (
          <div key={li} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
}
