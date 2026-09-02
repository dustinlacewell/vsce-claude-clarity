#!/usr/bin/env node
// Idempotently install the Claude Code status badge shim into the installed
// VS Code extension's webview bundle. Rerun after every extension update
// (updates overwrite webview/index.js and silently drop the patch).
//
//   node apply.mjs            # install / update the shim
//   node apply.mjs --remove   # strip the shim back out
//
// Then run "Developer: Reload Window" in VS Code.
//
// The patch itself lives in patch.mjs, shared with the companion extension.

import { readFileSync, writeFileSync } from "node:fs";
import {
  isPatched,
  stripShim,
  applyShim,
  findClaudeCodeInstalls,
  extensionsRoot,
} from "./patch.mjs";

const remove = process.argv.includes("--remove");

const installs = findClaudeCodeInstalls();
if (!installs.length) {
  console.error("No Claude Code extension found under " + extensionsRoot());
  process.exit(1);
}

// Only the newest install is loaded by VS Code, so only it gets the shim.
// Older installs left on disk are stripped back to pristine: the anchors
// target the current bundle shape, so patching them would only report misses.
for (const [i, inst] of installs.entries()) {
  const orig = readFileSync(inst.bundle, "utf8");
  const had = isPatched(orig);
  const strip = remove || i > 0;
  let src = stripShim(orig);
  if (!strip) {
    const res = applyShim(src);
    src = res.src;
    for (const miss of res.misses)
      console.warn("WARN " + inst.dir + ": anchor missed — " + miss);
  }
  writeFileSync(inst.bundle, src);
  const verb = strip ? (had ? "removed from" : "clean") : had ? "updated" : "patched";
  console.log(verb + ": " + inst.dir + (i > 0 ? " (older install, not loaded)" : ""));
}

console.log(
  `\nDone (${installs.length}). Run "Developer: Reload Window" in VS Code to apply.`
);
