import { makeLargeJson } from '../bench/fixtures';
import { expect, test } from './fixtures';

test.describe('Workspace', () => {
  test('paste, format, query; history resets per document', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/workspace.html`);
    await page.getByTestId('paste-input').fill('{"orders":[{"id":1,"state":"PAID"},{"id":2,"state":"FAILED"},{"id":3,"state":"FAILED"}]}');
    await page.getByTestId('format-button').click();
    await expect(page.getByRole('tree')).toBeVisible();

    const q = page.getByTestId('query-input');
    await q.fill("$.orders[?@.state == 'FAILED'].id");
    await q.press('Enter');
    await expect(page.getByTestId('match-status')).toHaveText('1 / 2');
    await expect(page.getByTestId('history-button')).toHaveText('History (1)');

    // A new document starts a fresh history.
    await page.getByTestId('paste-toggle').click();
    await page.getByTestId('paste-input').fill('[1,2,3]');
    await page.getByTestId('format-button').click();
    await expect(page.getByTestId('history-button')).toHaveText('History');
  });

  test('restores the last document after a reload, without history', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/workspace.html`);
    await page.getByTestId('paste-input').fill('{"restored":true}');
    await page.getByTestId('format-button').click();
    await page.getByTestId('query-input').fill('$.restored');
    await page.getByTestId('query-input').press('Enter');
    await expect(page.getByTestId('history-button')).toHaveText('History (1)');

    await page.reload();
    await expect(page.getByTestId('doc-label')).toContainText('restored');
    await expect(page.locator('.row', { hasText: 'restored' })).toBeVisible();
    await expect(page.getByTestId('history-button')).toHaveText('History');
  });

  test('NDJSON paste', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/workspace.html`);
    await page.getByTestId('paste-input').fill('{"a":1}\n{"a":2}\n{"a":3}\n');
    await page.getByTestId('format-button').click();
    await expect(page.getByTestId('doc-info')).toContainText('NDJSON · 3 lines');
    await page.getByTestId('query-input').fill('$[?@.a >= 2]');
    await expect(page.getByTestId('match-status')).toHaveText('1 / 2');
  });

  test('Load URL with a Bearer header', async ({ page, extensionId, server }) => {
    await page.goto(`chrome-extension://${extensionId}/workspace.html`);
    await page.getByTestId('url-toggle').click();
    await page.getByTestId('url-input').fill(`${server.url}/auth.json`);
    await page.getByTestId('url-load').click();
    // Without the header the API answers 401 with a JSON body.
    await expect(page.locator('.row', { hasText: 'unauthorized' })).toBeVisible();
    await expect(page.getByTestId('request-strip')).toContainText('401');

    await page.getByTestId('url-toggle').click();
    await page.getByTestId('headers-input').fill('Accept: application/json\nAuthorization: Bearer secret-token');
    await page.getByTestId('url-load').click();
    await expect(page.locator('.row', { hasText: '"admin"' })).toBeVisible();
    await expect(page.getByTestId('request-strip')).toContainText('200');
    // Secrets are masked in the request summary.
    await page.getByTestId('request-strip').locator('summary').click();
    await expect(page.getByTestId('request-strip')).toContainText('Authorization: ••••••');
  });

  test('Load URL shows a download-only NDJSON export', async ({ page, extensionId, server }) => {
    await page.goto(`chrome-extension://${extensionId}/workspace.html`);
    await page.getByTestId('url-toggle').click();
    await page.getByTestId('url-input').fill(`${server.url}/export.ndjson`);
    await page.getByTestId('url-load').click();
    await expect(page.getByTestId('doc-info')).toContainText('NDJSON · 4 lines (1 bad)');
  });
});

test.describe('Large payload', () => {
  test('20 MB JSON in a tab: loads, queries and scrolls', async ({ page, extensionId }) => {
    test.setTimeout(120_000);
    const text = makeLargeJson(20);
    await page.goto(`chrome-extension://${extensionId}/workspace.html`);
    await expect(page.getByTestId('paste-input')).toBeVisible();
    // Simulate a big paste (skips the textarea).
    const t0 = Date.now();
    await page.evaluate((t) => {
      const ta = document.querySelector('[data-testid="paste-input"]')!;
      const dt = new DataTransfer();
      dt.setData('text', t);
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    await expect(page.getByTestId('doc-info')).toContainText('nodes', { timeout: 30_000 });
    const loadMs = Date.now() - t0;
    console.log(`20 MB load in browser: ${loadMs} ms; ${await page.getByTestId('doc-info').textContent()}`);

    await page.getByRole('button', { name: 'Expand all' }).click();
    await page.getByRole('tree').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.locator('.row').last()).toBeVisible();

    const q = page.getByTestId('query-input');
    await q.fill("$.items[?@.status == 'FAILED' && @.email =~ /gmail/i].id");
    await q.press('Enter');
    await expect(page.getByTestId('match-count')).toContainText('matches', { timeout: 30_000 });
    console.log(`query: ${await page.getByTestId('match-count').textContent()} ${await page.locator('.results-head').textContent()}`);
  });
});
