/** postMessage protocol between the content script and the viewer iframe. */
export const MSG_READY = 'jpl-ready';
export const MSG_LOAD = 'jpl-load';
export const MSG_SHOW_ORIGINAL = 'jpl-show-original';

export interface LoadMessage {
  type: typeof MSG_LOAD;
  buffer: ArrayBuffer;
  contentType: string;
  url: string;
}

/** runtime.sendMessage to the background service worker. */
export interface OpenWorkspaceMessage {
  type: 'jpl-open-workspace';
  /** IndexedDB key of a stored document to open. */
  handoff?: string;
}

/** Content script → background: keep this text and open the viewer in the tab (sandboxed pages). */
export interface StashMessage {
  type: 'jpl-stash';
  text?: string;
  contentType: string;
  url: string;
}

/** Viewer page → background: fetch (and forget) a stashed document. */
export interface UnstashMessage {
  type: 'jpl-unstash';
  token: string;
}

export interface Stashed {
  /** Missing when the response was too large to hand over; the viewer re-fetches `url`. */
  text?: string;
  contentType: string;
  url: string;
}

/** URL hash that tells the content script to leave the page alone. */
export const RAW_HASH = 'jpl-raw';
