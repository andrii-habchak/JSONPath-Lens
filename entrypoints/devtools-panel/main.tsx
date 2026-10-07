import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { idbSet, type StoredDoc } from '../../src/shared/idb';
import type { OpenWorkspaceMessage } from '../../src/shared/messages';
import { nameFromUrl } from '../../src/shared/names';
import { formatBytes } from '../../src/ui/clipboard';
import { QueryHistory } from '../../src/ui/history';
import { JsonViewer, type ViewerSource } from '../../src/ui/JsonViewer';
import { mount } from '../../src/ui/mount';

type HarEntry = chrome.devtools.network.Request & { _resourceType?: string };

interface Captured {
  id: number;
  entry: HarEntry;
  method: string;
  url: string;
  status: number;
  mimeType: string;
  size: number;
  time: number;
  resourceType: string;
}

const MAX_ENTRIES = 2000;
const JSON_MIME = /json|ndjson|jsonl|x-json-stream/i;

let seq = 0;

function toCaptured(entry: HarEntry): Captured {
  const res = entry.response;
  return {
    id: ++seq,
    entry,
    method: entry.request.method,
    url: entry.request.url,
    status: res.status,
    mimeType: res.content?.mimeType ?? '',
    size: res.content?.size ?? res.bodySize ?? 0,
    time: Math.round(entry.time ?? 0),
    resourceType: entry._resourceType ?? '',
  };
}

function getBody(entry: HarEntry): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof entry.getContent !== 'function') {
      reject(new Error('Body not available for this entry. Reload the page with this panel open.'));
      return;
    }
    entry.getContent((content, encoding) => {
      if (content == null) {
        reject(new Error('DevTools did not keep this response body (it may be too large). Use "Re-fetch" for GET requests.'));
        return;
      }
      if (encoding === 'base64') {
        const bin = atob(content);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new TextDecoder().decode(bytes));
      } else resolve(content);
    });
  });
}

function Panel() {
  const [items, setItems] = useState<Captured[]>([]);
  const [selected, setSelected] = useState<Captured | null>(null);
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [bodyError, setBodyError] = useState('');
  const [filter, setFilter] = useState('');
  const [onlyJson, setOnlyJson] = useState(true);
  const [preserve, setPreserve] = useState(false);
  const preserveRef = useRef(preserve);
  preserveRef.current = preserve;
  // One query history per captured request; gone when DevTools closes.
  const histories = useRef(new Map<number, QueryHistory>());

  useEffect(() => {
    const add = (entries: HarEntry[]) =>
      setItems((prev) => {
        const next = prev.concat(entries.map(toCaptured));
        return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
      });
    chrome.devtools.network.getHAR((log) => add((log?.entries ?? []) as HarEntry[]));
    const onFinished = (req: chrome.devtools.network.Request) => add([req as HarEntry]);
    const onNavigated = () => {
      if (!preserveRef.current) {
        setItems([]);
        setSelected(null);
        setSource(null);
      }
    };
    chrome.devtools.network.onRequestFinished.addListener(onFinished);
    chrome.devtools.network.onNavigated.addListener(onNavigated);
    return () => {
      chrome.devtools.network.onRequestFinished.removeListener(onFinished);
      chrome.devtools.network.onNavigated.removeListener(onNavigated);
    };
  }, []);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return items.filter((it) => {
      if (onlyJson && !JSON_MIME.test(it.mimeType)) return false;
      if (!onlyJson && !['xhr', 'fetch', 'document'].includes(it.resourceType) && !JSON_MIME.test(it.mimeType)) return false;
      return !f || it.url.toLowerCase().includes(f);
    });
  }, [items, filter, onlyJson]);

  // Late bodies for a request the user already left are dropped.
  const currentId = useRef(-1);

  const pick = async (it: Captured) => {
    currentId.current = it.id;
    setSelected(it);
    setBodyError('');
    setSource(null);
    try {
      const text = await getBody(it.entry);
      if (currentId.current !== it.id) return;
      setSource({ input: text, contentType: it.mimeType, name: nameFromUrl(it.url) });
    } catch (e) {
      if (currentId.current === it.id) setBodyError((e as Error).message);
    }
  };

  const refetch = async (it: Captured) => {
    setBodyError('');
    try {
      const res = await fetch(it.url, { credentials: 'include' });
      const text = await res.text();
      if (currentId.current !== it.id) return;
      setSource({ input: text, contentType: res.headers.get('content-type'), name: nameFromUrl(it.url) });
    } catch (e) {
      if (currentId.current === it.id) setBodyError(`Re-fetch failed: ${(e as Error).message}`);
    }
  };

  const openInTab = async () => {
    if (!selected || !source) return;
    const text = typeof source.input === 'string' ? source.input : new TextDecoder().decode(source.input);
    const key = `handoff:${crypto.randomUUID()}`;
    const doc: StoredDoc = { text, contentType: source.contentType, name: source.name, savedAt: Date.now() };
    await idbSet(key, doc);
    const msg: OpenWorkspaceMessage = { type: 'jpl-open-workspace', handoff: key };
    chrome.runtime.sendMessage(msg);
  };

  let history = selected ? histories.current.get(selected.id) : undefined;
  if (selected && !history) {
    history = new QueryHistory();
    histories.current.set(selected.id, history);
  }

  return (
    <div class="panel">
      <div class="panel-list">
        <div class="panel-tools">
          <input
            class="panel-filter"
            placeholder="Filter URLs"
            value={filter}
            onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="btn small"
            title="Clear the list"
            onClick={() => {
              currentId.current = -1;
              setItems([]);
              setSelected(null);
              setSource(null);
              histories.current.clear();
            }}
          >
            Clear
          </button>
        </div>
        <div class="panel-tools small">
          <label class="check">
            <input type="checkbox" checked={onlyJson} onChange={(e) => setOnlyJson((e.currentTarget as HTMLInputElement).checked)} /> JSON
            only
          </label>
          <label class="check" title="Keep requests when the page navigates">
            <input type="checkbox" checked={preserve} onChange={(e) => setPreserve((e.currentTarget as HTMLInputElement).checked)} />{' '}
            Preserve log
          </label>
          <span class="muted">{visible.length}</span>
        </div>
        <div class="panel-items" role="listbox" aria-label="Captured requests">
          {visible.length === 0 && (
            <div class="muted pad small">
              No {onlyJson ? 'JSON ' : ''}responses yet. Requests are captured while DevTools is open; reload the page to capture its
              startup requests.
            </div>
          )}
          {visible.map((it) => (
            <div
              key={it.id}
              class={'req-item' + (selected?.id === it.id ? ' on' : '')}
              role="option"
              aria-selected={selected?.id === it.id}
              onClick={() => pick(it)}
              title={it.url}
            >
              <span class={'req-status s' + String(it.status)[0]}>{it.status || '—'}</span>
              <span class="req-method">{it.method}</span>
              <span class="req-name">{nameFromUrl(it.url)}</span>
              <span class="req-size muted">{it.size > 0 ? formatBytes(it.size) : ''}</span>
            </div>
          ))}
        </div>
      </div>
      <div class="panel-main">
        {selected ? (
          <>
            <details class="req-strip">
              <summary>
                <code>
                  {selected.method} {selected.url}
                </code>{' '}
                → <strong>{selected.status}</strong>
                <span class="muted">
                  {' '}
                  · {selected.mimeType || 'no content-type'} · {selected.time} ms
                </span>
              </summary>
              <div class="req-grid">
                <div>
                  <strong>Request headers</strong>
                  <pre>{selected.entry.request.headers.map((h) => `${h.name}: ${h.value}\n`)}</pre>
                </div>
                <div>
                  <strong>Response headers</strong>
                  <pre>{selected.entry.response.headers.map((h) => `${h.name}: ${h.value}\n`)}</pre>
                </div>
              </div>
            </details>
            {bodyError ? (
              <div class="pad">
                <p class="err">{bodyError}</p>
                {selected.method === 'GET' && (
                  <button type="button" class="btn" onClick={() => refetch(selected)}>
                    Re-fetch GET {nameFromUrl(selected.url)}
                  </button>
                )}
              </div>
            ) : (
              <JsonViewer
                key={selected.id}
                source={source}
                history={history!}
                actions={
                  <button type="button" class="btn" disabled={!source} onClick={openInTab} title="Open this response in the workspace tab">
                    Open in tab
                  </button>
                }
              />
            )}
          </>
        ) : (
          <div class="center muted">Select a request to view its JSON.</div>
        )}
      </div>
    </div>
  );
}

mount(() => <Panel />);
