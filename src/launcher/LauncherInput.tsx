import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

interface Props {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/** Launcher search field with a custom-rendered, smoothly-lerped text
 *  caret. The native caret is hidden via `caret-color: transparent`; a
 *  hidden mirror <span> measures the text width up to the cursor index
 *  on every input/selection change, and a rAF loop interpolates the
 *  visible caret toward that target X. Adds the Alma-style "glide"
 *  effect when typing — the caret slides between positions instead of
 *  snapping. */
export const LauncherInput = forwardRef<HTMLInputElement, Props>(function LauncherInput(
  { value, placeholder, onChange, onKeyDown },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
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

  // Forward the input ref to parent so they can call .focus() etc.
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

  /** Recompute the target caret X by writing everything up to the
   *  selection's start into the mirror span and reading its width. */
  const recompute = () => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const cursorPos = input.selectionStart ?? input.value.length;
    // The mirror's content needs a non-collapsing trailing char when
    // the prefix ends with whitespace, otherwise the browser collapses
    // the trailing space and the width is wrong by ~5px.
    const prefix = input.value.slice(0, cursorPos);
    mirror.textContent = prefix;
    targetRef.current = mirror.getBoundingClientRect().width;
  };

  useEffect(() => {
    // rAF lerp loop. k = 0.35 lands between "snappy" and "glide" — fast
    // enough that backspace doesn't lag, slow enough to read as motion.
    const tick = () => {
      const k = 0.35;
      const dx = targetRef.current - currentRef.current;
      currentRef.current += dx * k;
      const caret = caretRef.current;
      if (caret) {
        caret.style.transform = `translateX(${currentRef.current}px)`;
        // Suppress blink for ~600ms after the last input so the caret
        // glides cleanly without flickering, then resume.
        const idle = Date.now() - lastInputAtRef.current > 600;
        caret.classList.toggle('launcher-caret--idle', idle);
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
  }, []);

  // Recompute when value changes — covers typing and external value
  // updates (Tab to extend, etc.).
  useEffect(() => {
    recompute();
  }, [value]);

  // Selection changes (arrow keys, click in input, double-click) don't
  // fire onChange. Use the input's own 'select' event plus a polled
  // selection check on every keydown/up.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onSelect = () => recompute();
    input.addEventListener('select', onSelect);
    return () => input.removeEventListener('select', onSelect);
  }, []);

  return (
    <div className="launcher-input-wrap">
      <input
        ref={inputRef}
        className="launcher-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          lastInputAtRef.current = Date.now();
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          lastInputAtRef.current = Date.now();
          onKeyDown?.(e);
        }}
        onKeyUp={recompute}
        onClick={recompute}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
      />
      {/* Mirror used to measure text width up to the caret. Same font,
          padding, and box sizing as the input — must remain in lockstep
          via the CSS that styles both .launcher-input and this. */}
      <span ref={mirrorRef} className="launcher-input-mirror" aria-hidden />
      <div ref={caretRef} className="launcher-caret" aria-hidden />
    </div>
  );
});
