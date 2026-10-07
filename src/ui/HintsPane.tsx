import { useEffect, useState } from 'preact/hooks';
import type { WorkerClient } from '../worker/client';
import { HINT_SECTIONS, type Hint } from './hints';

interface Props {
  client: WorkerClient;
  /** Bumped when a new document is loaded. */
  docKey: number;
  onPick: (query: string) => void;
  onClose: () => void;
}

/** Right-hand pane with JSONPath examples; clicking one runs it as a filter. */
export function HintsPane({ client, docKey, onPick, onClose }: Props) {
  const [own, setOwn] = useState<Hint[]>([]);
  useEffect(() => {
    let cancelled = false;
    client
      .call('suggestions')
      .then((s) => !cancelled && setOwn(s))
      .catch(() => !cancelled && setOwn([]));
    return () => {
      cancelled = true;
    };
  }, [client, docKey]);

  const item = (h: Hint) => (
    <button key={h.query} type="button" class="hint-item" onClick={() => onPick(h.query)} title="Run as filter">
      <code>{h.query}</code>
      <span class="muted">{h.description}</span>
    </button>
  );

  return (
    <aside class="results hints" aria-label="JSONPath examples" data-testid="hints-pane">
      <div class="results-head">
        <strong>JSONPath examples</strong>
        <span class="muted"> · click to run as a filter</span>
        <span class="spacer" />
        <button type="button" class="btn small icon" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div class="hints-body">
        {own.length > 0 && (
          <section>
            <h3>For this document</h3>
            {own.map(item)}
          </section>
        )}
        {HINT_SECTIONS.map((sec) => (
          <section key={sec.title}>
            <h3>{sec.title}</h3>
            {sec.note && <p class="muted small">{sec.note}</p>}
            {sec.hints.map(item)}
          </section>
        ))}
        <p class="muted small pad-top">
          Syntax:{' '}
          <a href="https://www.rfc-editor.org/rfc/rfc9535" target="_blank" rel="noreferrer">
            RFC 9535
          </a>
          . Strings take single or double quotes.
        </p>
      </div>
    </aside>
  );
}
