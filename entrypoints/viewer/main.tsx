import { useEffect, useMemo, useState } from 'preact/hooks';
import { nameFromUrl } from '../../src/shared/names';
import {
  MSG_LOAD,
  MSG_READY,
  MSG_SHOW_ORIGINAL,
  RAW_HASH,
  type LoadMessage,
  type Stashed,
  type UnstashMessage,
} from '../../src/shared/messages';
import { QueryHistory } from '../../src/ui/history';
import { JsonViewer, type ViewerSource } from '../../src/ui/JsonViewer';
import { mount } from '../../src/ui/mount';

/**
 * Viewer page. Normally embedded by the content script in a tab that shows a
 * JSON URL; receives the text via postMessage. For CSP-sandboxed responses the
 * background opens it top-level with `?stash=<token>` and hands the text over.
 */
function ViewerPage() {
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [error, setError] = useState('');
  // One history per tab; a reload creates a fresh page and an empty history.
  const history = useMemo(() => new QueryHistory(), []);
  const embedded = window.parent !== window;

  const token = new URLSearchParams(location.search).get('stash');
  // Set once the stashed document arrives; used by the "Original" button.
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      if (embedded) {
        setError('This page cannot be embedded.');
        return;
      }
      const ask: UnstashMessage = { type: 'jpl-unstash', token };
      (chrome.runtime.sendMessage(ask) as Promise<Stashed | null>)
        .then(async (item) => {
          if (!item) {
            setError('This view has expired. Reload the original page to view it again.');
            return;
          }
          setSrc(item.url);
          document.title = `${nameFromUrl(item.url)} — JSONPath Lens`;
          if (item.text !== undefined) {
            setSource({ input: item.text, contentType: item.contentType, name: nameFromUrl(item.url) });
            return;
          }
          // Too large to hand over: re-fetch the URL the background vouched for.
          const r = await fetch(item.url, { credentials: 'include' });
          setSource({ input: await r.text(), contentType: r.headers.get('content-type'), name: nameFromUrl(item.url) });
        })
        .catch((e: Error) => setError(e.message));
      return;
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const data = e.data as LoadMessage;
      if (data?.type !== MSG_LOAD || !(data.buffer instanceof ArrayBuffer)) return;
      setSource({ input: data.buffer, contentType: data.contentType, name: nameFromUrl(data.url) });
    };
    window.addEventListener('message', onMessage);
    if (embedded) window.parent.postMessage({ type: MSG_READY }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [embedded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div class="center">Could not load: {error}</div>;
  return (
    <JsonViewer
      source={source}
      history={history}
      actions={
        embedded || src ? (
          <button
            type="button"
            class="btn"
            title="Show the browser's original rendering"
            onClick={() => {
              if (embedded) window.parent.postMessage({ type: MSG_SHOW_ORIGINAL }, '*');
              else if (src) location.href = src.replace(/#.*$/, '') + '#' + RAW_HASH;
            }}
          >
            Original
          </button>
        ) : null
      }
    />
  );
}

mount(() => <ViewerPage />);
