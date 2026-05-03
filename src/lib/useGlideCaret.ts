import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Refs and helpers returned by `useGlideCaret`. Consumers attach
 *  `mirrorRef` to a hidden span that mirrors the input's typography,
 *  and `caretRef` to the visible caret div. The two bump helpers go on
 *  the input's event handlers. */
export interface GlideCaretApi {
  mirrorRef: RefObject<HTMLSpanElement | null>;
  caretRef: RefObject<HTMLDivElement | null>;
  /** Call from onChange / onKeyDown so the hook knows the user is
   *  actively typing — suppresses caret blink during input so it
   *  reads as gliding, not flickering. */
  bumpInput: () => void;
  /** Call from onClick / onKeyUp to remeasure caret position when the
   *  cursor moves without changing the value (arrow keys, click). */
  recompute: () => void;
}

/**
 * Smooth-glide caret hook. Hides the native caret (consumer sets
 * `caret-color: transparent` on the input) and drives a custom DOM
 * caret that lerps between selection-start positions each frame.
 *
 * Consumer wiring:
 * ```tsx
 * const inputRef = useRef<HTMLInputElement>(null);
 * const { mirrorRef, caretRef, bumpInput, recompute } = useGlideCaret(inputRef, value);
 * return (
 *   <div className="my-input-wrap">          // position: relative
 *     <input
 *       ref={inputRef}
 *       value={value}
 *       onChange={(e) => { bumpInput(); setValue(e.target.value); }}
 *       onKeyDown={(e) => { bumpInput(); ... }}
 *       onKeyUp={recompute}
 *       onClick={recompute}
 *     />
 *     <span ref={mirrorRef} className="my-input-mirror" aria-hidden />
 *     <div ref={caretRef} className="my-input-caret" aria-hidden />
 *   </div>
 * );
 * ```
 *
 * The mirror span MUST share the input's typography (font, font-size,
 * letter-spacing, padding-left at minimum) so its measured width
 * equals the input's text x-offset for a given prefix. The visible
 * caret receives a `glide-caret--idle` class toggle — consumers
 * provide a CSS animation on `.glide-caret--idle` for the resting
 * blink (active blink during typing would look broken).
 */
export function useGlideCaret(
  inputRef: RefObject<HTMLInputElement | null>,
  value: string,
): GlideCaretApi {
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  // Latest target X (px from the start of the input's text area). The
  // lerp loop chases this each frame.
  const targetRef = useRef(0);
  const currentRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // Track the last user-input time so we can suppress blink during
  // typing — the caret looks weird blinking mid-glide.
  const lastInputAtRef = useRef(0);

  /** Recompute the target caret X by writing everything up to the
   *  selection's start into the mirror span and reading its width.
   *  Before measuring, we copy the input's computed font properties
   *  onto the mirror so the two render with identical metrics —
   *  otherwise tiny typography differences (font-weight, kerning,
   *  ligature settings) accumulate and the caret ends up "behind by
   *  N chars" on long strings. The computed-style read is cheap; we
   *  only call recompute on cursor moves, not every frame. */
  const recompute = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const cs = window.getComputedStyle(input);
    mirror.style.fontFamily = cs.fontFamily;
    mirror.style.fontSize = cs.fontSize;
    mirror.style.fontWeight = cs.fontWeight;
    mirror.style.fontStyle = cs.fontStyle;
    mirror.style.fontStretch = cs.fontStretch;
    mirror.style.fontVariant = cs.fontVariant;
    mirror.style.fontFeatureSettings = cs.fontFeatureSettings;
    mirror.style.fontVariantNumeric = cs.fontVariantNumeric;
    mirror.style.fontVariantLigatures = cs.fontVariantLigatures;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.style.wordSpacing = cs.wordSpacing;
    mirror.style.textTransform = cs.textTransform;
    mirror.style.textRendering = cs.textRendering;
    const cursorPos = input.selectionStart ?? input.value.length;
    const prefix = input.value.slice(0, cursorPos);
    mirror.textContent = prefix;
    targetRef.current = mirror.getBoundingClientRect().width;
  }, [inputRef]);

  const bumpInput = useCallback(() => {
    lastInputAtRef.current = Date.now();
  }, []);

  // rAF lerp loop. k = 0.35 lands between "snappy" and "glide" — fast
  // enough that backspace doesn't lag, slow enough to read as motion.
  useEffect(() => {
    const tick = () => {
      const dx = targetRef.current - currentRef.current;
      // Distance-aware easing: small gaps glide (k=0.35), big gaps
      // (e.g., from rapid typing or arrow-jumping past a long word)
      // accelerate to k=0.6 so the caret never lags more than ~1.5
      // chars visibly behind. Without this the user perceives a fixed
      // "behind by N chars" lag during fast input.
      const k = Math.abs(dx) > 28 ? 0.6 : 0.35;
      currentRef.current += dx * k;
      const caret = caretRef.current;
      if (caret) {
        caret.style.transform = `translateX(${currentRef.current}px)`;
        // Suppress blink for ~600ms after the last input so the caret
        // glides cleanly without flickering, then resume.
        const idle = Date.now() - lastInputAtRef.current > 600;
        caret.classList.toggle('glide-caret--idle', idle);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    // Snap on first mount so the caret is in the right place without
    // flying in from 0.
    requestAnimationFrame(() => {
      recompute();
      currentRef.current = targetRef.current;
    });
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [recompute]);

  // Recompute when value changes — covers typing and external value
  // updates (Tab to extend, paste, etc.).
  useEffect(() => {
    recompute();
  }, [value, recompute]);

  // Selection changes (arrow keys, click in input, double-click) don't
  // fire onChange. Use the input's own 'select' event.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onSelect = () => recompute();
    input.addEventListener('select', onSelect);
    return () => input.removeEventListener('select', onSelect);
  }, [inputRef, recompute]);

  return { mirrorRef, caretRef, bumpInput, recompute };
}
