import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  outDir: '.output',
  vite: () => ({
    plugins: [preact()],
    worker: { format: 'es' },
    build: { chunkSizeWarningLimit: 2000 },
  }),
  manifest: {
    name: 'JSONPath Lens',
    description: 'Beautify JSON API responses and query them with JSONPath and regex.',
    minimum_chrome_version: '120',
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open JSONPath Lens workspace' },
    web_accessible_resources: [
      {
        resources: ['viewer.html', 'assets/*', 'chunks/*'],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      'open-workspace': {
        suggested_key: { default: 'Alt+Shift+J' },
        description: 'Open the JSONPath Lens workspace',
      },
    },
  },
});
