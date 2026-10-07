import { expect, test } from './fixtures';

test('a web page cannot drive viewer.html into fetching URLs', async ({ page, server, extensionId }) => {
  await page.goto(`${server.url}/embed.html?id=${extensionId}`);
  await expect(page.frameLocator('#f').locator('body')).toContainText('cannot be embedded');
});

test('Stop recovers from a runaway regex', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/workspace.html`);
  await page.getByTestId('paste-input').fill(JSON.stringify({ s: 'a'.repeat(40) + '!' }));
  await page.getByTestId('format-button').click();
  await expect(page.getByRole('tree')).toBeVisible();
  await page.getByRole('button', { name: '.*' }).click();
  await page.getByTestId('query-input').fill('^(a+)+$');
  await page.getByTestId('stop-button').click({ timeout: 15_000 });
  await expect(page.locator('.toast')).toContainText('Query stopped');
  await expect(page.getByRole('tree')).toBeVisible();
  await page.getByTestId('query-input').fill('$.s');
  await expect(page.getByTestId('match-status')).toHaveText('1 / 1');
});

test('browsing history with arrow keys does not reorder it', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/workspace.html`);
  await page.getByTestId('paste-input').fill('{"a":1,"b":2,"c":3}');
  await page.getByTestId('format-button').click();
  const q = page.getByTestId('query-input');
  for (const k of ['a', 'b', 'c']) {
    await q.fill(`$.${k}`);
    await q.press('Enter');
    await expect(page.getByTestId('match-status')).toHaveText('1 / 1');
  }
  await q.fill('');
  await q.press('ArrowUp');
  await q.press('ArrowUp');
  await q.press('ArrowUp');
  await expect(q).toHaveValue('$.a');
  await page.waitForTimeout(2000); // longer than the idle-recording delay
  await q.press('ArrowDown');
  await expect(q).toHaveValue('$.b');
  await page.getByTestId('history-button').click();
  await expect(page.locator('.history-q')).toHaveText(['$.c', '$.b', '$.a']);
});

test('keyboard navigation scrolls the tree', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/workspace.html`);
  await page.getByTestId('paste-input').fill(JSON.stringify(Array.from({ length: 300 }, (_, i) => i)));
  await page.getByTestId('format-button').click();
  // Wait for this document (the workspace may first restore the previous one).
  await expect(page.getByTestId('doc-info')).toContainText('301 nodes');
  await page.locator('.row').first().click();
  const tree = page.getByRole('tree');
  for (let i = 0; i < 80; i++) await tree.press('ArrowDown');
  await expect(page.getByTestId('selected-path')).toHaveText('$[79]');
  await expect(page.locator('.row.selected')).toBeInViewport();
  await tree.press('ArrowLeft'); // to parent
  await expect(page.getByTestId('selected-path')).toHaveText('$');
});
