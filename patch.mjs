// The patch itself: pure string → string transforms over the Claude Code
// webview bundle, plus discovery of the installed extension. No I/O side
// effects beyond reading src/ to assemble the shim, so both the CLI
// (apply.mjs) and the companion VS Code extension drive the same code.
//
// Support model is latest-or-bust: the anchors match the shape of the current
// bundle. When Claude Code changes that shape, an anchor misses — that is a
// reported failure, not something to work around.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

export const START = "/*__CC_STATUS_BADGE_START__*/";
export const END = "/*__CC_STATUS_BADGE_END__*/";

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

export function buildShim(srcDir = join(here, "src")) {
  const body = SRC_ORDER.map((f) => readFileSync(join(srcDir, f), "utf8")).join("\n");
  return "\n" + START + '\n(function(){\n"use strict";\n' + body + "\n})();\n" + END + "\n";
}

// ---------------------------------------------------------------- anchors ----

// The input footer's render reads the session's usageData for the app's own
// context pie — tap that expression so the displayed session lands in
// window.__ccActiveSession. The regex tolerates the minified names of the JSX
// factory, the component, and the session variable changing between extension
// versions (2.1.241: `b(Rlt,{usedTokens:e.` — 2.1.257: `D(A$0,{usedTokens:$.`).
// Minified identifiers may be `$`, which `\w` does not match.
const ID = "[\\w$]+";
const ACTIVE_RE = new RegExp(
  `(${ID})\\((${ID}),\\{usedTokens:(${ID})\\.usageData\\.value\\.totalTokens`,
  "g"
);
const ACTIVE_SUB = "$1($2,{usedTokens:(window.__ccActiveSession=$3).usageData.value.totalTokens";
const ACTIVE_PATCHED_RE = new RegExp(
  `(${ID})\\((${ID}),\\{usedTokens:\\(window\\.__ccActiveSession=(${ID})\\)\\.usageData\\.value\\.totalTokens`,
  "g"
);
const ACTIVE_UNSUB = "$1($2,{usedTokens:$3.usageData.value.totalTokens";

// The "share current selection with Claude" toggle. The composer defaults it
// on and never clears it, so a selection keeps riding along on every later
// message. Default it off, and reset it after each send so an explicit toggle
// applies to exactly one message.
//
// Minified names are stable within a build but not across them, so both edits
// are located structurally: the useState pair feeding includeSelection, and
// the submit handler's read of it.
const SELECTION_STATE_RE =
  /includeSelection:(\w+),onToggleIncludeSelection:\(\)=>(\w+)\(\((\w+)\)=>!\3\)/;

function patchSelectionToggle(src) {
  const m = src.match(SELECTION_STATE_RE);
  if (!m) return { src, ok: false };
  const stateVar = m[1]; // includeSelection value
  const setter = m[2]; // its setState

  // 1) default off: `[C,y]=ne(!0)` → `[C,y]=ne(!1)`
  const declRe = new RegExp("\\[" + stateVar + "," + setter + "\\]=(\\w+)\\(!0\\)");
  if (!declRe.test(src)) return { src, ok: false };
  src = src.replace(declRe, "[" + stateVar + "," + setter + "]=$1(!1)");

  // 2) reset after send: the submit handler computes `ct=C&&!Re` then sends.
  const useRe = new RegExp("(let (\\w+)=" + stateVar + "&&!(\\w+);)");
  if (!useRe.test(src)) return { src, ok: false };
  src = src.replace(useRe, "$1" + setter + "(!1);");
  return { src, ok: true };
}

// Undo both: restore the `!0` default and drop the injected reset call.
function unpatchSelectionToggle(src) {
  const m = src.match(SELECTION_STATE_RE);
  if (!m) return src;
  const stateVar = m[1];
  const setter = m[2];
  src = src.replace(
    new RegExp("(let (\\w+)=" + stateVar + "&&!(\\w+);)" + setter + "\\(!1\\);"),
    "$1"
  );
  return src.replace(
    new RegExp(
      "\\[" + stateVar + "," + setter + "\\]=(\\w+)\\(!1\\)(,\\[\\w+,\\w+\\]=\\w+\\(!1\\))"
    ),
    "[" + stateVar + "," + setter + "]=$1(!0)$2"
  );
}

// The app's own model button in the input footer. The badge's model × effort
// grid replaces it, so hide it. Located structurally: the footer assigns the
// button element to a local (`let e0=D(Q$0,{label:c,isOpen:W.isOpen,
// onToggle:W.onToggle,buttonRef:F,...})`) and mounts it as `M!==2&&e0`
// (M is the responsive fit stage). Prefix the mount with `!1&&` so the
// element is never rendered; the dropdown component stays, unopened.
const MODEL_BUTTON_DECL_RE = new RegExp(
  `let (${ID})=${ID}\\(${ID},\\{label:${ID},isOpen:(${ID})\\.isOpen,onToggle:\\2\\.onToggle,buttonRef:`
);

function patchModelSwitcher(src) {
  const m = src.match(MODEL_BUTTON_DECL_RE);
  if (!m) return { src, ok: false };
  const button = m[1];
  const mountRe = new RegExp(`(${ID})!==2&&${escapeRe(button)},`);
  if (!mountRe.test(src)) return { src, ok: false };
  return { src: src.replace(mountRe, `!1&&$1!==2&&${button},`), ok: true };
}

function unpatchModelSwitcher(src) {
  const m = src.match(MODEL_BUTTON_DECL_RE);
  if (!m) return src;
  const button = m[1];
  return src.replace(
    new RegExp(`!1&&(${ID})!==2&&${escapeRe(button)},`),
    `$1!==2&&${button},`
  );
}

// The permission-mode button renders icon + label
// (`children:[X?M.iconV2Small:M.icon,D("span",{children:M.label})]`). Gate the
// label with `!1&&` so the button is icon-only like its neighbours; the
// tooltip still carries the mode description.
const PERMISSION_LABEL_RE = new RegExp(
  `(children:\\[${ID}\\?(${ID})\\.iconV2Small:\\2\\.icon,)(${ID}\\("span",\\{children:\\2\\.label\\}\\)\\])`
);
const PERMISSION_LABEL_PATCHED_RE = new RegExp(
  `(children:\\[${ID}\\?(${ID})\\.iconV2Small:\\2\\.icon,)!1&&(${ID}\\("span",\\{children:\\2\\.label\\}\\)\\])`
);

function patchPermissionLabel(src) {
  if (!PERMISSION_LABEL_RE.test(src)) return { src, ok: false };
  return { src: src.replace(PERMISSION_LABEL_RE, "$1!1&&$3"), ok: true };
}

function unpatchPermissionLabel(src) {
  return src.replace(PERMISSION_LABEL_PATCHED_RE, "$1$3");
}

// The Remote Control pill renders icon + `"Remote Control"` label in two
// branches (connected link; connecting/error status). Gate both labels with
// `!1&&` so the pill is icon-only; the shim CSS collapses its padding.
const REMOTE_LABEL_RE = new RegExp(`(\\(${ID},\\{\\}\\),)(${ID}\\("span",\\{children:"Remote Control"\\}\\))`, "g");
const REMOTE_LABEL_PATCHED_RE = new RegExp(
  `(\\(${ID},\\{\\}\\),)!1&&(${ID}\\("span",\\{children:"Remote Control"\\}\\))`,
  "g"
);

function patchRemoteLabel(src) {
  REMOTE_LABEL_RE.lastIndex = 0;
  if (!REMOTE_LABEL_RE.test(src)) return { src, ok: false };
  REMOTE_LABEL_RE.lastIndex = 0;
  return { src: src.replace(REMOTE_LABEL_RE, "$1!1&&$2"), ok: true };
}

function unpatchRemoteLabel(src) {
  REMOTE_LABEL_PATCHED_RE.lastIndex = 0;
  return src.replace(REMOTE_LABEL_PATCHED_RE, "$1$2");
}

// The connected Remote Control pill is a link to claude.ai/code. Make it a
// toggle instead: gate the href with `!1&&` (preact drops a false attribute)
// and add an onClick that calls the session's toggleRemoteControl(), the same
// call the /remote-control command makes. The component receives the session
// as its `session` prop, so capture that local for the click handler.
const REMOTE_LINK_RE = new RegExp(
  `(\\{session:(${ID})\\}\\)\\{[\\s\\S]{0,400}?)href:(${ID}\\(${ID}\\.sessionUrl\\)),target:"_blank",rel:"noopener noreferrer",` +
  `("aria-label":"Remote Control",)title:"Remote Control is active · Click to open claude\\.ai/code · Run /remote-control to turn off"`
);
const REMOTE_LINK_PATCHED_RE = new RegExp(
  `(\\{session:(${ID})\\}\\)\\{[\\s\\S]{0,400}?)href:!1&&(${ID}\\(${ID}\\.sessionUrl\\)),target:"_blank",rel:"noopener noreferrer",` +
  `onClick:\\(ev\\)=>\\{ev\\.preventDefault\\(\\);\\2\\.toggleRemoteControl\\(\\)\\},` +
  `("aria-label":"Remote Control",)title:"Remote Control is active · Click to turn off"`
);

function patchRemoteLink(src) {
  if (!REMOTE_LINK_RE.test(src)) return { src, ok: false };
  return {
    src: src.replace(
      REMOTE_LINK_RE,
      '$1href:!1&&$3,target:"_blank",rel:"noopener noreferrer",' +
        "onClick:(ev)=>{ev.preventDefault();$2.toggleRemoteControl()}," +
        '$4title:"Remote Control is active · Click to turn off"'
    ),
    ok: true,
  };
}

function unpatchRemoteLink(src) {
  return src.replace(
    REMOTE_LINK_PATCHED_RE,
    '$1href:$3,target:"_blank",rel:"noopener noreferrer",' +
      '$4title:"Remote Control is active · Click to open claude.ai/code · Run /remote-control to turn off"'
  );
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

// --------------------------------------------------------------- transform ----

export function isPatched(src) {
  return src.includes(START);
}

export function stripShim(src) {
  const blockRe = new RegExp(escapeRe(START) + "[\\s\\S]*?" + escapeRe(END));
  src = src.replace(blockRe, "").replace(/\s+$/, "");
  for (const p of LEGACY_API_PATCHES) src = src.split(p).join(API_ORIG);
  src = unpatchSelectionToggle(src);
  src = unpatchModelSwitcher(src);
  src = unpatchPermissionLabel(src);
  src = unpatchRemoteLabel(src);
  src = unpatchRemoteLink(src);
  return src.replace(ACTIVE_PATCHED_RE, ACTIVE_UNSUB);
}

// Patch a pristine (or freshly stripped) bundle. Returns the new source plus
// the per-anchor outcome, so callers can report a miss instead of silently
// shipping a half-working badge.
export function applyShim(src, srcDir) {
  const misses = [];

  const sel = patchSelectionToggle(src);
  src = sel.src;
  if (!sel.ok) misses.push("share-selection toggle");

  const sw = patchModelSwitcher(src);
  src = sw.src;
  if (!sw.ok) misses.push("model switcher button");

  const perm = patchPermissionLabel(src);
  src = perm.src;
  if (!perm.ok) misses.push("permission-mode button label");

  const rc = patchRemoteLabel(src);
  src = rc.src;
  if (!rc.ok) misses.push("remote-control pill label");

  const rl = patchRemoteLink(src);
  src = rl.src;
  if (!rl.ok) misses.push("remote-control pill link");

  ACTIVE_RE.lastIndex = 0;
  if (ACTIVE_RE.test(src)) {
    ACTIVE_RE.lastIndex = 0;
    src = src.replace(ACTIVE_RE, ACTIVE_SUB);
  } else {
    misses.push("session handle (input-footer usageData)");
  }

  return { src: src + buildShim(srcDir), misses };
}

// Strip-then-apply: the only safe way to re-patch, since a patched bundle's
// anchors are already consumed.
export function repatch(src, srcDir) {
  return applyShim(stripShim(src), srcDir);
}

// -------------------------------------------------------------- discovery ----

export function extensionsRoot() {
  return join(os.homedir(), ".vscode", "extensions");
}

// Every installed Claude Code extension dir, newest version first. VS Code
// keeps older versions on disk until it prunes them, so "newest" is the one
// actually loaded.
export function findClaudeCodeInstalls(root = extensionsRoot()) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => d.startsWith("anthropic.claude-code-"))
    .map((dir) => ({
      dir,
      path: join(root, dir),
      version: dir.slice("anthropic.claude-code-".length),
      bundle: join(root, dir, "webview", "index.js"),
    }))
    .filter((i) => existsSync(i.bundle))
    .sort((a, b) => compareVersions(b.version, a.version));
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10);
    const nb = parseInt(pb[i], 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      if ((pa[i] || "") !== (pb[i] || "")) return (pa[i] || "") < (pb[i] || "") ? -1 : 1;
      continue;
    }
    if (na !== nb) return na - nb;
  }
  return 0;
}
