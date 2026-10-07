import { useState } from 'preact/hooks';
import { mount } from '../../src/ui/mount';
import { saveSettings, settings, type ThemePref } from '../../src/ui/settings';

function Options() {
  const s = settings.value;
  const [blocklist, setBlocklist] = useState(s.blocklist.join('\n'));
  const [saved, setSaved] = useState(false);
  const save = async (patch: Parameters<typeof saveSettings>[0]) => {
    await saveSettings(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };
  return (
    <div class="options">
      <h1>
        <img src="/icon/48.png" alt="" width={28} height={28} /> JSONPath Lens — Options
      </h1>
      <section>
        <label class="opt">
          <input type="checkbox" checked={s.autoDetect} onChange={(e) => save({ autoDetect: (e.currentTarget as HTMLInputElement).checked })} />
          <span>
            <strong>Auto-beautify JSON URLs</strong>
            <br />
            <span class="muted">Replace the browser's rendering when a tab opens a JSON or NDJSON response.</span>
          </span>
        </label>
      </section>
      <section>
        <label class="field">
          <strong>Skip these hosts</strong>
          <span class="muted">One per line. Exact host (<code>api.example.com</code>) or wildcard (<code>*.example.com</code>).</span>
          <textarea rows={5} value={blocklist} onInput={(e) => setBlocklist((e.currentTarget as HTMLTextAreaElement).value)} onBlur={() => save({ blocklist: blocklist.split('\n').map((x) => x.trim()).filter(Boolean) })} />
        </label>
      </section>
      <section class="row-fields">
        <label class="field">
          <strong>Theme</strong>
          <select value={s.theme} onChange={(e) => save({ theme: (e.currentTarget as HTMLSelectElement).value as ThemePref })}>
            <option value="system">Follow system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label class="field">
          <strong>Max results listed</strong>
          <input
            type="number"
            min={100}
            max={1000000}
            step={100}
            value={s.maxResults}
            onChange={(e) => save({ maxResults: Math.max(100, Number((e.currentTarget as HTMLInputElement).value) || 10000) })}
          />
        </label>
      </section>
      <p class="muted small">{saved ? 'Saved.' : 'Changes are saved automatically.'}</p>
      <section class="muted small">
        <strong>Shortcuts</strong>: <code>Alt+Shift+J</code> opens the workspace (change it at <code>chrome://extensions/shortcuts</code>) ·{' '}
        <code>/</code> focuses the query bar · <code>Enter</code>/<code>Shift+Enter</code> next/previous match · <code>↑/↓</code> in an empty query bar
        browses history · <code>Esc</code> clears the query.
      </section>
    </div>
  );
}

mount(() => <Options />);
