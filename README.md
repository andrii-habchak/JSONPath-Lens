# JSONPath Lens

A Chrome extension that beautifies JSON API responses and lets you query them with **JSONPath plus regular expressions**. It is built to handle payloads of tens of megabytes.

![JSONPath Lens icon](public/logo.png)

- **JSON tabs.** Open an API URL (a GET in the address bar) and the raw response becomes a searchable tree. This covers `application/json`, `*+json`, `text/plain` JSON and NDJSON.
- **DevTools panel.** A **JSONPath Lens** tab in DevTools lists the JSON fetch/XHR responses of any page and opens them in the same viewer.
- **Workspace.** A full tab where you can paste JSON, drop or open a file, or **Load URL** (a GET request with custom headers, optionally sending your cookies).

To install it, see **[INSTALL.md](INSTALL.md)**.

## Querying

The query bar takes **JSONPath** when the input starts with `$`, and runs a **quick search** for anything else.

| Query                                            | Returns                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `$.array[?(@.key==2)].dictionary.a`              | `a` of the items whose `key` is 2                                                        |
| `$..id`                                          | every `id`, at any depth                                                                 |
| `$.items[?@.price > 10 && @.tags[?@ == 'sale']]` | items over 10 that are tagged `sale`                                                     |
| `$..[?search(@.email, 'gmail')]`                 | objects anywhere whose `email` contains "gmail" (standard RFC 9535 function)             |
| `$.users[?match(@.name, 'bob')]`                 | exact match of the whole value (standard RFC 9535 function)                              |
| `$.users[?@.name =~ /^and/i]`                    | **regex with flags**, a JSONPath Lens extension. It runs as `regex(@.name, '^and', 'i')` |
| `$[?@.level == 'ERROR']`                         | NDJSON: each line is one item of the root array                                          |
| `player-123`                                     | quick search: keys and/or values containing the text                                     |
| `^\w+@gmail\.com$` with **.\*** on               | quick search with a regular expression                                                   |

JSONPath follows [RFC 9535](https://www.rfc-editor.org/rfc/rfc9535), using [json-p3](https://github.com/jg-rp/json-p3). `=~` is the one non-standard addition: it gives you full JavaScript regular expressions with flags and lookarounds. A hint under the query bar shows the standard function call each `=~` is turned into.

### In the viewer

- Matches are highlighted in the tree and their parents are expanded automatically. The right-hand pane lists each match with its path; click one to jump to it.
- **Enter** / **Shift+Enter** go to the next / previous match, **Esc** clears the query, and **/** focuses the query bar.
- **History** lists the queries you ran on the current document; click one to run it again. With the bar empty, **↑ / ↓** step through it. History is kept in memory for each tab, workspace document and DevTools request, and is gone after a reload.
- Hover a row and click **path** to copy its JSONPath (`$.items[3].price`, or `$['odd key'][0]` for keys that aren't plain identifiers), or **value** to copy its JSON. **⌘/Ctrl+C** copies the selected node.
- The keyboard works in the tree: arrows move and expand/collapse, **Enter** toggles a node, **Shift+Enter** or **Alt+click** toggles recursively.
- **Text** view shows the document pretty-printed or exactly as received. **Copy** and **Download** copy or save the whole document; **Copy results** copies the matched values as a JSON array.
- Integers larger than 2^53 (for example 64-bit IDs) keep their exact digits for display, copy and download.
- The theme follows the system setting. You can switch it to light or dark from the toolbar or the Options page.

## How it works

```
JSON tab (content script) ─┐
DevTools panel ────────────┼─► shared viewer UI (Preact) ◄──► Web Worker
Workspace tab ─────────────┘   query bar · virtual tree ·      parse → flat typed-array index
                               results · text view             → visible rows · JSONPath · search
```

- The **worker owns the document.** The UI only asks it for the ~60 rows on screen, so a 50 MB response stays responsive. A 50 MB payload with 2.5 M nodes parses and indexes in about 1.3 s; typical JSONPath filters then run in 0.2–0.5 s (`pnpm bench`).
- **Big integers** are kept by wrapping their literals in placeholders before `JSON.parse`. This is about 8× faster than using a reviver. They are written back out with `JSON.rawJSON`.
- **JSON tabs.** The content script hands the response text to an extension iframe through `postMessage`, transferring the buffer instead of copying it. Responses served with `Content-Security-Policy: sandbox` can't host an iframe, so for those the viewer opens in the tab itself. The background service worker passes the text along with a one-time token.
- **Stop.** A query that runs too long (for example a catastrophic regex) shows a **Stop** button. It replaces the worker and reloads the document.

## Project layout

```
entrypoints/        WXT entry points: background, content script, viewer, workspace,
                    devtools (+ panel), options
src/core/           pure TypeScript engine (parse, index, tree, query, serialize) — unit tested
src/worker/         worker + typed message protocol
src/ui/             Preact components shared by all pages, styles, settings
src/shared/         messages, IndexedDB helper, settings shape
src/workspace/      Load URL helper
tests/unit          Vitest
tests/e2e           Playwright (loads the built extension in headless Chromium)
scripts/            benchmark, icon generator
```

## Scripts

| Command                                      | What it does                                 |
| -------------------------------------------- | -------------------------------------------- |
| `pnpm dev`                                   | Chrome with the extension and live reload    |
| `pnpm build`                                 | Production build → `.output/chrome-mv3`      |
| `pnpm zip`                                   | Zipped build                                 |
| `pnpm test`                                  | Unit tests                                   |
| `pnpm e2e`                                   | End-to-end tests (builds first)              |
| `pnpm compile` / `pnpm lint` / `pnpm format` | Type check / ESLint / Prettier               |
| `pnpm bench`                                 | Timings on generated 50 and 100 MB documents |

## Privacy

Everything runs locally. The extension has no analytics and no remote code, and it makes no network requests of its own; the only ones it makes are **Load URL**, **Re-fetch**, and showing CSP-sandboxed responses that are too big to hand over (over about 25 M characters). The workspace keeps the last pasted or opened document in the extension's IndexedDB so it can be restored. URL loads and DevTools hand-offs are never stored, and request headers are never saved.

## Known limitations

- JSONPath compares numbers as doubles. Filters such as `== 12345678901234567890` can't tell apart integers that differ beyond 2^53, even though they are displayed exactly.
- `=~` is rewritten with a regular expression over the query text, so a literal string that itself contains `@.x =~ /…/` is rewritten too.
- The DevTools panel only sees requests made while DevTools is open, which is a Chrome limitation.
- **Load URL** supports GET only for now.
