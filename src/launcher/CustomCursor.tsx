import { useEffect, useRef, useState } from 'react';

/** Custom cursor — replaces the system pointer inside the launcher with a
 *  soft accent dot that lerps toward the mouse position each frame. Over
 *  interactive rows the dot expands and softens; over the input we hide
 *  it so the system I-beam takes over. */
export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef({ x: 0, y: 0 });
  const currentRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const [mode, setMode] = useState<'default' | 'hover'>('default');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY };
      // Snap on first move so the dot doesn't fly in from (0,0).
      if (!visible) {
        currentRef.current = { x: e.clientX, y: e.clientY };
        setVisible(true);
      }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      // Same dot shape over the input as over plain bg — only rows /
      // buttons / kbd chips get the magnetic hover expansion.
      if (el?.closest('.launcher-row, button, .launcher-footer kbd')) {
        setMode('hover');
      } else {
        setMode('default');
      }
    };
    const onLeave = () => setVisible(false);

    const tick = () => {
      // Lerp factor — higher feels snappier, lower feels heavier. 0.22 lands
      // close to Alma's default feel.
      const k = 0.22;
      const dx = targetRef.current.x - currentRef.current.x;
      const dy = targetRef.current.y - currentRef.current.y;
      currentRef.current.x += dx * k;
      currentRef.current.y += dy * k;
      const dot = dotRef.current;
      if (dot) {
        dot.style.transform = `translate3d(${currentRef.current.x}px, ${currentRef.current.y}px, 0)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={dotRef}
      className={`custom-cursor custom-cursor--${mode}${visible ? '' : ' custom-cursor--hidden'}`}
      aria-hidden
    />
  );
}
