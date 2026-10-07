import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Build the extension once unless SKIP_BUILD is set and a build exists. */
export default function globalSetup() {
  if (process.env.SKIP_BUILD && existsSync('output/unpacked/manifest.json')) return;
  execSync('pnpm wxt build', { stdio: 'inherit' });
}
