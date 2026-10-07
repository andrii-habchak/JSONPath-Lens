import { expect, test } from './fixtures';

/**
 * The real panel only runs inside DevTools, which Playwright cannot open.
 * This loads the panel page with a stubbed `chrome.devtools.network` that
 * replays HAR entries, which exercises the whole panel UI.
 */
test('DevTools panel lists JSON responses and keeps a history per request', async ({ page, extensionId }) => {
  await page.addInitScript(() => {
    type Listener = (r: unknown) => void;
    const finished: Listener[] = [];
    const entry = (url: string, mime: string, body: string, status = 200) => ({
      request: { method: 'GET', url, headers: [{ name: 'accept', value: '*/*' }] },
      response: {
        status,
        headers: [{ name: 'content-type', value: mime }],
        content: { mimeType: mime, size: body.length },
        bodySize: body.length,
      },
      time: 12,
      _resourceType: 'fetch',
      getContent: (cb: (c: string, enc: string) => void) => cb(body, ''),
    });
    const w = window as unknown as { chrome: Record<string, unknown>; __emit: (u: string, m: string, b: string) => void };
    w.chrome.devtools = {
      network: {
        getHAR: (cb: (l: unknown) => void) =>
          cb({
            entries: [
              entry('https://api.test/v1/players?limit=2', 'application/json', '{"players":[{"id":1,"name":"Ann"},{"id":2,"name":"Bo"}]}'),
              entry('https://api.test/app.js', 'application/javascript', 'console.log(1)'),
              entry('https://api.test/v1/stream', 'application/x-ndjson', '{"e":1}\n{"e":2}\n'),
            ],
          }),
        onRequestFinished: { addListener: (l: Listener) => finished.push(l), removeListener: () => {} },
        onNavigated: { addListener: () => {}, removeListener: () => {} },
      },
      panels: { themeName: 'default' },
    };
    w.__emit = (u, m, b) => finished.forEach((l) => l(entry(u, m, b)));
  });

  await page.goto(`chrome-extension://${extensionId}/devtools-panel.html`);
  const items = page.locator('.req-item');
  await expect(items).toHaveCount(2); // JS filtered out by "JSON only"
  await items.filter({ hasText: 'players' }).click();
  await expect(page.locator('.row', { hasText: '"Ann"' })).toBeVisible();

  const q = page.getByTestId('query-input');
  await q.fill('$.players[*].name');
  await q.press('Enter');
  await expect(page.getByTestId('history-button')).toHaveText('History (1)');

  // Another request has its own (empty) history...
  await items.filter({ hasText: 'stream' }).click();
  await expect(page.getByTestId('doc-info')).toContainText('NDJSON · 2 lines');
  await expect(page.getByTestId('history-button')).toHaveText('History');

  // ...and switching back restores the first one.
  await items.filter({ hasText: 'players' }).click();
  await expect(page.getByTestId('history-button')).toHaveText('History (1)');

  // Live requests are appended.
  await page.evaluate(() =>
    (window as unknown as { __emit: (u: string, m: string, b: string) => void }).__emit(
      'https://api.test/v1/live',
      'application/json',
      '{"live":true}',
    ),
  );
  await expect(items).toHaveCount(3);
});
