import type { OpenWorkspaceMessage, StashMessage, Stashed, UnstashMessage } from '../src/shared/messages';

const STASH_TTL_MS = 60_000;
const stash = new Map<string, { text?: string; contentType: string; url: string; at: number }>();

export default defineBackground(() => {
  const openWorkspace = (hash = '') => chrome.tabs.create({ url: chrome.runtime.getURL('/workspace.html') + hash });

  chrome.action.onClicked.addListener(() => openWorkspace());

  chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-workspace') openWorkspace();
  });

  chrome.runtime.onMessage.addListener((msg: OpenWorkspaceMessage | StashMessage | UnstashMessage, sender, sendResponse) => {
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
        // The token is the viewer's only way to learn the URL: a web page that
        // embeds viewer.html cannot make the extension fetch arbitrary URLs.
        const token = crypto.randomUUID();
        stash.set(token, { text: msg.text, contentType: msg.contentType, url: msg.url, at: now });
        chrome.tabs.update(tabId, { url: chrome.runtime.getURL('/viewer.html') + '?stash=' + token });
        return false;
      }
      case 'jpl-unstash': {
        const item = stash.get(msg.token);
        stash.delete(msg.token);
        const reply: Stashed | null = item ? { text: item.text, contentType: item.contentType, url: item.url } : null;
        sendResponse(reply);
        return false;
      }
    }
    return false;
  });
});
