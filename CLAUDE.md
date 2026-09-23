# vsce-claude-clarity

A patcher for the Claude Code VS Code extension's webview bundle. Adds a
model x effort badge, context/rate-limit bars, and a few UI hides (model
switcher button, command menu button, permission label, remote control
pill tweaks) by regex-patching the minified `webview/index.js`.

## Two delivery paths, one source of truth

- `patch.mjs` (repo root) is the source of truth for every anchor regex.
- `apply.mjs` is the CLI path: it patches the installed
  `anthropic.claude-code-*` extension directly, in place, using root
  `patch.mjs`.
- `ext/` is a **separate VS Code extension** (`ldlework.claude-clarity`)
  that does the same patching from inside VS Code (status bar button,
  auto-patch on extension update). It ships its own copy of
  `patch.mjs` and `src/`, copied in by `ext/sync.mjs`.

**When Claude Code's bundle shape changes and an anchor needs fixing:**

1. Edit anchors in root `patch.mjs` only. Never hand-edit `ext/patch.mjs`
   — it is a build artifact, overwritten by sync.
2. Verify with `node apply.mjs` against the installed extension (fast
   iteration loop, no packaging).
3. Once anchors are confirmed working, **rebuild and reinstall the
   companion extension**: `npm run ext:install` (runs
   `sync.mjs` -> `vsce package` -> `code --install-extension`). This is
   the actual fix from the user's point of view, since they run the
   `ldlework.claude-clarity` VS Code extension day to day, not the CLI.
4. Reload the VS Code window to pick up the new `.vsix`.

Do not consider the task done after step 2. `node apply.mjs` patches the
*currently installed files on disk* — the next Claude Code update (or
even a same-version re-extraction) wipes that patch, and the companion
extension will keep re-applying its own *stale, unrebuilt* copy of
`patch.mjs` until `ext:install` has run.

## Support model

Anchors match the shape of the *current* Claude Code bundle only. When
Claude Code changes that shape, an anchor miss is a reported failure
(`WARN ... anchor missed`), not something to silently work around with a
fallback path.
