import { json } from '@codemirror/lang-json';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, basicSetup } from 'codemirror';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { VirtualList } from './VirtualList';

/** Above this size the text view uses a plain virtual line list instead of CodeMirror. */
export const CODEMIRROR_MAX_CHARS = 30_000_000;

interface Props {
  text: string;
  dark: boolean;
}

/** Read-only text view of the document (pretty or as received). */
export function TextView({ text, dark }: Props) {
  if (text.length > CODEMIRROR_MAX_CHARS) return <LineList text={text} />;
  return <CodeView text={text} dark={dark} />;
}

function CodeView({ text, dark }: Props) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          json(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ tabindex: '0' }),
          ...(dark ? [oneDark] : []),
          EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'var(--mono)' } }),
        ],
      }),
    });
    return () => view.destroy();
  }, [text, dark]);
  return <div class="textview" ref={host} data-testid="text-view" />;
}

const LINE_HEIGHT = 18;

function LineList({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const width = String(lines.length).length;
  return (
    <div class="textview lines" data-testid="text-view">
      <div class="muted pad small">Large document ({lines.length.toLocaleString()} lines): plain view without highlighting.</div>
      <VirtualList
        className="line-list"
        count={lines.length}
        rowHeight={LINE_HEIGHT}
        renderRow={(i) => (
          <div key={i} class="text-line" style={{ height: `${LINE_HEIGHT}px` }}>
            <span class="gutter">{String(i + 1).padStart(width, ' ')}</span>
            {lines[i]}
          </div>
        )}
      />
    </div>
  );
}
