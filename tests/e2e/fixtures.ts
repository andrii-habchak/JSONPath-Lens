import { chromium, test as base, type BrowserContext, type FrameLocator, type Page } from '@playwright/test';
import path from 'node:path';
import { startServer } from './server';

const EXT = path.resolve('output/unpacked');

export const test = base.extend<
  { page: Page; viewer: (page: Page) => FrameLocator; queryMode: 'filter' | 'search' },
  { extContext: BrowserContext; extensionId: string; server: { url: string } }
>({
  extContext: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: !process.env.HEADED,
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  extensionId: [
    async ({ extContext: context }, use) => {
      let [sw] = context.serviceWorkers();
      if (!sw) sw = await context.waitForEvent('serviceworker');
      await use(new URL(sw.url()).host);
    },
    { scope: 'worker' },
  ],
  server: [
    async ({}, use) => {
      const s = await startServer();
      await use(s);
      await s.close();
    },
    { scope: 'worker' },
  ],
  // Most specs exercise Search mode; Filter specs opt in with test.use({ queryMode: 'filter' }).
  queryMode: ['search', { option: true }],
  page: async ({ extContext: context, extensionId, queryMode }, use) => {
    const [sw] = context.serviceWorkers().filter((w) => w.url().includes(extensionId));
    await sw.evaluate((mode) => chrome.storage.local.set({ settings: { queryMode: mode } }), queryMode);
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
  viewer: async ({}, use) => {
    await use((page: Page) => page.frameLocator('iframe[title="JSONPath Lens"]'));
  },
});

export const expect = test.expect;
