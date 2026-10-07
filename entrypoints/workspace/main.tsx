import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { idbDelete, idbGet, idbSet, type StoredDoc } from '../../src/shared/idb';
import { nameFromUrl } from '../../src/shared/names';
import { formatBytes } from '../../src/ui/clipboard';
import { QueryHistory } from '../../src/ui/history';
import { JsonViewer, type ViewerSource } from '../../src/ui/JsonViewer';
import { mount } from '../../src/ui/mount';
import { fetchJson, parseHeaderLines, type FetchOutcome } from '../../src/workspace/fetch';

/** Pastes larger than this skip the textarea and load straight into the viewer. */
const TEXTAREA_LIMIT = 2_000_000;
/** The last document is kept in IndexedDB when smaller than this. */
const RESTORE_LIMIT = 100 * 1024 * 1024;
const LAST_DOC_KEY = 'workspace:last';
let docSeq = 0;

interface Loaded {
  id: number;
  source: ViewerSource;
  /** A fresh history per document (cleared on reload). */
  history: QueryHistory;
  label: string;
}

function Workspace() {
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [panel, setPanel] = useState<'paste' | 'url' | null>('paste');
  const [dragging, setDragging] = useState(false);
  const [lastRequest, setLastRequest] = useState<FetchOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = (text: string, opts: { contentType?: string | null; name?: string; label: string; persist?: boolean }) => {
    setLoaded({
      id: ++docSeq,
      source: { input: text, contentType: opts.contentType ?? null, name: opts.name ?? 'pasted' },
      history: new QueryHistory(),
      label: opts.label,
    });
    setPanel(null);
    if (opts.persist !== false && text.length < RESTORE_LIMIT) {
      const doc: StoredDoc = { text, contentType: opts.contentType, name: opts.name, savedAt: Date.now() };
      idbSet(LAST_DOC_KEY, doc).catch(() => undefined);
    }
  };

  // Startup: a hand-off from DevTools, else restore the last document.
  useEffect(() => {
    const m = /handoff=([^&]+)/.exec(location.hash);
    if (m) {
      const key = decodeURIComponent(m[1]);
      idbGet<StoredDoc>(key).then((doc) => {
        if (!doc) return;
        idbDelete(key).catch(() => undefined);
        history.replaceState(null, '', location.pathname);
        load(doc.text, { contentType: doc.contentType, name: doc.name, label: doc.name ?? 'From DevTools' });
      });
      return;
    }
    idbGet<StoredDoc>(LAST_DOC_KEY)
      .then((doc) => {
        if (!doc) return;
        if (doc.text.length <= TEXTAREA_LIMIT) setInput(doc.text);
        load(doc.text, { contentType: doc.contentType, name: doc.name, label: `${doc.name ?? 'Last document'} (restored)`, persist: false });
      })
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = async (file: File) => {
    const text = await file.text();
    if (text.length <= TEXTAREA_LIMIT) setInput(text);
    else setInput('');
    load(text, { contentType: file.type || null, name: file.name, label: `${file.name} (${formatBytes(file.size)})` });
  };

  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (text.length > TEXTAREA_LIMIT) {
      e.preventDefault();
      setInput('');
      load(text, { label: `Pasted text (${formatBytes(text.length)})` });
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) openFile(file);
    else {
      const text = e.dataTransfer?.getData('text') ?? '';
      if (text) load(text, { label: 'Dropped text' });
    }
  };

  return (
    <div
      class={'workspace' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDragging(false);
      }}
      onDrop={drop}
    >
      <div class="ws-bar">
        <img src="/icon/32.png" alt="" width={20} height={20} />
        <strong>JSONPath Lens</strong>
        <span class="muted ws-label" data-testid="doc-label">
          {loaded ? loaded.label : 'Workspace'}
        </span>
        <span class="spacer" />
        <button type="button" class={'btn' + (panel === 'paste' ? ' on' : '')} onClick={() => setPanel(panel === 'paste' ? null : 'paste')} data-testid="paste-toggle">
          Paste / edit
        </button>
        <button type="button" class="btn" onClick={() => fileRef.current?.click()}>
          Open file…
        </button>
        <button type="button" class={'btn' + (panel === 'url' ? ' on' : '')} onClick={() => setPanel(panel === 'url' ? null : 'url')} data-testid="url-toggle">
          Load URL…
        </button>
        <a class="btn" href="/options.html" target="_blank" rel="noreferrer">
          Options
        </a>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.ndjson,.jsonl,.txt,application/json"
          hidden
          onChange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (f) openFile(f);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
      </div>

      {panel === 'paste' && (
        <div class="ws-panel">
          <textarea
            class="ws-input"
            data-testid="paste-input"
            spellcheck={false}
            wrap="off"
            placeholder="Paste JSON or NDJSON here, drop a file anywhere on the page, or use Open file… / Load URL…"
            value={input}
            onInput={(e) => setInput((e.currentTarget as HTMLTextAreaElement).value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (input.trim()) load(input, { label: 'Pasted text' });
              }
            }}
          />
          <div class="ws-panel-actions">
            <button type="button" class="btn primary" disabled={!input.trim()} onClick={() => load(input, { label: 'Pasted text' })} data-testid="format-button">
              Format
            </button>
            <button type="button" class="btn" disabled={!input} onClick={() => setInput('')}>
              Clear
            </button>
            <span class="muted small">Ctrl/⌘+Enter formats. The last document is restored when you reopen the workspace; query history is not.</span>
          </div>
        </div>
      )}

      {panel === 'url' && (
        <UrlPanel
          onLoaded={(out) => {
            setLastRequest(out);
            if (out.ok) load(out.text, { contentType: out.contentType, name: nameFromUrl(out.url), label: `GET ${out.url}` });
          }}
          last={lastRequest}
        />
      )}

      {lastRequest && panel !== 'url' && loaded?.label.startsWith('GET ') && <RequestStrip out={lastRequest} />}

      <div class="ws-viewer">
        {loaded ? (
          <JsonViewer key={loaded.id} source={loaded.source} history={loaded.history} />
        ) : (
          <div class="center muted ws-empty">Paste JSON above, drop a file, or load a URL.</div>
        )}
      </div>
      {dragging && <div class="drop-overlay">Drop a JSON / NDJSON file</div>}
    </div>
  );
}

function UrlPanel({ onLoaded, last }: { onLoaded: (o: FetchOutcome) => void; last: FetchOutcome | null }) {
  const [url, setUrl] = useState(last?.url ?? '');
  const [headers, setHeaders] = useState('Accept: application/json');
  const [cookies, setCookies] = useState(true);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseHeaderLines(headers), [headers]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      onLoaded(await fetchJson(url.trim(), parsed.headers, cookies));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="ws-panel url-panel" onSubmit={submit}>
      <div class="url-row">
        <span class="method">GET</span>
        <input
          class="url-input"
          type="url"
          required
          placeholder="https://api.example.com/v1/items?limit=100"
          value={url}
          data-testid="url-input"
          onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)}
        />
        <label class="check" title="Send this browser's cookies for the target site (credentials: 'include')">
          <input type="checkbox" checked={cookies} onChange={(e) => setCookies((e.currentTarget as HTMLInputElement).checked)} /> Send cookies
        </label>
        <button class="btn primary" type="submit" disabled={busy} data-testid="url-load">
          {busy ? 'Loading…' : 'Load'}
        </button>
      </div>
      <label class="field">
        <span class="muted small">
          Request headers, one <code>Name: value</code> per line (e.g. <code>Authorization: Bearer …</code>). Never saved.
        </span>
        <textarea class="headers-input" rows={3} spellcheck={false} value={headers} onInput={(e) => setHeaders((e.currentTarget as HTMLTextAreaElement).value)} data-testid="headers-input" />
      </label>
      {parsed.errors.length > 0 && <div class="hint error">Ignored lines: {parsed.errors.join(', ')}</div>}
      {last && <RequestStrip out={last} />}
    </form>
  );
}

function RequestStrip({ out }: { out: FetchOutcome }) {
  return (
    <details class={'req-strip' + (out.ok ? '' : ' failed')} data-testid="request-strip">
      <summary>
        <code>GET {out.url}</code> → {out.ok ? <strong>{out.status}</strong> : <strong class="err">{out.error}</strong>}
        {out.ok && (
          <span class="muted">
            {' '}
            · {out.contentType || 'no content-type'} · {formatBytes(out.text.length)} · {out.ms} ms
          </span>
        )}
      </summary>
      <div class="req-grid">
        <div>
          <strong>Request headers</strong>
          <pre>{Object.entries(out.requestHeaders).map(([k, v]) => `${k}: ${/authorization|cookie|token|key/i.test(k) ? '••••••' : v}\n`)}</pre>
          <span class="muted small">Cookies: {out.credentials === 'include' ? 'sent' : 'not sent'}</span>
        </div>
        {out.ok && (
          <div>
            <strong>Response headers</strong>
            <pre>{out.responseHeaders.map(([k, v]) => `${k}: ${v}\n`)}</pre>
          </div>
        )}
      </div>
    </details>
  );
}

mount(() => <Workspace />);
