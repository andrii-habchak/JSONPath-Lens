import { signal } from '@preact/signals';

import { DEFAULT_SETTINGS, type Settings, type ThemePref } from '../shared/settings';

export { DEFAULT_SETTINGS, isBlocked, type Settings, type ThemePref } from '../shared/settings';

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });

function storage(): chrome.storage.StorageArea | null {
  try {
    return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
}

let started = false;

/** Load settings once and keep the signal in sync with chrome.storage. */
export function initSettings(): Promise<Settings> {
  const area = storage();
  if (!area) return Promise.resolve(settings.value);
  if (!started) {
    started = true;
    chrome.storage.onChanged.addListener((changes, name) => {
      if (name !== 'local' || !changes.settings) return;
      settings.value = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings>) };
    });
  }
  return area.get('settings').then((v) => {
    settings.value = { ...DEFAULT_SETTINGS, ...((v.settings as Partial<Settings>) ?? {}) };
    return settings.value;
  });
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  settings.value = { ...settings.value, ...patch };
  await storage()?.set({ settings: settings.value });
}

/** Apply the theme preference to <html data-theme>. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function isDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}
