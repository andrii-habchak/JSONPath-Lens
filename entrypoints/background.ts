import type { OpenWorkspaceMessage, StashMessage, Stashed, UnstashMessage } from '../src/shared/messages';

const STASH_TTL_MS = 60_000;
const stash = new Map<string, Stashed & { at: number }>();

export default defineBackground(() => {
  const openWorkspace = (hash = '') =>
    chrome.tabs.create({ url: chrome.runtime.getURL('/workspace.html') + hash });

  chrome.action.onClicked.addListener(() => openWorkspace());

  chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-workspace') openWorkspace();
  });

  chrome.runtime.onMessage.addListener(
    (msg: OpenWorkspaceMessage | StashMessage | UnstashMessage, sender, sendResponse) => {
      switch (msg?.type) {
        case 'jpl-open-workspace':
          openWorkspace(msg.handoff ? `#handoff=${encodeURIComponent(msg.handoff)}` : '');
          return false;
        case 'jpl-stash': {
          // A sandboxed page cannot host the viewer iframe: show the viewer in the tab itself.
          const tabId = sender.tab?.id;
          if (tabId === undefined) return false;
          const now = Date.now();
          for (const [k, v] of stash) if (now - v.at > STASH_TTL_MS) stash.delete(k);
          const params = new URLSearchParams({ src: msg.url });
          if (msg.text !== undefined) {
            const token = crypto.randomUUID();
            stash.set(token, { text: msg.text, contentType: msg.contentType, url: msg.url, at: now });
            params.set('stash', token);
          }
          chrome.tabs.update(tabId, { url: chrome.runtime.getURL('/viewer.html') + '?' + params.toString() });
          return false;
        }
        case 'jpl-unstash': {
          const item = stash.get(msg.token);
          stash.delete(msg.token);
          sendResponse(item ? { text: item.text, contentType: item.contentType, url: item.url } : null);
          return false;
        }
      }
      return false;
    },
  );
});
