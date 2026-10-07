import { expect, test } from './fixtures';

test.use({ queryMode: 'filter' });

test.describe('Filter mode', () => {
  test('outputs the matched values with a result count', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    await expect(v.getByTestId('mode-filter')).toHaveAttribute('aria-pressed', 'true');
    const q = v.getByTestId('query-input');
    await q.fill('$.users[*].email');
    await q.press('Enter');
    await expect(v.getByTestId('match-status')).toHaveText('2 results');
    await expect(v.getByTestId('filter-count')).toHaveText('2 results');
    const out = v.getByTestId('filter-output');
    await expect(out.locator('.row')).toHaveCount(3); // $ + 2 values
    await expect(out.locator('.row').nth(1)).toContainText('"a@gmail.com"');
    await out.getByTestId('filter-text-button').click();
    await expect(out.getByTestId('text-view')).toContainText('"bob@corp.io"');
    await expect(v.getByTestId('history-button')).toHaveText('History (1)');
  });

  test('keeps big integers exact in the output and handles no matches', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    const q = v.getByTestId('query-input');
    await q.fill('$.users[0].id');
    await expect(v.getByTestId('filter-output').locator('.row', { hasText: '12345678901234567890' })).toBeVisible();
    await q.fill("$.users[?@.name == 'nobody']");
    await expect(v.getByTestId('filter-count')).toHaveText('0 results');
  });

  test('asks for JSONPath and switches to Search for plain text', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    await v.getByTestId('query-input').fill('corp.io');
    await expect(v.getByTestId('filter-hint')).toBeVisible();
    await expect(v.getByTestId('filter-output')).toHaveCount(0);
    await v.getByTestId('mode-search').click();
    await expect(v.getByTestId('match-status')).toHaveText('1 / 1');
    await expect(v.getByTestId('match-count')).toHaveText('1 match');
    await v.getByTestId('mode-filter').click();
    await v.getByTestId('query-input').fill('$.array[?(@.key==2)].dictionary.a');
    await expect(v.getByTestId('filter-count')).toHaveText('1 result');
  });

  test('hints pane shows examples and runs them as filters', async ({ page, server, viewer }) => {
    await page.goto(`${server.url}/data.json`);
    const v = viewer(page);
    await v.getByTestId('hints-button').click();
    const hints = v.getByTestId('hints-pane');
    await expect(hints).toContainText('For this document');
    await expect(hints).toContainText('$.array[*]');
    await hints.getByRole('button', { name: /^\$\.array\[\?@\.key > 1\]/ }).click();
    await expect(v.getByTestId('query-input')).toHaveValue('$.array[?@.key > 1]');
    await expect(v.getByTestId('filter-count')).toHaveText('1 result');
    await expect(v.getByTestId('hints-pane')).toHaveCount(0);
  });

  test('workspace: filter a pasted document', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/workspace.html`);
    await page.getByTestId('paste-input').fill('{"orders":[{"id":1,"state":"PAID"},{"id":2,"state":"FAILED"},{"id":3,"state":"FAILED"}]}');
    await page.getByTestId('format-button').click();
    await expect(page.getByTestId('doc-info')).toContainText('nodes');
    await page.getByTestId('query-input').fill("$.orders[?@.state == 'FAILED'].id");
    await expect(page.getByTestId('filter-count')).toHaveText('2 results');
    await expect(page.getByTestId('filter-output').locator('.row')).toHaveText([/\$/, /0: 2/, /1: 3/]);
  });
});
