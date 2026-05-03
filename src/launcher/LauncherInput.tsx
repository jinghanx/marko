import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useGlideCaret } from '../lib/useGlideCaret';

interface Props {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/** Launcher search field with the smooth-glide caret. The native
 *  caret is hidden via `caret-color: transparent` (in launcher.css);
 *  the visible one is driven by `useGlideCaret` which lerps between
 *  selection positions each frame. */
export const LauncherInput = forwardRef<HTMLInputElement, Props>(function LauncherInput(
  { value, placeholder, onChange, onKeyDown },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
  const { mirrorRef, caretRef, bumpInput, recompute } = useGlideCaret(inputRef, value);

  return (
    <div className="launcher-input-wrap">
      <input
        ref={inputRef}
        className="launcher-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          bumpInput();
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          bumpInput();
          onKeyDown?.(e);
        }}
        onKeyUp={recompute}
        onClick={recompute}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
      />
      <span ref={mirrorRef} className="launcher-input-mirror" aria-hidden />
      <div ref={caretRef} className="launcher-caret" aria-hidden />
    </div>
  );
});
