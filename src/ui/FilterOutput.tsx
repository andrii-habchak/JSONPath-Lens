import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Row } from '../core/types';
import { WorkerClient } from '../worker/client';
import { copyText, downloadText, formatBytes, formatCount } from './clipboard';
import { TextView } from './TextView';
import { Tree } from './Tree';

export interface FilterData {
  /** Matched values as a JSON array. */
  text: string;
  /** Number of values in `text`. */
  count: number;
  /** Total matches (more than `count` when the output was size-capped). */
  total: number;
  ms: number;
}

interface Props {
  data: FilterData;
  dark: boolean;
  /** Base name for downloads. */
  name: string;
  flash: (msg: string) => void;
  onClose: () => void;
}

/** Right-hand pane in Filter mode: the matched values as their own JSON document. */
export function FilterOutput({ data, dark, name, flash, onClose }: Props) {
  const [client] = useState(() => new WorkerClient());
  useEffect(() => () => client.terminate(), [client]);

  const [ready, setReady] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(-1);
  const [view, setView] = useState<'tree' | 'text'>('tree');

  const bump = useCallback((n: number) => {
    setVisibleCount(n);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setSelectedId(-1);
    client
      .call('load', data.text, 'application/json')
      .then((r) => {
        if (cancelled || !r.ok) return;
        bump(r.visibleCount);
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data.text, client, bump]);

  const onToggle = useCallback(
    async (row: Row, recursive: boolean) => {
      bump(recursive ? await client.call('setExpanded', row.id, !row.expanded, true) : await client.call('toggle', row.id));
    },
    [client, bump],
  );

  const copyPath = async (id: number) => {
    const p = await client.call('path', id);
    flash((await copyText(p)) ? `Copied ${p} (path in the output)` : 'Copy failed');
  };
  const copyValue = async (id: number) => {
    const v = await client.call('valueText', id, true);
    flash((await copyText(v)) ? `Copied value (${formatBytes(v.length)})` : 'Copy failed');
  };

  const label = `${formatCount(data.total)} ${data.total === 1 ? 'result' : 'results'}`;

  return (
    <aside class="results filter-output" aria-label="Filter output" data-testid="filter-output">
      <div class="results-head">
        <strong data-testid="filter-count">{label}</strong>
        {data.count < data.total && <span class="muted"> (first {formatCount(data.count)} in output, size limit)</span>}
        <span class="muted"> · {data.ms} ms</span>
        <span class="spacer" />
        <div class="segmented small-seg" role="group" aria-label="Output view">
          <button type="button" class={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')}>
            Tree
          </button>
          <button type="button" class={view === 'text' ? 'on' : ''} onClick={() => setView('text')} data-testid="filter-text-button">
            Text
          </button>
        </div>
        <button
          type="button"
          class="btn small"
          title="Copy the output as JSON"
          onClick={async () => flash((await copyText(data.text)) ? `Copied ${label}` : 'Copy failed')}
        >
          Copy
        </button>
        <button
          type="button"
          class="btn small"
          title="Download the output"
          onClick={() => downloadText(data.text, `${name}-filtered.json`)}
        >
          Download
        </button>
        <button type="button" class="btn small icon" onClick={onClose} title="Hide output (Esc clears the query)">
          ×
        </button>
      </div>
      {view === 'text' ? (
        <TextView text={data.text} dark={dark} />
      ) : ready ? (
        <Tree
          client={client}
          visibleCount={visibleCount}
          version={version}
          selectedId={selectedId}
          currentMatchId={-1}
          scrollTo={null}
          onSelect={(r) => setSelectedId(r.id)}
          onToggle={onToggle}
          onCopyPath={copyPath}
          onCopyValue={copyValue}
        />
      ) : (
        <div class="center muted">Loading…</div>
      )}
    </aside>
  );
}
