import type { QueryResult } from '../core/types';
import { formatCount } from './clipboard';
import { VirtualList, type ScrollRequest } from './VirtualList';

interface Props {
  result: QueryResult;
  current: number;
  scrollTo: ScrollRequest | null;
  onPick: (index: number) => void;
  onCopyResults: () => void;
  onClose: () => void;
}

const ITEM_HEIGHT = 42;

/** Right-hand list of matches: path + value preview. */
export function ResultsPane({ result, current, scrollTo, onPick, onCopyResults, onClose }: Props) {
  const shown = result.results.length;
  return (
    <aside class="results" aria-label="Query results">
      <div class="results-head">
        <strong data-testid="match-count">
          {formatCount(result.total)} {result.total === 1 ? 'match' : 'matches'}
        </strong>
        {shown < result.total && <span class="muted"> (showing {formatCount(shown)})</span>}
        <span class="muted"> · {result.ms} ms</span>
        <span class="spacer" />
        <button type="button" class="btn small" onClick={onCopyResults} disabled={!result.total} title="Copy matched values as a JSON array">
          Copy results
        </button>
        <button type="button" class="btn small icon" onClick={onClose} title="Hide results (Esc clears the query)">
          ×
        </button>
      </div>
      {shown === 0 ? (
        <div class="results-empty muted">{result.error ? 'Query error' : 'No matches'}</div>
      ) : (
        <VirtualList
          className="results-list"
          count={shown}
          rowHeight={ITEM_HEIGHT}
          scrollTo={scrollTo}
          role="listbox"
          ariaLabel="Matches"
          renderRow={(i) => {
            const r = result.results[i];
            return (
              <div
                key={i}
                class={'result' + (i === current ? ' current' : '')}
                style={{ height: `${ITEM_HEIGHT}px` }}
                role="option"
                aria-selected={i === current}
                onClick={() => onPick(i)}
                title={r.path}
              >
                <div class="result-path">
                  {r.line !== undefined && <span class="line-no">L{r.line}</span>}
                  {r.path}
                </div>
                <div class={'result-val t-' + r.type}>{r.preview}</div>
              </div>
            );
          }}
        />
      )}
    </aside>
  );
}
