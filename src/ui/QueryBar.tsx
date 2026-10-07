import type { TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { QueryResult, SearchScope } from '../core/types';
import { formatCount } from './clipboard';
import type { QueryHistory } from './history';

export interface SearchToggles {
  regex: boolean;
  caseSensitive: boolean;
  scope: SearchScope;
}

interface Props {
  value: string;
  onInput: (v: string) => void;
  /** Run now (Enter). */
  onSubmit: () => void;
  onNext: () => void;
  onPrev: () => void;
  onClear: () => void;
  toggles: SearchToggles;
  onToggles: (t: SearchToggles) => void;
  result: QueryResult | null;
  current: number;
  busy: boolean;
  history: QueryHistory;
  onPickHistory: (query: string, mode: string) => void;
  inputRef?: { current: HTMLInputElement | null };
}

export function isPathQuery(q: string): boolean {
  return q.trim().startsWith('$');
}

export function QueryBar(p: Props) {
  const [histOpen, setHistOpen] = useState(false);
  const [cursor, setCursor] = useState(-1); // history browsing position
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = p.inputRef ?? localRef;
  const wrapRef = useRef<HTMLDivElement>(null);
  const entries = p.history.entries.value;
  const pathMode = isPathQuery(p.value);

  useEffect(() => {
    if (!histOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setHistOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [histOpen]);

  const onKeyDown = (e: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setCursor(-1);
      if (e.shiftKey) p.onPrev();
      else p.onSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setCursor(-1);
      setHistOpen(false);
      p.onClear();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && entries.length && (p.value === '' || cursor >= 0)) {
      e.preventDefault();
      const next = e.key === 'ArrowUp' ? Math.min(entries.length - 1, cursor + 1) : cursor - 1;
      setCursor(next);
      if (next < 0) p.onInput('');
      else p.onPickHistory(entries[next].query, entries[next].mode);
    } else if (e.key === 'F3' || (e.key === 'g' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (e.shiftKey) p.onPrev();
      else p.onNext();
    }
  };

  const r = p.result;
  const t = p.toggles;
  let status = '';
  if (p.busy) status = '…';
  else if (r && r.mode !== 'none') status = r.total ? `${formatCount(p.current + 1)} / ${formatCount(r.total)}` : r.error ? 'error' : '0';

  return (
    <div class="querybar" ref={wrapRef}>
      <span class={'mode-chip ' + (pathMode ? 'path' : t.regex ? 'regex' : 'text')} title="Queries starting with $ run as JSONPath; anything else is a quick search">
        {pathMode ? 'JSONPath' : t.regex ? 'Regex' : 'Text'}
      </span>
      <input
        ref={inputRef}
        class={'query-input' + (r?.error ? ' has-error' : '')}
        type="text"
        spellcheck={false}
        autocomplete="off"
        placeholder="$.items[?@.status == 'FAILED'].id   ·   $..[?@.email =~ /gmail/i]   ·   or plain text"
        value={p.value}
        aria-label="Query"
        data-testid="query-input"
        onInput={(e) => {
          setCursor(-1);
          p.onInput((e.currentTarget as HTMLInputElement).value);
        }}
        onKeyDown={onKeyDown}
      />
      <span class="match-status" data-testid="match-status">
        {status}
      </span>
      <button type="button" class="btn icon" onClick={p.onPrev} disabled={!r?.total} title="Previous match (Shift+Enter)">
        ↑
      </button>
      <button type="button" class="btn icon" onClick={p.onNext} disabled={!r?.total} title="Next match (Enter)">
        ↓
      </button>
      <span class="sep" />
      <button
        type="button"
        class={'btn toggle' + (t.regex ? ' on' : '')}
        aria-pressed={t.regex}
        disabled={pathMode}
        title="Quick search: regular expression"
        onClick={() => p.onToggles({ ...t, regex: !t.regex })}
      >
        .*
      </button>
      <button
        type="button"
        class={'btn toggle' + (t.caseSensitive ? ' on' : '')}
        aria-pressed={t.caseSensitive}
        disabled={pathMode}
        title="Quick search: case-sensitive"
        onClick={() => p.onToggles({ ...t, caseSensitive: !t.caseSensitive })}
      >
        Aa
      </button>
      <select
        class="scope"
        value={t.scope}
        disabled={pathMode}
        title="Quick search scope"
        onChange={(e) => p.onToggles({ ...t, scope: (e.currentTarget as HTMLSelectElement).value as SearchScope })}
      >
        <option value="both">Keys + values</option>
        <option value="keys">Keys</option>
        <option value="values">Values</option>
      </select>
      <div class="history-wrap">
        <button
          type="button"
          class={'btn' + (histOpen ? ' on' : '')}
          title="Query history for this document (cleared on reload)"
          aria-expanded={histOpen}
          data-testid="history-button"
          onClick={() => setHistOpen(!histOpen)}
        >
          History{entries.length ? ` (${entries.length})` : ''}
        </button>
        {histOpen && (
          <div class="history-pop" role="listbox" data-testid="history-list">
            {entries.length === 0 ? (
              <div class="muted pad">No queries yet. Queries you run on this document appear here until you reload.</div>
            ) : (
              <>
                {entries.map((h, i) => (
                  <div
                    key={h.query + h.mode}
                    class="history-item"
                    role="option"
                    onClick={() => {
                      setHistOpen(false);
                      p.onPickHistory(h.query, h.mode);
                    }}
                  >
                    <span class={'mode-dot ' + h.mode} title={h.mode} />
                    <code class="history-q">{h.query}</code>
                    <span class="muted history-count">{formatCount(h.count)}</span>
                    <button
                      type="button"
                      class="btn icon small"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        p.history.remove(i);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div class="history-foot">
                  <span class="muted">↑/↓ in an empty query bar steps through history</span>
                  <button type="button" class="btn small" onClick={() => p.history.clear()}>
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
