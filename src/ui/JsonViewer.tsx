import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { LoadError, LoadInfo, QueryResult, Row } from '../core/types';
import { WorkerClient } from '../worker/client';
import { copyText, downloadText, formatBytes, formatCount } from './clipboard';
import type { QueryHistory } from './history';
import { isPathQuery, QueryBar, type SearchToggles } from './QueryBar';
import { ResultsPane } from './ResultsPane';
import { applyTheme, isDark, saveSettings, settings, type ThemePref } from './settings';
import { TextView } from './TextView';
import { Tree } from './Tree';
import type { ScrollRequest } from './VirtualList';

export interface ViewerSource {
  input: ArrayBuffer | string;
  contentType?: string | null;
  /** Base name for downloads. */
  name?: string;
}

interface Props {
  source: ViewerSource | null;
  history: QueryHistory;
  /** Extra toolbar buttons supplied by the host page. */
  actions?: ComponentChildren;
  /** Called once a document is loaded (or fails). */
  onLoaded?: (info: LoadInfo | null, error: LoadError | null) => void;
}

type Phase = { kind: 'empty' } | { kind: 'loading'; bytes: number } | { kind: 'ready'; info: LoadInfo } | { kind: 'error'; error: LoadError; text: string };

const DEBOUNCE_MS = 250;
const HISTORY_IDLE_MS = 1500;

/** The shared viewer: query bar, virtual tree, results pane, text view. */
export function JsonViewer({ source, history, actions, onLoaded }: Props) {
  const clientRef = useRef<WorkerClient | null>(null);
  if (!clientRef.current) clientRef.current = new WorkerClient();
  const client = clientRef.current;
  useEffect(() => () => client.terminate(), [client]);

  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  const [visibleCount, setVisibleCount] = useState(0);
  const [version, setVersion] = useState(0);
  const bump = useCallback((n?: number) => {
    if (n !== undefined) setVisibleCount(n);
    setVersion((v) => v + 1);
  }, []);

  const [query, setQuery] = useState('');
  const [toggles, setToggles] = useState<SearchToggles>({ regex: false, caseSensitive: false, scope: 'both' });
  const [result, setResult] = useState<QueryResult | null>(null);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(true);

  const [selectedId, setSelectedId] = useState(-1);
  const [selectedPath, setSelectedPath] = useState('');
  const [treeScroll, setTreeScroll] = useState<ScrollRequest | null>(null);
  const [resultsScroll, setResultsScroll] = useState<ScrollRequest | null>(null);
  const nonce = useRef(0);

  const [view, setView] = useState<'tree' | 'text'>('tree');
  const [textKind, setTextKind] = useState<'pretty' | 'original'>('pretty');
  const [text, setText] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const theme = settings.value.theme;
  useEffect(() => applyTheme(theme), [theme]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 1600);
  }, []);

  // ---- Loading -------------------------------------------------------------
  useEffect(() => {
    if (!source) {
      setPhase({ kind: 'empty' });
      return;
    }
    let cancelled = false;
    const bytes = typeof source.input === 'string' ? source.input.length : source.input.byteLength;
    setPhase({ kind: 'loading', bytes });
    setResult(null);
    setQuery('');
    setSelectedId(-1);
    setSelectedPath('');
    setText(null);
    setView('tree');
    client
      .call('load', source.input, source.contentType ?? null)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setPhase({ kind: 'ready', info: r.info });
          bump(r.visibleCount);
          onLoaded?.(r.info, null);
        } else {
          setPhase({ kind: 'error', error: r.error, text: r.text });
          onLoaded?.(null, r.error);
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        const error = { message: e.message, line: 0, column: 0, offset: 0 };
        setPhase({ kind: 'error', error, text: '' });
        onLoaded?.(null, error);
      });
    return () => {
      cancelled = true;
    };
  }, [source, client, bump]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Querying ------------------------------------------------------------
  const runSeq = useRef(0);
  const lastRun = useRef<{ q: string; key: string } | null>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = phase.kind === 'ready';

  const optionsKey = (q: string) => (isPathQuery(q) ? 'path' : `${toggles.regex}|${toggles.caseSensitive}|${toggles.scope}`);

  const recordHistory = useCallback(
    (q: string, r: QueryResult) => {
      if (!q.trim() || r.error || r.mode === 'none') return;
      history.add(q, r.mode, r.total);
    },
    [history],
  );

  const run = useCallback(
    async (q: string, opts: { addHistory: boolean; t?: SearchToggles }) => {
      if (!ready) return;
      const tg = opts.t ?? toggles;
      const seq = ++runSeq.current;
      if (historyTimer.current) clearTimeout(historyTimer.current);
      if (!q.trim()) {
        lastRun.current = null;
        setResult(null);
        const n = await client.call('clearQuery');
        bump(n);
        return;
      }
      setBusy(true);
      try {
        const r = await client.call('query', q, {
          mode: 'auto',
          regex: tg.regex,
          caseSensitive: tg.caseSensitive,
          scope: tg.scope,
          limit: settings.value.maxResults,
        });
        if (seq !== runSeq.current) return;
        lastRun.current = { q, key: isPathQuery(q) ? 'path' : `${tg.regex}|${tg.caseSensitive}|${tg.scope}` };
        setResult(r);
        setResultsOpen(true);
        setCurrent(0);
        bump(r.visibleCount);
        if (r.total > 0) {
          const first = r.results[0];
          setSelectedId(first.id);
          setSelectedPath(first.path);
          setTreeScroll({ index: r.firstIndex, nonce: ++nonce.current, align: 'center' });
          setResultsScroll({ index: 0, nonce: ++nonce.current, align: 'start' });
        }
        if (opts.addHistory) recordHistory(q, r);
        else historyTimer.current = setTimeout(() => recordHistory(q, r), HISTORY_IDLE_MS);
      } finally {
        if (seq === runSeq.current) setBusy(false);
      }
    },
    [ready, toggles, client, bump, recordHistory],
  );

  // Debounced run while typing.
  useEffect(() => {
    if (!ready) return;
    const h = setTimeout(() => {
      if (lastRun.current?.q === query && lastRun.current.key === optionsKey(query)) return;
      run(query, { addHistory: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query, toggles, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = useCallback(
    async (k: number) => {
      if (!result || !result.results.length) return;
      const n = result.results.length;
      const idx = ((k % n) + n) % n;
      const item = result.results[idx];
      setCurrent(idx);
      setSelectedId(item.id);
      setSelectedPath(item.path);
      setResultsScroll({ index: idx, nonce: ++nonce.current });
      const { row, visibleCount: vc } = await client.call('reveal', item.id);
      if (vc !== visibleCount) bump(vc);
      setTreeScroll({ index: row, nonce: ++nonce.current, align: 'auto' });
      if (view !== 'tree') setView('tree');
    },
    [result, client, visibleCount, bump, view],
  );

  const submit = () => {
    const same = lastRun.current?.q === query && lastRun.current.key === optionsKey(query);
    if (same && result && result.total) {
      recordHistory(query, result);
      if (historyTimer.current) clearTimeout(historyTimer.current);
      goTo(current + 1);
    } else {
      run(query, { addHistory: true });
    }
  };

  const clearQuery = () => {
    setQuery('');
    run('', { addHistory: false });
  };

  const pickHistory = (q: string, mode: string) => {
    let t = toggles;
    if (mode === 'regex' && !t.regex) t = { ...t, regex: true };
    if (mode === 'text' && t.regex) t = { ...t, regex: false };
    setToggles(t);
    setQuery(q);
    run(q, { addHistory: true, t });
    inputRef.current?.focus();
  };

  // ---- Tree actions --------------------------------------------------------
  const onToggle = useCallback(
    async (row: Row, recursive: boolean) => {
      const n = recursive ? await client.call('setExpanded', row.id, !row.expanded, true) : await client.call('toggle', row.id);
      bump(n);
    },
    [client, bump],
  );

  const onSelect = useCallback(
    (row: Row) => {
      setSelectedId(row.id);
      client.call('path', row.id).then(setSelectedPath);
    },
    [client],
  );

  const copyPath = useCallback(
    async (id: number) => {
      const p = await client.call('path', id);
      flash((await copyText(p)) ? `Copied ${p.length > 60 ? p.slice(0, 60) + '…' : p}` : 'Copy failed');
    },
    [client, flash],
  );

  const copyValue = useCallback(
    async (id: number) => {
      const v = await client.call('valueText', id, true);
      flash((await copyText(v)) ? `Copied value (${formatBytes(v.length)})` : 'Copy failed');
    },
    [client, flash],
  );

  // ---- Text view ------------------------------------------------------------
  useEffect(() => {
    if (view !== 'text' || !ready) return;
    let cancelled = false;
    setText(null);
    client.call('text', textKind).then((t) => !cancelled && setText(t));
    return () => {
      cancelled = true;
    };
  }, [view, textKind, ready, client]);

  const baseName = source?.name?.replace(/[^\w.-]+/g, '_') || 'response';
  const info = phase.kind === 'ready' ? phase.info : null;

  const download = async () => {
    const kind = info?.kind === 'ndjson' ? 'original' : 'pretty';
    const t = await client.call('text', kind);
    const ext = info?.kind === 'ndjson' ? '.ndjson' : '.json';
    downloadText(t, baseName.endsWith(ext) ? baseName : baseName + ext, info?.kind === 'ndjson' ? 'application/x-ndjson' : 'application/json');
  };

  const copyAll = async () => {
    const t = await client.call('text', 'pretty');
    flash((await copyText(t)) ? `Copied document (${formatBytes(t.length)})` : 'Copy failed');
  };

  const copyResults = async () => {
    const t = await client.call('resultsText');
    flash((await copyText(t)) ? `Copied ${formatCount(result?.total ?? 0)} values` : 'Copy failed');
  };

  const cycleTheme = () => {
    const order: ThemePref[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    saveSettings({ theme: next });
  };

  // Global shortcuts: "/" focuses the query bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Render ----------------------------------------------------------------
  const showResults = ready && result && result.mode !== 'none' && resultsOpen;

  return (
    <div class="jpl" data-testid="viewer">
      <header class="toolbar">
        <QueryBar
          value={query}
          onInput={setQuery}
          onSubmit={submit}
          onNext={() => goTo(current + 1)}
          onPrev={() => goTo(current - 1)}
          onClear={clearQuery}
          toggles={toggles}
          onToggles={setToggles}
          result={result}
          current={current}
          busy={busy}
          history={history}
          onPickHistory={pickHistory}
          inputRef={inputRef}
        />
        <div class="actions">
          <div class="segmented" role="group" aria-label="View">
            <button type="button" class={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')} disabled={!ready}>
              Tree
            </button>
            <button type="button" class={view === 'text' ? 'on' : ''} onClick={() => setView('text')} disabled={!ready} data-testid="text-view-button">
              Text
            </button>
          </div>
          {view === 'tree' ? (
            <>
              <button type="button" class="btn" disabled={!ready} onClick={async () => bump(await client.call('expandAll'))} title="Expand all">
                Expand all
              </button>
              <button type="button" class="btn" disabled={!ready} onClick={async () => bump(await client.call('collapseAll'))} title="Collapse all">
                Collapse
              </button>
            </>
          ) : (
            <div class="segmented" role="group" aria-label="Text kind">
              <button type="button" class={textKind === 'pretty' ? 'on' : ''} onClick={() => setTextKind('pretty')}>
                Pretty
              </button>
              <button type="button" class={textKind === 'original' ? 'on' : ''} onClick={() => setTextKind('original')}>
                As received
              </button>
            </div>
          )}
          <button type="button" class="btn" disabled={!ready} onClick={copyAll} title="Copy the formatted document">
            Copy
          </button>
          <button type="button" class="btn" disabled={!ready} onClick={download} title="Download">
            Download
          </button>
          <button type="button" class="btn" onClick={cycleTheme} title={`Theme: ${theme} (click to change)`} data-testid="theme-button">
            {theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'}
          </button>
          {actions}
        </div>
      </header>

      {result?.error && (
        <div class="hint error" role="alert" data-testid="query-error">
          {result.error.message}
          {result.error.position !== undefined && (
            <pre class="caret-line">
              {query}
              {'\n' + ' '.repeat(result.error.position) + '^'}
            </pre>
          )}
        </div>
      )}
      {!result?.error && result?.rewritten && (
        <div class="hint">
          Runs as <code>{result.rewritten}</code> (<code>=~</code> is a JSONPath Lens extension)
        </div>
      )}

      <main class="body">
        {phase.kind === 'empty' && <div class="center muted">No document loaded.</div>}
        {phase.kind === 'loading' && (
          <div class="center">
            <div class="spinner" aria-hidden="true" /> Parsing {formatBytes(phase.bytes)}…
          </div>
        )}
        {phase.kind === 'error' && <ParseError error={phase.error} text={phase.text} />}
        {ready && view === 'tree' && (
          <Tree
            client={client}
            visibleCount={visibleCount}
            version={version}
            selectedId={selectedId}
            currentMatchId={result?.results[current]?.id ?? -1}
            scrollTo={treeScroll}
            onSelect={onSelect}
            onToggle={onToggle}
            onCopyPath={copyPath}
            onCopyValue={copyValue}
          />
        )}
        {ready && view === 'text' &&
          (text === null ? <div class="center muted">Formatting…</div> : <TextView text={text} dark={isDark(theme)} />)}
        {showResults && result && (
          <ResultsPane
            result={result}
            current={current}
            scrollTo={resultsScroll}
            onPick={goTo}
            onCopyResults={copyResults}
            onClose={() => setResultsOpen(false)}
          />
        )}
      </main>

      <footer class="status">
        {selectedPath ? (
          <button type="button" class="path-btn" title="Copy path" onClick={() => copyText(selectedPath).then(() => flash('Copied path'))} data-testid="selected-path">
            {selectedPath}
          </button>
        ) : (
          <span class="muted">Click a node to see its JSONPath · press / to search</span>
        )}
        <span class="spacer" />
        {toast && <span class="toast" role="status">{toast}</span>}
        {info && (
          <span class="muted" data-testid="doc-info">
            {info.kind === 'ndjson'
              ? `NDJSON · ${formatCount(info.rootSize)} lines${info.badLines ? ` (${info.badLines} bad)` : ''}`
              : 'JSON'}
            {' · '}
            {formatCount(info.nodeCount)} nodes · {formatBytes(info.bytes)} · {info.parseMs + info.indexMs} ms
            {info.bigInts ? ' · big integers kept exact' : ''}
          </span>
        )}
      </footer>
    </div>
  );
}

function ParseError({ error, text }: { error: LoadError; text: string }) {
  const lines = text.split('\n');
  const from = Math.max(0, error.line - 3);
  const to = Math.min(lines.length, error.line + 2);
  return (
    <div class="parse-error" role="alert" data-testid="parse-error">
      <h2>Not valid JSON</h2>
      <p>
        {error.message}
        {error.line > 0 && (
          <>
            {' '}
            — line {error.line}, column {error.column}
          </>
        )}
      </p>
      {text && (
        <pre class="snippet">
          {lines.slice(from, to).map((l, i) => {
            const n = from + i + 1;
            const long = l.length > 300;
            const start = long ? Math.max(0, (n === error.line ? error.column : 0) - 120) : 0;
            const shown = long ? l.slice(start, start + 240) : l;
            return (
              <div key={n} class={n === error.line ? 'err-line' : ''}>
                <span class="gutter">{n}</span>
                {shown}
                {n === error.line && (
                  <div class="caret-mark">
                    <span class="gutter" />
                    {' '.repeat(Math.max(0, error.column - 1 - start))}^
                  </div>
                )}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
