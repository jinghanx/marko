import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Multi-line variant of `useGlideCaret`. Same lerp-driven smooth-
 *  glide effect, but tracks both X and Y so the caret can move
 *  between wrapped lines. Backed by a hidden block-level mirror that
 *  matches the textarea's typography, width, and padding so wrapping
 *  positions line up exactly. A zero-width marker span inside the
 *  mirror reports its `offsetLeft`/`offsetTop` — those are the caret
 *  coordinates we lerp toward. */
export interface GlideCaretAreaApi {
  mirrorRef: RefObject<HTMLDivElement | null>;
  caretRef: RefObject<HTMLDivElement | null>;
  bumpInput: () => void;
  recompute: () => void;
}

/** Lerp factor: small gaps (in-line typing) glide softly; big gaps
 *  (line wrap, arrow-jumping past a paragraph) accelerate so the
 *  caret never lags visibly behind the actual cursor. */
function easeFactor(dx: number, dy: number): number {
  const dist = Math.hypot(dx, dy);
  return dist > 28 ? 0.6 : 0.35;
}

export function useGlideCaretArea(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
): GlideCaretAreaApi {
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const targetXRef = useRef(0);
  const targetYRef = useRef(0);
  const currentXRef = useRef(0);
  const currentYRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastInputAtRef = useRef(0);

  /** Position the mirror to overlap the textarea exactly, copy
   *  typography + box metrics, then split the value at the cursor
   *  and read a marker span's position. The span's coordinates ARE
   *  the caret target — wrapping is handled by the browser inside
   *  the mirror because we mirror the textarea's content-box width. */
  const recompute = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const cs = window.getComputedStyle(input);
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.fontWeight = cs.fontWeight;
    mirror.style.fontStyle = cs.fontStyle;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.wordSpacing = cs.wordSpacing;
    mirror.style.textIndent = cs.textIndent;
    mirror.style.textTransform = cs.textTransform;
    mirror.style.tabSize = cs.tabSize;
    // Match the textarea's content box exactly so soft-wraps land at
    // the same character. Padding lives on the mirror too, so the
    // marker's offsetLeft is in the same coordinate space the caret
    // will be translated into (relative to the textarea's border-box).
    mirror.style.width = cs.width;
    mirror.style.paddingTop = cs.paddingTop;
    mirror.style.paddingRight = cs.paddingRight;
    mirror.style.paddingBottom = cs.paddingBottom;
    mirror.style.paddingLeft = cs.paddingLeft;
    mirror.style.borderTopWidth = cs.borderTopWidth;
    mirror.style.borderRightWidth = cs.borderRightWidth;
    mirror.style.borderBottomWidth = cs.borderBottomWidth;
    mirror.style.borderLeftWidth = cs.borderLeftWidth;
    mirror.style.boxSizing = cs.boxSizing;

    const cursorPos = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, cursorPos);
    const after = input.value.slice(cursorPos);
    // Build the mirror DOM: prefix text node, marker span, suffix
    // text node. The suffix matters because if the cursor sits at
    // end-of-line, the prefix alone would let the marker collapse
    // onto the previous line — having text after the marker forces
    // the layout into the new line where the user actually is.
    mirror.textContent = '';
    mirror.appendChild(document.createTextNode(before));
    const marker = document.createElement('span');
    marker.style.display = 'inline-block';
    marker.style.width = '0';
    marker.style.height = cs.lineHeight;
    marker.style.verticalAlign = 'top';
    mirror.appendChild(marker);
    // Use a single space, not the actual suffix, when there's no
    // suffix — keeps the marker positioned correctly at the trailing
    // edge of the prefix. With the real suffix, layout cost grows
    // with text length for no extra correctness.
    mirror.appendChild(document.createTextNode(after.length > 0 ? after : ' '));

    targetXRef.current = marker.offsetLeft - input.scrollLeft;
    targetYRef.current = marker.offsetTop - input.scrollTop;
  }, [inputRef]);

  const bumpInput = useCallback(() => {
    lastInputAtRef.current = Date.now();
  }, []);

  // rAF lerp loop — drives both X and Y toward the latest target.
  useEffect(() => {
    const tick = () => {
      const dx = targetXRef.current - currentXRef.current;
      const dy = targetYRef.current - currentYRef.current;
      const k = easeFactor(dx, dy);
      currentXRef.current += dx * k;
      currentYRef.current += dy * k;
      const caret = caretRef.current;
      if (caret) {
        caret.style.transform = `translate(${currentXRef.current}px, ${currentYRef.current}px)`;
        const idle = Date.now() - lastInputAtRef.current > 600;
        caret.classList.toggle('glide-caret--idle', idle);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    requestAnimationFrame(() => {
      recompute();
      currentXRef.current = targetXRef.current;
      currentYRef.current = targetYRef.current;
    });
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [recompute]);

  // Track value changes: typing, paste, programmatic clear.
  useEffect(() => {
    recompute();
  }, [value, recompute]);

  // Selection changes that don't fire onChange (arrows, click,
  // double-click). Also remeasure on scroll — long content can scroll
  // the textarea internally and we need to follow the caret on screen.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onSelect = () => recompute();
    const onScroll = () => recompute();
    input.addEventListener('select', onSelect);
    input.addEventListener('scroll', onScroll);
    return () => {
      input.removeEventListener('select', onSelect);
      input.removeEventListener('scroll', onScroll);
    };
  }, [inputRef, recompute]);

  return { mirrorRef, caretRef, bumpInput, recompute };
}
