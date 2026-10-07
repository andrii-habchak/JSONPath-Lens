import { expect, test } from './fixtures';

test.describe('JSON URL tab', () => {
  test('beautifies application/json and runs the JSONPath example', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    await expect(v.getByRole('tree')).toBeVisible();
    await expect(v.locator('.row').first()).toContainText('$');
    await expect(v.getByTestId('doc-info')).toContainText('JSON');

    await v.getByTestId('query-input').fill('$.array[?(@.key==2)].dictionary.a');
    await v.getByTestId('query-input').press('Enter');
    await expect(v.getByTestId('match-status')).toHaveText('1 / 1');
    await expect(v.getByTestId('match-count')).toHaveText('1 match');
    await expect(v.getByTestId('selected-path')).toHaveText('$.array[1].dictionary.a');
    await expect(v.locator('.row.current')).toContainText('"yes"');
  });

  test('keeps big integers exact', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    await expect(v.locator('.row', { hasText: '12345678901234567890' })).toBeVisible();
    await expect(v.getByTestId('doc-info')).toContainText('big integers kept exact');
  });

  test('regex sugar and quick search', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    const q = v.getByTestId('query-input');
    await q.fill('$.users[?@.name =~ /^AND/i].email');
    await q.press('Enter');
    await expect(v.getByTestId('match-status')).toHaveText('1 / 1');
    await expect(v.locator('.hint')).toContainText("regex(@.name, '^AND', 'i')");

    await q.fill('corp.io');
    await expect(v.getByTestId('match-status')).toHaveText('1 / 1');
    await expect(v.locator('.mode-chip')).toHaveText('Text');
  });

  test('query history is per tab and cleared on reload', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    let v = viewer(page);
    const q = v.getByTestId('query-input');
    await q.fill('$..email');
    await q.press('Enter');
    await expect(v.getByTestId('match-status')).toHaveText('1 / 2');
    await q.fill('$..name');
    await q.press('Enter');
    await expect(v.getByTestId('history-button')).toHaveText('History (2)');

    // Click an entry to apply it.
    await v.getByTestId('history-button').click();
    await v.getByTestId('history-list').getByText('$..email').click();
    await expect(q).toHaveValue('$..email');
    await expect(v.getByTestId('match-count')).toHaveText('2 matches');

    // ↑ in an empty bar walks history.
    await q.fill('');
    await q.press('ArrowUp');
    await expect(q).toHaveValue('$..email');

    await page.reload();
    v = viewer(page);
    await expect(v.getByRole('tree')).toBeVisible();
    await expect(v.getByTestId('history-button')).toHaveText('History');
  });

  test('works on a strict-CSP response', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/csp.json`);
    const v = viewer(page);
    await expect(v.getByRole('tree')).toBeVisible();
    await v.getByTestId('query-input').fill('$..email');
    await expect(v.getByTestId('match-status')).toHaveText('1 / 2');
  });

  test('opens the viewer in the tab for CSP-sandboxed responses', async ({ page, server }) => {
    await page.goto(`${server.url}/sandboxed.json`);
    await page.waitForURL(/viewer\.html\?/);
    await expect(page.getByRole('tree')).toBeVisible();
    await expect(page.locator('.row', { hasText: '12345678901234567890' })).toBeVisible();
    await page.getByRole('button', { name: 'Original' }).click();
    await page.waitForURL(/sandboxed\.json#jpl-raw/);
    await expect(page.locator('body')).toContainText('"users"');
  });

  test('handles text/plain JSON and +json types, ignores plain text and HTML', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/plain.json`);
    await expect(viewer(page).getByRole('tree')).toBeVisible();

    await page.goto(`${server.url}/problem.json`);
    await expect(viewer(page).getByRole('tree')).toBeVisible();

    await page.goto(`${server.url}/not-json.txt`);
    await page.waitForTimeout(500);
    await expect(page.locator('iframe[title="JSONPath Lens"]')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('hello, this is just text');

    await page.goto(`${server.url}/page.html`);
    await page.waitForTimeout(500);
    await expect(page.locator('iframe[title="JSONPath Lens"]')).toHaveCount(0);
  });

  test('shows a parse error with line and column', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/broken.json`);
    const v = viewer(page);
    await expect(v.getByTestId('parse-error')).toContainText('line 3, column 8');
  });

  test('NDJSON served as text/plain becomes a virtual array', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/lines.txt`);
    const v = viewer(page);
    await expect(v.getByTestId('doc-info')).toContainText('NDJSON · 4 lines (1 bad)');
    await expect(v.locator('.row.bad')).toContainText('this line is broken');
    await v.getByTestId('query-input').fill("$[?@.level=='ERROR' && @.service=='wallet'].msg");
    await expect(v.getByTestId('match-status')).toHaveText('1 / 1');
    await expect(v.locator('.result-path')).toContainText('L2');
  });

  test('Original button restores the browser rendering', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    await v.getByRole('button', { name: 'Original' }).click();
    await expect(page.locator('iframe[title="JSONPath Lens"]')).toBeHidden();
    await page.getByRole('button', { name: 'Back to JSONPath Lens' }).click();
    await expect(page.locator('iframe[title="JSONPath Lens"]')).toBeVisible();
  });

  test('copy path, text view and theme toggle', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    const row = v.locator('.row', { hasText: 'bob@corp.io' });
    await row.click();
    await expect(v.getByTestId('selected-path')).toHaveText('$.users[1].email');
    await row.getByRole('button', { name: 'path' }).click();
    await expect(v.locator('.toast')).toContainText('Copied $.users[1].email');

    await v.getByTestId('text-view-button').click();
    await expect(v.getByTestId('text-view')).toContainText('"dictionary"');

    const theme = v.getByTestId('theme-button');
    const before = await theme.textContent();
    await theme.click();
    await expect(theme).not.toHaveText(before ?? '');
  });
});
