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

type Phase =
  | { kind: 'empty' }
  | { kind: 'loading'; bytes: number }
  | { kind: 'ready'; info: LoadInfo }
  | { kind: 'error'; error: LoadError; text: string };

const DEBOUNCE_MS = 250;
const HISTORY_IDLE_MS = 1500;

/** The shared viewer: query bar, virtual tree, results pane, text view. */
export function JsonViewer({ source, history, actions, onLoaded }: Props) {
  // The worker owns the document. "Stop" replaces it with a fresh one and reloads.
  const [client, setClient] = useState(() => new WorkerClient());
  useEffect(() => () => client.terminate(), [client]);
  /** Copy of the input kept for reloading after "Stop" (an ArrayBuffer is transferred away). */
  const retained = useRef<{ source: ViewerSource; input: string | ArrayBuffer } | null>(null);
  const stoppedNote = useRef(false);
  const hadDocument = useRef(false);

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
  const [slow, setSlow] = useState(false);
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

  const flash = useCallback((msg: string, ms = 1600) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), ms);
  }, []);

  // ---- Loading -------------------------------------------------------------
  useEffect(() => {
    if (!source) {
      setPhase({ kind: 'empty' });
      return;
    }
    let cancelled = false;
    let input: string | ArrayBuffer;
    if (retained.current?.source === source) {
      // Reload after "Stop": hand the worker a fresh copy.
      const kept = retained.current.input;
      input = typeof kept === 'string' ? kept : kept.slice(0);
    } else {
      input = source.input;
      retained.current = { source, input: typeof input === 'string' ? input : input.slice(0) };
    }
    const bytes = typeof input === 'string' ? input.length : input.byteLength;
    setPhase({ kind: 'loading', bytes });
    setResult(null);
    // A query typed while the first document was still loading is kept and runs
    // once it is ready; replacing a document starts with an empty query.
    if (hadDocument.current) setQuery('');
    hadDocument.current = true;
    lastRun.current = null;
    setSelectedId(-1);
    setSelectedPath('');
    setText(null);
    setView('tree');
    client
      .call('load', input, source.contentType ?? null)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setPhase({ kind: 'ready', info: r.info });
          bump(r.visibleCount);
          onLoaded?.(r.info, null);
          if (stoppedNote.current) {
            stoppedNote.current = false;
            flash('Query stopped; document reloaded', 3000);
          }
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
  /** The query last sent to the worker (set when sent, so the debounce never re-sends it). */
  const lastRun = useRef<{ q: string; key: string; done: boolean; recordOnFinish: boolean } | null>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A query submitted with Enter before the document finished loading. */
  const submittedEarly = useRef<string | null>(null);
  /** A query picked with ↑/↓ that must not be recorded (browsing would reorder the list). */
  const browsing = useRef<string | null>(null);
  const ready = phase.kind === 'ready';

  const keyOf = (q: string, t: SearchToggles) => (isPathQuery(q) ? 'path' : `${t.regex}|${t.caseSensitive}|${t.scope}`);

  const recordHistory = useCallback(
    (q: string, r: QueryResult) => {
      if (!q.trim() || r.error || r.mode === 'none') return;
      history.add(q.trim(), r.mode, r.total);
    },
    [history],
  );

  const run = useCallback(
    async (q: string, opts: { record: 'now' | 'idle' | 'never'; t?: SearchToggles }) => {
      if (!ready) return;
      const tg = opts.t ?? toggles;
      const seq = ++runSeq.current;
      if (historyTimer.current) clearTimeout(historyTimer.current);
      if (!q.trim()) {
        lastRun.current = null;
        setResult(null);
        setBusy(false);
        setSlow(false);
        try {
          bump(await client.call('clearQuery'));
        } catch {
          // worker replaced
        }
        return;
      }
      const sent = { q, key: keyOf(q, tg), done: false, recordOnFinish: opts.record === 'now' };
      lastRun.current = sent;
      setBusy(true);
      setSlow(false);
      const slowTimer = setTimeout(() => seq === runSeq.current && setSlow(true), 1500);
      try {
        const r = await client.call('query', q, {
          mode: 'auto',
          regex: tg.regex,
          caseSensitive: tg.caseSensitive,
          scope: tg.scope,
          limit: settings.value.maxResults,
        });
        if (seq !== runSeq.current) return;
        sent.done = true;
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
        if (sent.recordOnFinish) recordHistory(q, r);
        else if (opts.record === 'idle') historyTimer.current = setTimeout(() => recordHistory(q, r), HISTORY_IDLE_MS);
      } catch {
        // The worker was stopped or failed; the load effect reports it.
      } finally {
        clearTimeout(slowTimer);
        if (seq === runSeq.current) {
          setBusy(false);
          setSlow(false);
        }
      }
    },
    [ready, toggles, client, bump, recordHistory],
  );

  // Debounced run while typing.
  useEffect(() => {
    if (!ready) return;
    const h = setTimeout(() => {
      const last = lastRun.current;
      if (last && last.q === query && last.key === keyOf(query, toggles)) return;
      if (!query.trim() && !last) return; // nothing to clear
      let record: 'now' | 'idle' | 'never' = browsing.current === query ? 'never' : 'idle';
      if (submittedEarly.current === query) record = 'now'; // Enter was pressed while loading
      submittedEarly.current = null;
      run(query, { record });
    }, DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query, toggles, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => {
    runSeq.current++;
    stoppedNote.current = true;
    setBusy(false);
    setSlow(false);
    client.terminate();
    setClient(new WorkerClient());
  };

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
    browsing.current = null;
    if (!ready) {
      // Still loading: the debounced run records it once the document is ready.
      submittedEarly.current = query;
      return;
    }
    const last = lastRun.current;
    const same = last && last.q === query && last.key === keyOf(query, toggles);
    if (same && !last.done) {
      last.recordOnFinish = true; // still running: record it when it lands
    } else if (same && result) {
      recordHistory(query, result);
      if (historyTimer.current) clearTimeout(historyTimer.current);
      if (result.total) goTo(current + 1);
    } else {
      run(query, { record: 'now' });
    }
  };

  const clearQuery = () => {
    browsing.current = null;
    setQuery('');
    run('', { record: 'never' });
  };

  /** Apply a history entry. A click records it again; ↑/↓ browsing does not. */
  const pickHistory = (q: string, mode: string, viaKeys = false) => {
    let t = toggles;
    if (mode === 'regex' && !t.regex) t = { ...t, regex: true };
    if (mode === 'text' && t.regex) t = { ...t, regex: false };
    setToggles(t);
    setQuery(q);
    if (viaKeys) {
      browsing.current = q; // the debounced effect runs it without recording
    } else {
      browsing.current = null;
      run(q, { record: 'now', t });
      inputRef.current?.focus();
    }
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
    downloadText(
      t,
      baseName.endsWith(ext) ? baseName : baseName + ext,
      info?.kind === 'ndjson' ? 'application/x-ndjson' : 'application/json',
    );
  };

  const copyAll = async () => {
    const t = await client.call('text', 'pretty');
    flash((await copyText(t)) ? `Copied document (${formatBytes(t.length)})` : 'Copy failed');
  };

  const copyResults = async () => {
    const r = await client.call('resultsText');
    const ok = await copyText(r.text);
    if (!ok) flash('Copy failed');
    else if (r.count < r.total) flash(`Copied first ${formatCount(r.count)} of ${formatCount(r.total)} values (size limit)`, 3000);
    else flash(`Copied ${formatCount(r.count)} values`);
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
            <button
              type="button"
              class={view === 'text' ? 'on' : ''}
              onClick={() => setView('text')}
              disabled={!ready}
              data-testid="text-view-button"
            >
              Text
            </button>
          </div>
          {view === 'tree' ? (
            <>
              <button
                type="button"
                class="btn"
                disabled={!ready}
                onClick={async () => bump(await client.call('expandAll'))}
                title="Expand all"
              >
                Expand all
              </button>
              <button
                type="button"
                class="btn"
                disabled={!ready}
                onClick={async () => bump(await client.call('collapseAll'))}
                title="Collapse all"
              >
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

      {busy && slow && (
        <div class="hint" role="status">
          Query is taking a while…{' '}
          <button type="button" class="btn small" onClick={stop} data-testid="stop-button">
            Stop
          </button>{' '}
          <span class="muted">(stopping reloads the document)</span>
        </div>
      )}
      {result?.error && (
        <div class="hint error" role="alert" data-testid="query-error">
          {result.error.message}
          {result.error.position !== undefined && (
            <pre class="caret-line">
              {query.trim()}
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
        {ready &&
          view === 'text' &&
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
          <button
            type="button"
            class="path-btn"
            title="Copy path"
            onClick={() => copyText(selectedPath).then(() => flash('Copied path'))}
            data-testid="selected-path"
          >
            {selectedPath}
          </button>
        ) : (
          <span class="muted">Click a node to see its JSONPath · press / to search</span>
        )}
        <span class="spacer" />
        {toast && (
          <span class="toast" role="status">
            {toast}
          </span>
        )}
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
