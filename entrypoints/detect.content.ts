import { detectJson } from '../src/content/detect';
import { MSG_LOAD, MSG_READY, MSG_SHOW_ORIGINAL, RAW_HASH, type LoadMessage, type StashMessage } from '../src/shared/messages';
import { DEFAULT_SETTINGS, isBlocked, type Settings } from '../src/shared/settings';

/**
 * Runs on every page; does nothing unless the tab shows a raw JSON / NDJSON
 * response. Then it hides the browser's rendering and mounts the viewer in a
 * full-page extension iframe, handing the text over with postMessage.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  async main() {
    if (window.top !== window) return;
    if (location.hash.includes(RAW_HASH)) return;
    const found = detectJson(document);
    if (!found) return;

    let s: Settings = DEFAULT_SETTINGS;
    try {
      const v = await chrome.storage.local.get('settings');
      s = { ...DEFAULT_SETTINGS, ...((v.settings as Partial<Settings>) ?? {}) };
    } catch {
      // storage unavailable: use defaults
    }
    if (!s.autoDetect || isBlocked(location.hostname, s.blocklist)) return;

    if (isSandboxed()) {
      // CSP `sandbox` pages cannot run scripts in child frames: open the viewer in the tab.
      const msg: StashMessage = {
        type: 'jpl-stash',
        // Messages are limited to 64 MiB; above that the viewer re-fetches the URL.
        text: found.text.length < 60_000_000 ? found.text : undefined,
        contentType: found.contentType,
        url: location.href,
      };
      chrome.runtime.sendMessage(msg);
      return;
    }
    mountViewer(found.text, found.contentType);
  },
});

/** Opaque origin = the document is sandboxed (e.g. `Content-Security-Policy: sandbox`). */
function isSandboxed(): boolean {
  try {
    return window.origin === 'null';
  } catch {
    return true;
  }
}

function mountViewer(text: string, contentType: string) {
  const viewerUrl = chrome.runtime.getURL('/viewer.html');
  const viewerOrigin = new URL(viewerUrl).origin;
  const originals = Array.from(document.body.children) as HTMLElement[];
  const prevDisplay = originals.map((el) => el.style.display);
  const prevOverflow = document.documentElement.style.overflow;

  const frame = document.createElement('iframe');
  frame.src = viewerUrl;
  frame.allow = 'clipboard-write';
  frame.title = 'JSONPath Lens';
  frame.setAttribute(
    'style',
    'position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;padding:0;z-index:2147483647;background:transparent;color-scheme:normal;',
  );

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back to JSONPath Lens';
  backBtn.setAttribute(
    'style',
    'position:fixed;top:8px;right:12px;z-index:2147483647;font:13px system-ui,sans-serif;padding:4px 10px;border-radius:6px;border:1px solid #888;background:#fff;color:#111;cursor:pointer;display:none;',
  );

  const showViewer = (on: boolean) => {
    frame.style.display = on ? 'block' : 'none';
    backBtn.style.display = on ? 'none' : 'block';
    originals.forEach((el, i) => (el.style.display = on ? 'none' : prevDisplay[i]));
    document.documentElement.style.overflow = on ? 'hidden' : prevOverflow;
  };
  backBtn.addEventListener('click', () => showViewer(true));

  let sent = false;
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || e.origin !== viewerOrigin) return;
    const type = (e.data as { type?: string })?.type;
    if (type === MSG_READY && !sent) {
      sent = true;
      const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
      const msg: LoadMessage = { type: MSG_LOAD, buffer, contentType, url: location.href };
      frame.contentWindow!.postMessage(msg, viewerOrigin, [buffer]);
    } else if (type === MSG_SHOW_ORIGINAL) {
      showViewer(false);
    }
  });

  document.body.appendChild(frame);
  document.body.appendChild(backBtn);
  showViewer(true);
}
