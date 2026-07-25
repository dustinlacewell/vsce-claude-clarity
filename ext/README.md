# Claude Clarity

Puts the current model, context usage, and rate limits in the Claude Code extension's input row — and makes switching model and effort one click.

- **model · effort** — click the model name for a model × effort grid; click a cell to switch both at once (Ultra = the app's Ultracode toggle)
- **ctx** — context tokens against the usable window, orange past 90%
- **5h** — session rate limit, with time until reset
- **wk** — weekly rate limit, with reset day
- **fb** — the model-scoped Fable weekly quota, with reset day
- **share selection, one message at a time** — the "share current file/selection" button defaults off and resets to off right after each send, instead of the app's sticky-on default silently carrying a stale selection into later messages

Hover any bar for exact numbers.

Rate limits come from the same `get_usage` query the app's own `/usage` panel runs. Context, model, and effort are read from the app's own session state, so the badge always agrees with the app.

## How it works

This extension patches the installed Claude Code extension's webview bundle in place, then asks you to reload the window. It re-applies the patch automatically after Claude Code updates (updates overwrite the bundle and drop the patch).

The original bundle is backed up alongside it as `webview/index.js.orig` before the first write. `Claude Clarity: Remove Patch` restores Claude Code to its unmodified state.

## Compatibility

Latest-or-bust: the patch targets the current Claude Code bundle. When Claude Code changes shape, the patch is skipped — Claude Code is left unmodified and a status bar warning tells you Claude Clarity needs an update.

## Commands

- `Claude Clarity: Apply Patch`
- `Claude Clarity: Remove Patch`
- `Claude Clarity: Show Status` — opens the log

## Settings

- `claudeClarity.autoPatch` (default `true`) — patch on startup and after Claude Code updates.
