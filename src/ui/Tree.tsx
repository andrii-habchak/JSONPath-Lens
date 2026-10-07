import type { TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Row } from '../core/types';
import type { WorkerClient } from '../worker/client';
import { VirtualList, type ScrollRequest } from './VirtualList';

export const ROW_HEIGHT = 22;

interface Props {
  client: WorkerClient;
  visibleCount: number;
  /** Bumped whenever expand state or matches change. */
  version: number;
  selectedId: number;
  currentMatchId: number;
  scrollTo: ScrollRequest | null;
  onSelect: (row: Row, index: number) => void;
  onToggle: (row: Row, recursive: boolean) => void;
  onCopyPath: (id: number) => void;
  onCopyValue: (id: number) => void;
}

/** The virtualized JSON tree. Rows are fetched from the worker on demand. */
export function Tree(props: Props) {
  const { client, visibleCount, version } = props;
  const cache = useRef(new Map<number, Row>());
  const range = useRef<[number, number]>([0, 0]);
  const cacheVersion = useRef(-1);
  const [, rerender] = useState(0);
  const [selIndex, setSelIndex] = useState(-1);

  const fetchRange = useCallback(
    (start: number, end: number, v: number) => {
      if (end <= start) return;
      client
        .call('rows', start, end - start)
        .then((rows) => {
          // Responses arrive in request order; an older version's rows are dropped.
          if (v < cacheVersion.current) return;
          if (cacheVersion.current !== v) {
            cache.current = new Map();
            cacheVersion.current = v;
          }
          rows.forEach((r, i) => cache.current.set(start + i, r));
          rerender((x) => x + 1);
        })
        .catch(() => {});
    },
    [client],
  );

  // Refetch the current window when the tree changes.
  useEffect(() => {
    const [s, e] = range.current;
    fetchRange(s, Math.max(e, Math.min(visibleCount, s + 80)), version);
  }, [version, visibleCount, fetchRange]);

  const onRange = useCallback(
    (start: number, end: number) => {
      range.current = [start, end];
      const stale = cacheVersion.current !== version;
      let missing = stale;
      if (!missing) {
        for (let i = start; i < end; i++) {
          if (!cache.current.has(i)) {
            missing = true;
            break;
          }
        }
      }
      if (missing) fetchRange(start, end, version);
    },
    [version, fetchRange],
  );

  // Keep the keyboard cursor in sync with external selection.
  useEffect(() => {
    for (const [i, r] of cache.current) {
      if (r.id === props.selectedId) {
        setSelIndex(i);
        return;
      }
    }
  }, [props.selectedId, version]);

  const onKeyDown = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    const cur = selIndex >= 0 ? cache.current.get(selIndex) : undefined;
    const go = (i: number) => {
      const idx = Math.max(0, Math.min(visibleCount - 1, i));
      const r = cache.current.get(idx);
      if (r) {
        setSelIndex(idx);
        props.onSelect(r, idx);
      }
    };
    switch (e.key) {
      case 'ArrowDown':
        go(selIndex + 1);
        break;
      case 'ArrowUp':
        go(selIndex - 1);
        break;
      case 'PageDown':
        go(selIndex + 20);
        break;
      case 'PageUp':
        go(selIndex - 20);
        break;
      case 'Home':
        go(0);
        break;
      case 'ArrowRight':
        if (cur && cur.size > 0 && !cur.expanded) props.onToggle(cur, false);
        else go(selIndex + 1);
        break;
      case 'ArrowLeft':
        if (cur && cur.size > 0 && cur.expanded) props.onToggle(cur, false);
        else if (cur && cur.parent >= 0) {
          for (let i = selIndex - 1; i >= 0; i--) {
            const r = cache.current.get(i);
            if (r && r.id === cur.parent) {
              go(i);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (cur && cur.size > 0) props.onToggle(cur, e.shiftKey);
        break;
      default:
        if ((e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey) && cur && !window.getSelection()?.toString()) {
          props.onCopyValue(cur.id);
        } else return;
    }
    e.preventDefault();
  };

  const renderRow = (i: number) => {
    const r = cacheVersion.current === version || cache.current.has(i) ? cache.current.get(i) : undefined;
    if (!r) return <div key={i} class="row row-placeholder" style={{ height: `${ROW_HEIGHT}px` }} />;
    return (
      <TreeRow
        key={i}
        row={r}
        selected={r.id === props.selectedId}
        current={r.id === props.currentMatchId}
        onSelect={() => {
          setSelIndex(i);
          props.onSelect(r, i);
        }}
        onToggle={(rec) => props.onToggle(r, rec)}
        onCopyPath={() => props.onCopyPath(r.id)}
        onCopyValue={() => props.onCopyValue(r.id)}
      />
    );
  };

  return (
    <VirtualList
      className="tree"
      count={visibleCount}
      rowHeight={ROW_HEIGHT}
      renderRow={renderRow}
      onRange={onRange}
      scrollTo={props.scrollTo}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="tree"
      ariaLabel="JSON tree"
    />
  );
}

interface RowProps {
  row: Row;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
  onToggle: (recursive: boolean) => void;
  onCopyPath: () => void;
  onCopyValue: () => void;
}

function TreeRow({ row, selected, current, onSelect, onToggle, onCopyPath, onCopyValue }: RowProps) {
  const container = row.type === 'object' || row.type === 'array';
  const cls =
    'row' +
    (selected ? ' selected' : '') +
    (row.match ? ' match' : '') +
    (current ? ' current' : '') +
    (row.type === 'error' ? ' bad' : '');
  let label;
  if (row.depth === 0) label = <span class="k-root">$</span>;
  else if (row.key !== null) label = <span class="k">{row.key}</span>;
  else label = <span class="k-idx">{row.index}</span>;

  return (
    <div
      class={cls}
      style={{ height: `${ROW_HEIGHT}px`, paddingLeft: `${6 + row.depth * 16}px` }}
      role="treeitem"
      aria-expanded={container ? row.expanded : undefined}
      aria-selected={selected}
      data-id={row.id}
      onClick={onSelect}
      onDblClick={() => container && onToggle(false)}
    >
      <span
        class={'caret' + (container && row.size > 0 ? '' : ' leaf')}
        onClick={(e) => {
          e.stopPropagation();
          if (container && row.size > 0) onToggle(e.altKey || e.shiftKey);
        }}
        title={container ? 'Toggle (Alt/Shift+click: recursive)' : undefined}
      >
        {container && row.size > 0 ? (row.expanded ? '▾' : '▸') : ''}
      </span>
      {row.line !== undefined && <span class="line-no">L{row.line}</span>}
      {label}
      <span class="colon">{row.depth === 0 ? ' ' : ': '}</span>
      {container ? (
        <span class="summary">
          <span class="bracket">{row.type === 'object' ? '{…}' : '[…]'}</span>{' '}
          {row.size} {row.type === 'object' ? (row.size === 1 ? 'key' : 'keys') : row.size === 1 ? 'item' : 'items'}
        </span>
      ) : row.type === 'error' ? (
        <span class="v t-error" title={row.error}>
          {row.preview} <em>— {row.error}</em>
        </span>
      ) : (
        <span class={'v t-' + row.type}>{row.preview}</span>
      )}
      <span class="row-actions">
        <button
          type="button"
          title="Copy JSONPath"
          onClick={(e) => {
            e.stopPropagation();
            onCopyPath();
          }}
        >
          path
        </button>
        <button
          type="button"
          title="Copy value"
          onClick={(e) => {
            e.stopPropagation();
            onCopyValue();
          }}
        >
          value
        </button>
      </span>
    </div>
  );
}
