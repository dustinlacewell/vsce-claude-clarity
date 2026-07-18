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
// The shim body is assembled from src/*.js (SRC_ORDER) and appended as one
// IIFE between START/END markers. One anchor patch is applied besides the
// appended block: the input-footer render is rewritten to expose the
// displayed session as window.__ccActiveSession — the single handle through
// which the shim reads state and issues the app's own queries and setters.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const START = "/*__CC_STATUS_BADGE_START__*/";
const END = "/*__CC_STATUS_BADGE_END__*/";

// Concatenation order: consts must be defined before eval-time use.
const SRC_ORDER = [
  "debug.js",
  "state.js",
  "format.js",
  "session.js",
  "usage.js",
  "popup.js",
  "badge.js",
  "main.js",
];

const here = dirname(fileURLToPath(import.meta.url));
const remove = process.argv.includes("--remove");

function buildShim() {
  const body = SRC_ORDER.map((f) => readFileSync(join(here, "src", f), "utf8")).join("\n");
  return "\n" + START + '\n(function(){\n"use strict";\n' + body + "\n})();\n" + END + "\n";
}

// Anchor: the input footer's render reads the session's usageData for the
// app's own context pie — tap that expression so the displayed session lands
// in window.__ccActiveSession. The regex tolerates the minified component
// name changing between extension versions.
const ACTIVE_RE = /b\((\w+),\{usedTokens:e\.usageData\.value\.totalTokens/g;
const ACTIVE_SUB = "b($1,{usedTokens:(window.__ccActiveSession=e).usageData.value.totalTokens";
const ACTIVE_PATCHED_RE =
  /b\((\w+),\{usedTokens:\(window\.__ccActiveSession=e\)\.usageData\.value\.totalTokens/g;
const ACTIVE_UNSUB = "b($1,{usedTokens:e.usageData.value.totalTokens";

// Legacy: earlier shim versions also wrapped acquireVsCodeApi for a
// postMessage handle (usage pokes, host-log diagnostics). No longer used —
// strip every historical variant from patched installs.
const API_ORIG = "let e=acquireVsCodeApi(),";
const LEGACY_API_PATCHES = [
  "let e=(window.__ccVsc=((a)=>({" +
    "postMessage:(m)=>a.postMessage(m)," +
    "setState:(s)=>a.setState(s),getState:()=>a.getState()" +
    "}))(acquireVsCodeApi())),",
  "let e=(window.__ccVsc=((a)=>({" +
    "postMessage:(m)=>{try{window.__ccBadgeTx&&window.__ccBadgeTx(m)}catch(_){}return a.postMessage(m)}," +
    "setState:(s)=>a.setState(s),getState:()=>a.getState()" +
    "}))(acquireVsCodeApi())),",
  "let e=(window.__ccVsc=acquireVsCodeApi()),",
];

function stripShim(src) {
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRe = new RegExp(escapeRe(START) + "[\\s\\S]*?" + escapeRe(END));
  src = src.replace(blockRe, "").replace(/\s+$/, "");
  for (const p of LEGACY_API_PATCHES) src = src.split(p).join(API_ORIG);
  return src.replace(ACTIVE_PATCHED_RE, ACTIVE_UNSUB);
}

function applyShim(src, extName) {
  ACTIVE_RE.lastIndex = 0;
  if (ACTIVE_RE.test(src)) {
    ACTIVE_RE.lastIndex = 0;
    src = src.replace(ACTIVE_RE, ACTIVE_SUB);
  } else {
    console.warn(
      "WARN " + extName + ": input-footer usageData anchor not found — the badge " +
      "cannot reach the session (no data, no popup). The bundle layout likely changed."
    );
  }
  return src + buildShim();
}

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

let count = 0;
for (const d of dirs) {
  const f = join(extRoot, d, "webview", "index.js");
  if (!existsSync(f)) {
    console.warn("skip (no webview/index.js): " + d);
    continue;
  }
  const orig = readFileSync(f, "utf8");
  const had = orig.includes(START);
  let src = stripShim(orig);
  if (!remove) src = applyShim(src, d);
  writeFileSync(f, src);
  count++;
  console.log((remove ? "removed from" : had ? "updated" : "patched") + ": " + d);
}

console.log(`\nDone (${count}). Run "Developer: Reload Window" in VS Code to apply.`);
