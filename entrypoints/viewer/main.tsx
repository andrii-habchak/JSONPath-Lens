import { useEffect, useMemo, useState } from 'preact/hooks';
import { nameFromUrl } from '../../src/shared/names';
import { MSG_LOAD, MSG_READY, MSG_SHOW_ORIGINAL, RAW_HASH, type LoadMessage, type Stashed, type UnstashMessage } from '../../src/shared/messages';
import { QueryHistory } from '../../src/ui/history';
import { JsonViewer, type ViewerSource } from '../../src/ui/JsonViewer';
import { mount } from '../../src/ui/mount';

/**
 * Viewer page. Normally embedded by the content script in a tab that shows a
 * JSON URL; receives the text via postMessage. With `?src=<url>` it fetches the
 * URL itself (fallback when embedding is not possible).
 */
function ViewerPage() {
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [error, setError] = useState('');
  // One history per tab; a reload creates a fresh page and an empty history.
  const history = useMemo(() => new QueryHistory(), []);
  const embedded = window.parent !== window;

  const params = new URLSearchParams(location.search);
  const src = params.get('src');

  useEffect(() => {
    if (src) {
      document.title = `${nameFromUrl(src)} — JSONPath Lens`;
      const token = params.get('stash');
      const viaStash: Promise<Stashed | null> = token
        ? chrome.runtime.sendMessage({ type: 'jpl-unstash', token } satisfies UnstashMessage)
        : Promise.resolve(null);
      viaStash
        .then(async (item) => {
          if (item) {
            setSource({ input: item.text, contentType: item.contentType, name: nameFromUrl(src) });
            return;
          }
          // Re-fetch (stash expired, too large, or opened directly with ?src=).
          const r = await fetch(src, { credentials: 'include' });
          setSource({ input: await r.text(), contentType: r.headers.get('content-type'), name: nameFromUrl(src) });
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
