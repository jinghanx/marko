import { forwardRef, useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdownRender';
import { highlightCodeBlocks } from '../lib/codeHighlight';

interface Props {
  content: string;
  /** Debounce window in ms. 0 disables debouncing (used for the standalone
   *  preview tab; the split view passes ~80 to keep typing snappy). */
  debounceMs?: number;
}

export const MarkdownPreview = forwardRef<HTMLDivElement, Props>(function MarkdownPreview(
  { content, debounceMs = 0 },
  scrollRef,
) {
  const [html, setHtml] = useState(() => renderMarkdown(content));
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceMs === 0) {
      setHtml(renderMarkdown(content));
      return;
    }
    const id = window.setTimeout(() => {
      setHtml(renderMarkdown(content));
    }, debounceMs);
    return () => clearTimeout(id);
  }, [content, debounceMs]);

  // Re-run code highlighting whenever the rendered HTML changes. Aborted on
  // unmount or before the next render so stale promises can't write into a
  // detached tree.
  useEffect(() => {
    const host = innerRef.current;
    if (!host) return;
    const ctrl = new AbortController();
    void highlightCodeBlocks(host, ctrl.signal);
    return () => ctrl.abort();
  }, [html]);

  return (
    <div className="md-preview" ref={scrollRef}>
      <div
        className="md-preview-inner"
        ref={innerRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});
