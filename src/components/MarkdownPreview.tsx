import { useMemo } from 'react';
import { marked } from 'marked';

interface Props {
  content: string;
}

// Configure once. GFM is on by default in modern marked; enable line breaks
// to mimic editor visual line wrapping.
marked.setOptions({ gfm: true, breaks: false });

export function MarkdownPreview({ content }: Props) {
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string;
    } catch {
      return '<pre>parse error</pre>';
    }
  }, [content]);

  return (
    <div className="md-preview">
      <div className="md-preview-inner" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
