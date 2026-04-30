/** Parse a unified `git diff` output into a file header (lines before the
 *  first @@ hunk) plus an array of hunks. Used to assemble single-hunk patches
 *  for `git apply --cached` (stage hunk) / `git apply --reverse` (discard) /
 *  `git apply --cached --reverse` (unstage hunk). */

export interface DiffHunk {
  /** The "@@ -a,b +c,d @@" line. */
  header: string;
  /** Body lines following the header, up to the next hunk or EOF. */
  body: string[];
}

export interface ParsedDiff {
  /** Lines before the first hunk: `diff --git`, `index`, `---`, `+++`. */
  fileHeader: string[];
  hunks: DiffHunk[];
}

export function parseUnifiedDiff(diff: string): ParsedDiff | null {
  if (!diff) return null;
  const lines = diff.split('\n');
  // Trailing empty line from the final \n is kept as '' — drop it so we
  // don't emit a stray blank in the output patch.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const firstHunkIdx = lines.findIndex((l) => l.startsWith('@@'));
  if (firstHunkIdx < 0) return null;
  const fileHeader = lines.slice(0, firstHunkIdx);
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  for (let i = firstHunkIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      if (cur) hunks.push(cur);
      cur = { header: line, body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) hunks.push(cur);
  return { fileHeader, hunks };
}

/** Reassemble a minimal patch containing just the given hunks of one file.
 *  Always ends in a trailing newline (git apply requires it). */
export function buildHunkPatch(parsed: ParsedDiff, hunks: DiffHunk[]): string {
  const lines: string[] = [...parsed.fileHeader];
  for (const h of hunks) {
    lines.push(h.header);
    lines.push(...h.body);
  }
  return lines.join('\n') + '\n';
}

/** Build a partial-hunk patch from a set of selected `+`/`-` line indices
 *  (indices into the original hunk.body array). Unselected `+` lines are
 *  dropped entirely; unselected `-` lines are converted to context. We
 *  recompute the hunk header line counts to match the new shape so
 *  `git apply` will accept the patch. Returns `null` if the selection
 *  produces an empty effective hunk.
 *
 *  Mode `'forward'` constructs a patch suitable for `git apply --cached`
 *  (stage selected) — i.e. we keep original `+`/`-` semantics.
 *  Mode `'reverse'` is for discard / unstage where we'll apply with
 *  `--reverse`; the patch shape is the same, the apply flag flips it.
 */
export function buildLineSelectionPatch(
  parsed: ParsedDiff,
  hunkIdx: number,
  selected: Set<number>,
): string | null {
  const hunk = parsed.hunks[hunkIdx];
  if (!hunk) return null;

  const oldStart = parseHunkStart(hunk.header, '-');
  const newStart = parseHunkStart(hunk.header, '+');

  const newBody: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  let added = 0;
  let removed = 0;

  for (let i = 0; i < hunk.body.length; i++) {
    const line = hunk.body[i];
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" — propagate as-is.
      newBody.push(line);
      continue;
    }
    if (line.startsWith('+')) {
      if (selected.has(i)) {
        newBody.push(line);
        newCount++;
        added++;
      } else {
        // Skip — pretend the addition didn't happen.
      }
    } else if (line.startsWith('-')) {
      if (selected.has(i)) {
        newBody.push(line);
        oldCount++;
        removed++;
      } else {
        // Convert to context — the deletion isn't being staged.
        newBody.push(' ' + line.slice(1));
        oldCount++;
        newCount++;
      }
    } else {
      // context line
      newBody.push(line);
      oldCount++;
      newCount++;
    }
  }

  if (added === 0 && removed === 0) return null;

  const newHunk: DiffHunk = {
    header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    body: newBody,
  };
  return buildHunkPatch(parsed, [newHunk]);
}

/** Parse the start-line number for either `-` (old) or `+` (new) side from
 *  a hunk header like "@@ -10,5 +12,8 @@". */
function parseHunkStart(header: string, sign: '-' | '+'): number {
  const m = new RegExp(`\\${sign}(\\d+)(?:,\\d+)?`).exec(header);
  return m ? parseInt(m[1], 10) : 1;
}
