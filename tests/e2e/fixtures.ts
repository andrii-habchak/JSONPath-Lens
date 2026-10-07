import { chromium, test as base, type BrowserContext, type FrameLocator, type Page } from '@playwright/test';
import path from 'node:path';
import { startServer } from './server';

const EXT = path.resolve('.output/chrome-mv3');

export const test = base.extend<
  { page: Page; viewer: (page: Page) => FrameLocator },
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
  page: async ({ extContext: context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
  viewer: async ({}, use) => {
    await use((page: Page) => page.frameLocator('iframe[title="JSONPath Lens"]'));
  },
});

export const expect = test.expect;
