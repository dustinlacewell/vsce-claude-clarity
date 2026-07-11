#!/usr/bin/env node
// Idempotently append the Claude Code status badge shim to the installed VS Code
// extension's webview bundle. Rerun after every extension update (updates
// overwrite webview/index.js and silently drop the patch).
//
//   node apply.mjs            # install / update the shim
//   node apply.mjs --remove   # strip the shim back out
//
// Then run "Developer: Reload Window" in VS Code.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const START = "/*__CC_STATUS_BADGE_START__*/";
const END = "/*__CC_STATUS_BADGE_END__*/";

const here = dirname(fileURLToPath(import.meta.url));
const remove = process.argv.includes("--remove");
const shim = remove ? "" : readFileSync(join(here, "badge.js"), "utf8");

const extRoot = join(os.homedir(), ".vscode", "extensions");
if (!existsSync(extRoot)) {
  console.error("No VS Code extensions dir: " + extRoot);
  process.exit(1);
}

const dirs = readdirSync(extRoot).filter((d) => d.startsWith("anthropic.claude-code-"));
if (!dirs.length) {
  console.error("No Claude Code extension found under " + extRoot);
  process.exit(1);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockRe = new RegExp(escapeRe(START) + "[\\s\\S]*?" + escapeRe(END));

// The shim needs the VS Code API handle to send requests (acquireVsCodeApi is
// once-only, the app owns it) — so expose the app's copy on window.__ccVsc.
const API_ORIG = "let e=acquireVsCodeApi(),";
const API_PATCHED = "let e=(window.__ccVsc=acquireVsCodeApi()),";

let count = 0;
for (const d of dirs) {
  const f = join(extRoot, d, "webview", "index.js");
  if (!existsSync(f)) {
    console.warn("skip (no webview/index.js): " + d);
    continue;
  }
  let src = readFileSync(f, "utf8");
  const had = blockRe.test(src);
  src = src.replace(blockRe, "").replace(/\s+$/, "");
  src = src.split(API_PATCHED).join(API_ORIG);
  if (!remove) {
    if (src.includes(API_ORIG)) {
      src = src.replace(API_ORIG, API_PATCHED);
    } else {
      console.warn(
        "WARN " + d + ": acquireVsCodeApi anchor not found — usage polling disabled " +
        "(bars update only on host pushes). The bundle layout likely changed."
      );
    }
    src += "\n" + START + '\n(function(){\n"use strict";\n' + shim + "\n})();\n" + END + "\n";
  }
  writeFileSync(f, src);
  count++;
  const verb = remove ? "removed from" : had ? "updated" : "patched";
  console.log(verb + ": " + d);
}

console.log(`\nDone (${count}). Run "Developer: Reload Window" in VS Code to apply.`);
