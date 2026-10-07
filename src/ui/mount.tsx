import { render, type ComponentChildren } from 'preact';
import { effect } from '@preact/signals';
import { applyTheme, initSettings, settings } from './settings';
import './viewer.css';

/** Load settings, keep the theme applied, and render the page. */
export async function mount(app: () => ComponentChildren): Promise<void> {
  await initSettings().catch(() => undefined);
  effect(() => applyTheme(settings.value.theme));
  const root = document.getElementById('app')!;
  render(<>{app()}</>, root);
}
