import { json } from '@codemirror/lang-json';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, basicSetup } from 'codemirror';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { VirtualList } from './VirtualList';

/** Above this size the text view uses a plain virtual line list instead of CodeMirror. */
export const CODEMIRROR_MAX_CHARS = 30_000_000;
/** CodeMirror struggles with very long lines (minified responses). */
const CODEMIRROR_MAX_LINE = 20_000;
/** Long lines are shown in chunks of this many characters in the plain view. */
const CHUNK = 4_000;

function longestLine(text: string): number {
  let max = 0;
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    if (end - start > max) max = end - start;
    if (nl === -1) return max;
    start = nl + 1;
  }
}

interface Props {
  text: string;
  dark: boolean;
}

/** Read-only text view of the document (pretty or as received). */
export function TextView({ text, dark }: Props) {
  const plain = useMemo(() => text.length > CODEMIRROR_MAX_CHARS || longestLine(text) > CODEMIRROR_MAX_LINE, [text]);
  if (plain) return <LineList text={text} />;
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

interface DisplayLine {
  /** Source line number, or 0 for a continuation chunk. */
  no: number;
  text: string;
}

function LineList({ text }: { text: string }) {
  const { rows, count } = useMemo(() => {
    const out: DisplayLine[] = [];
    const src = text.split('\n');
    src.forEach((line, i) => {
      if (line.length <= CHUNK) out.push({ no: i + 1, text: line });
      else for (let c = 0; c < line.length; c += CHUNK) out.push({ no: c === 0 ? i + 1 : 0, text: line.slice(c, c + CHUNK) });
    });
    return { rows: out, count: src.length };
  }, [text]);
  const width = String(count).length;
  return (
    <div class="textview lines" data-testid="text-view">
      <div class="muted pad small">
        Plain view without highlighting ({count.toLocaleString()} lines; long lines are wrapped every {CHUNK.toLocaleString()} characters).
      </div>
      <VirtualList
        className="line-list"
        count={rows.length}
        rowHeight={LINE_HEIGHT}
        renderRow={(i) => (
          <div key={i} class="text-line" style={{ height: `${LINE_HEIGHT}px` }}>
            <span class="gutter">{rows[i].no ? String(rows[i].no).padStart(width, ' ') : '↪'.padStart(width, ' ')}</span>
            {rows[i].text}
          </div>
        )}
      />
    </div>
  );
}
