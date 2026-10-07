# Installing JSONPath Lens

JSONPath Lens is not published in the Chrome Web Store. It is installed as an **unpacked extension**, either from a downloaded zip (no tools needed) or from a build of the source code.

## What the build produces

```
output/
├── unpacked/                              ← the extension itself: select this folder in "Load unpacked"
│   ├── manifest.json
│   └── …
└── packed/
    └── jsonpath-lens-<version>-chrome.zip ← the same files, zipped: share it or attach it to a GitHub release
```

`output/` is not committed to git (it is in `.gitignore`).

## Option A: install from the zip (any device, no Node needed)

1. Download `jsonpath-lens-<version>-chrome.zip` from the repository's [Releases page](https://github.com/andrii-habchak/JSONPath-Lens/releases), or copy it from `output/packed/` on your own machine.
2. Extract it into a folder you will keep, for example `~/Applications/JSONPath-Lens`. Chrome loads the extension from this folder every time it starts, so don't delete it. `manifest.json` must be directly inside the folder.
3. Open `chrome://extensions` and turn on **Developer mode** (top-right switch).
4. Click **Load unpacked** and select the extracted folder. You can also drag the folder onto the page.
5. _(Optional)_ Pin **JSONPath Lens** from the puzzle-piece icon in the toolbar.

Chrome doesn't install a zip directly. It has to be extracted first. Chrome also doesn't accept a signed `.crx` file from outside the Web Store on Windows or macOS: the extension would be installed but disabled. That's why the release is a zip.

**Updating to a newer zip:** extract it over the same folder, then click the reload icon (↻) on the JSONPath Lens card in `chrome://extensions`. Your settings stay.

## Option B: build from source

### Requirements

| Tool                                        | Version      | Check                                                                                               |
| ------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| Google Chrome (or another Chromium browser) | 120 or newer | `chrome://version`                                                                                  |
| Node.js                                     | 22 or newer  | `node --version`                                                                                    |
| pnpm                                        | 10           | `pnpm --version`. If it's missing: `npm install -g pnpm@10` (Node 25+ no longer bundles `corepack`) |
| git                                         | any          | `git --version`                                                                                     |

### Build

```bash
git clone git@github-vigil:andrii-habchak/JSONPath-Lens.git   # see docs/git-setup.md; or the https URL for read-only use
cd JSONPath-Lens
pnpm install          # also runs `wxt prepare`
pnpm build            # → output/unpacked and output/packed/*.zip
```

`pnpm build:unpacked` builds only `output/unpacked` (a little faster).

### Load it into Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `output/unpacked` inside the project.
3. _(Optional)_ Pin **JSONPath Lens** in the toolbar.

**Updating:** run `git pull && pnpm install && pnpm build`, then click ↻ on the extension card and reload any tabs that were already open.

## Permissions

Chrome asks for permission to _read and change all your data on all websites_. The extension needs this for two things: to detect raw JSON responses in any tab, and to let the workspace's **Load URL** send requests without CORS restrictions. Nothing leaves your browser: there are no analytics and no remote code.

## Optional settings

- **JSON files on disk** (`file:///…/data.json`): on `chrome://extensions`, open JSONPath Lens → **Details** and turn on **Allow access to file URLs**.
- **Keyboard shortcut:** **Alt+Shift+J** opens the workspace. You can change it at `chrome://extensions/shortcuts`.
- **Options:** right-click the toolbar icon → **Options**. From there you can turn auto-beautify off, skip specific hosts, change the theme, or change the result limit.

## Check that it works

1. Open a JSON API URL, for example `https://api.github.com/repos/andrii-habchak/JSONPath-Lens`. The page should turn into the JSONPath Lens tree view.
2. Type `$..url` in the query bar and press **Enter**. The matches are highlighted and listed on the right.
3. Click the toolbar icon. The workspace opens; paste some JSON and press **Format**.
4. Open DevTools (**F12**) → **JSONPath Lens** tab, then reload the page. JSON fetch/XHR responses appear in the list.

## Publishing the zip on GitHub

**Automatically (recommended):** push a version tag. The workflow in `.github/workflows/release.yml` builds the extension, runs the type check and unit tests, and creates a GitHub release with the zip attached.

```bash
# set "version" in package.json first (e.g. 0.2.0) and commit it
git tag v0.2.0
git push origin v0.2.0
```

**Manually:** run `pnpm build`, open GitHub → **Releases** → **Draft a new release**, pick or create a tag, and attach `output/packed/jsonpath-lens-<version>-chrome.zip`.

## Development mode (live reload)

```bash
pnpm dev
```

WXT starts a separate Chrome profile with the extension loaded from `output/unpacked-dev`. It rebuilds on every change and reloads automatically.

## Running the tests

```bash
pnpm test             # unit tests (Vitest)
pnpm compile          # type check
pnpm lint             # ESLint
npx playwright install chromium   # once, if Playwright has no browser yet
pnpm e2e              # builds output/unpacked, then runs it in headless Chromium
pnpm bench            # parse/query timings on generated 50 MB and 100 MB payloads
```

## Uninstalling

On `chrome://extensions`, click **Remove** on the JSONPath Lens card. This also deletes its settings and the workspace's last document. You can then delete the extracted folder.

## Troubleshooting

| Symptom                                                       | Fix                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The file picker doesn't show the folder                       | Pick `output/unpacked` (not hidden). For a downloaded zip, select the folder you extracted it to: the one that directly contains `manifest.json`.                                                                       |
| "Manifest file is missing or unreadable"                      | You selected a parent folder. Select the folder that directly contains `manifest.json`.                                                                                                                                 |
| A JSON URL still shows raw text                               | Check that **Auto-beautify JSON URLs** is on in Options and that the host isn't in **Skip these hosts**. Then reload the tab. Other JSON viewer extensions can take over the page first: disable them.                  |
| The URL changes to `chrome-extension://…/viewer.html?stash=…` | This is expected. The API sent `Content-Security-Policy: sandbox`, which stops extensions from embedding a viewer in the page, so the viewer opens in the tab instead. **Original** takes you back to the raw response. |
| The DevTools tab shows no requests                            | DevTools only records requests while it is open. Open it and reload the page. If you only see a few entries, untick **JSON only**.                                                                                      |
| "DevTools did not keep this response body"                    | DevTools drops the bodies of very large responses. Use **Re-fetch** (GET only) or open the URL in a tab.                                                                                                                |
| **Load unpacked** is greyed out or blocked                    | Your organisation's Chrome policy disables Developer mode. Use a personal Chrome profile, or ask IT to allow this extension.                                                                                            |
| Nothing changed after an update                               | Rebuild (or extract the new zip) and click ↻ on the extension card.                                                                                                                                                     |
