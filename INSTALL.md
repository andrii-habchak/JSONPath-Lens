# Installing JSONPath Lens

JSONPath Lens is not published in the Chrome Web Store. You build it from source and load it as an **unpacked extension**. This takes about two minutes.

## Requirements

| Tool                                        | Version      | Check                                                     |
| ------------------------------------------- | ------------ | --------------------------------------------------------- |
| Google Chrome (or another Chromium browser) | 120 or newer | `chrome://version`                                        |
| Node.js                                     | 22 or newer  | `node --version`                                          |
| pnpm                                        | 10           | `pnpm --version` (if it's missing, run `corepack enable`) |
| git                                         | any          | `git --version`                                           |

## 1. Get the code and build it

```bash
git clone https://github.com/andrii-habchak/JSONPath-Lens.git
cd JSONPath-Lens
pnpm install          # also runs `wxt prepare`
pnpm build            # writes the extension to .output/chrome-mv3
```

If you already have the folder, run `git pull` first and then `pnpm install && pnpm build`.

## 2. Load it into Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (the switch in the top-right corner).
3. Click **Load unpacked**.
4. Select the `.output/chrome-mv3` folder inside the project.
   - On macOS, Finder hides folders whose names start with a dot. Press **⌘ + Shift + .** in the file picker to show them.
5. _(Optional)_ Click the puzzle-piece icon in the toolbar and pin **JSONPath Lens**.

Chrome asks for permission to _read and change all your data on all websites_. The extension needs this to detect raw JSON responses in any tab, and to let the workspace's **Load URL** send requests without CORS restrictions. Nothing ever leaves your browser: there are no analytics and no remote code.

## 3. Optional settings

- **JSON files on disk** (`file:///…/data.json`): on `chrome://extensions` → JSONPath Lens → **Details**, turn on **Allow access to file URLs**.
- **Keyboard shortcut:** **Alt+Shift+J** opens the workspace. You can change it at `chrome://extensions/shortcuts`.
- **Options:** right-click the toolbar icon → **Options**. From there you can turn auto-beautify off, skip specific hosts, change the theme, or change the result limit.

## 4. Check that it works

1. Open any JSON API URL, for example `https://api.github.com/repos/andrii-habchak/JSONPath-Lens`. The page should turn into the JSONPath Lens tree view.
2. Type `$..url` in the query bar and press **Enter**. The matches are highlighted and listed on the right.
3. Click the toolbar icon. The workspace opens; paste some JSON and press **Format**.
4. Open DevTools (**F12**) → **JSONPath Lens** tab, then reload the page. JSON fetch/XHR responses appear in the list.

## Updating

```bash
git pull
pnpm install
pnpm build
```

Then go to `chrome://extensions` and click the **reload** icon (↻) on the JSONPath Lens card. Reload any tabs that were already open.

## Development mode (live reload)

```bash
pnpm dev
```

WXT starts a separate Chrome profile with the extension loaded. It rebuilds on every change and reloads the extension and its pages automatically.

## Running the tests

```bash
pnpm test             # unit tests (Vitest)
pnpm compile          # type check
pnpm lint             # ESLint
npx playwright install chromium   # once, if Playwright has no browser yet
pnpm e2e              # builds the extension, then runs it in headless Chromium
pnpm bench            # parse/query timings on generated 50 MB and 100 MB payloads
```

## Creating a zip

```bash
pnpm zip              # → .output/jsonpath-lens-<version>-chrome.zip
```

You can drag the zip onto `chrome://extensions` on another machine where Developer mode is on. You can also extract it and use **Load unpacked**.

## Uninstalling

On `chrome://extensions`, click **Remove** on the JSONPath Lens card. Settings and the workspace's last document are deleted with it.

## Troubleshooting

| Symptom                                                       | Fix                                                                                                                                                                                                             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A JSON URL still shows raw text                               | Check that **Auto-beautify JSON URLs** is on in Options and that the host isn't in **Skip these hosts**. Then reload the tab. Other JSON viewer extensions can take over the page first: disable them.          |
| The URL changes to `chrome-extension://…/viewer.html?stash=…` | Expected. The API sent `Content-Security-Policy: sandbox`, which stops extensions from embedding a viewer in the page, so the viewer opens in the tab instead. **Original** takes you back to the raw response. |
| The DevTools tab shows no requests                            | DevTools only records requests while it's open. Open it and reload the page. If you only see a few entries, untick **JSON only**.                                                                               |
| "DevTools did not keep this response body"                    | DevTools drops the bodies of very large responses. Use **Re-fetch** (GET only) or open the URL in a tab.                                                                                                        |
| **Load unpacked** is greyed out or blocked                    | Your organisation's Chrome policy disables Developer mode. Use a personal Chrome profile, or ask IT to allow this extension.                                                                                    |
| After `git pull` nothing changed                              | Run `pnpm build` again and click ↻ on the extension card.                                                                                                                                                       |
