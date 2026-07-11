# vsce-claude-clarity

Adds a status readout to the Claude Code VS Code extension's chat input row: current model, context usage, and both rate-limit windows.

```
[+] [/] [pie]   Fable 5  ctx ▓▓▓░░  5h ▓▓░░░ 1h47m  wk ▓▓▓▓░ Tue   [mode] [send]
```

- **ctx** — context tokens against a 200k cap, orange past 90%
- **5h** — session rate-limit window, with time until it resets
- **wk** — weekly rate-limit window, with the day it resets

Hover any bar for exact numbers.

## Install

```
node apply.mjs
```

Then run `Developer: Reload Window` in VS Code. To uninstall:

```
node apply.mjs --remove
```

**Extension updates silently remove the patch** — rerun `node apply.mjs` after each one.

## How it works

The extension's chat UI is a webview loaded from plain files on disk (`~/.vscode/extensions/anthropic.claude-code-*/webview/index.js`). `apply.mjs` appends `badge.js` to that bundle as an IIFE, between sentinel comments so reapplying and removing are idempotent. It also makes one inline edit: exposing the app's `acquireVsCodeApi()` handle on `window.__ccVsc` so the badge can talk to the extension host.

The badge gets its data from the same channels the app uses:

- **Live turns** — per-event `io_message` stream messages carry `usage` (context tokens) and `model`.
- **Window reload** — the transcript comes back as one `get_session_request` response; the badge replays it.
- **Rate limits** — `usage_update` pushes from the host, plus active `request_usage_update` polling on load and every 5 minutes. Last-known values persist in `localStorage` so bars render immediately.

A `MutationObserver` re-inserts the badge whenever the UI re-renders over it.

## Caveats

Selectors and message shapes are anchored to the bundle they were reverse-engineered from (2.1.198). A future extension version can rename the CSS-module classes or change the protocol; `apply.mjs` warns when its anchors stop matching. Diagnostics live at `window.__ccBadge` in the webview devtools console.
