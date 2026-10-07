/** Settings shape and pure helpers (no UI deps; safe for the content script). */
export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  /** Auto-beautify tabs that open a JSON URL. */
  autoDetect: boolean;
  /** Hosts where auto-beautify is skipped (exact host or *.suffix). */
  blocklist: string[];
  /** Max results listed in the results pane. */
  maxResults: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  autoDetect: true,
  blocklist: [],
  maxResults: 10_000,
};

/** True when `host` matches an entry of the blocklist (exact or `*.example.com`). */
export function isBlocked(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((raw) => {
    const e = raw.trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith('*.')) return h === e.slice(2) || h.endsWith(e.slice(1));
    return h === e;
  });
}
