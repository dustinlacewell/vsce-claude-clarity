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

// The footer's selection chip renders icon + label ("12 lines selected" or the
// file name) inside a span that already carries the full text as its title
// (`title:\`Showing Claude your current file selection (${Z})\`,
// children:[F(QB0,{}),F("span",{children:Z})]`), followed by the X dismiss
// button. Gate the label with `!1&&` so the chip is icon-only; the tooltip
// keeps the text and the X still dismisses.
const SELECTION_CHIP_RE = new RegExp(
  `(title:\`Showing Claude your current file selection \\(\\$\\{(${ID})\\}\\)\`,children:\\[${ID}\\(${ID},\\{\\}\\),)` +
    `(${ID}\\("span",\\{children:\\2\\}\\)\\])`
);
const SELECTION_CHIP_PATCHED_RE = new RegExp(
  `(title:\`Showing Claude your current file selection \\(\\$\\{(${ID})\\}\\)\`,children:\\[${ID}\\(${ID},\\{\\}\\),)!1&&` +
    `(${ID}\\("span",\\{children:\\2\\}\\)\\])`
);

function patchSelectionChip(src) {
  if (!SELECTION_CHIP_RE.test(src)) return { src, ok: false };
  return { src: src.replace(SELECTION_CHIP_RE, "$1!1&&$3"), ok: true };
}

function unpatchSelectionChip(src) {
  return src.replace(SELECTION_CHIP_PATCHED_RE, "$1$3");
}

// The app's own model button in the input footer. The badge's model x effort
// grid replaces it, so hide it. Located structurally: the footer builds a
// shared props object (`let H0={label:r,effort:a,isOpen:B.isOpen,
// onToggle:()=>{...;B.onToggle()},buttonRef:K,...}`) and spreads it into the
// button component at two responsive fit stages: inline
// (`j!==2&&F(mA1,{...H0})`) and, at the narrow stage, its own row below the
// input (`j===2&&F("div",{className:...,children:F(mA1,{...H0,ownRow:!0})})`).
// Prefix both mounts with `!1&&` so neither renders; the dropdown component
// stays, unopened.
const MODEL_PROPS_DECL_RE = new RegExp(
  `let (${ID})=\\{label:${ID},effort:${ID},isOpen:${ID}\\.isOpen,onToggle:`
);

function patchModelSwitcher(src) {
  const m = src.match(MODEL_PROPS_DECL_RE);
  if (!m) return { src, ok: false };
  const props = m[1];
  const inlineRe = new RegExp(`(${ID})!==2&&(${ID}\\(${ID},\\{\\.\\.\\.${escapeRe(props)}\\}\\))`);
  const rowRe = new RegExp(
    `(${ID})===2&&(${ID}\\("div",\\{[\\s\\S]{0,80}?children:${ID}\\(${ID},\\{\\.\\.\\.${escapeRe(props)},ownRow:!0\\}\\)\\})`
  );
  if (!inlineRe.test(src) || !rowRe.test(src)) return { src, ok: false };
  src = src.replace(inlineRe, `!1&&$1!==2&&$2`);
  src = src.replace(rowRe, `!1&&$1===2&&$2`);
  return { src, ok: true };
}

function unpatchModelSwitcher(src) {
  const m = src.match(MODEL_PROPS_DECL_RE);
  if (!m) return src;
  const props = m[1];
  src = src.replace(
    new RegExp(`!1&&(${ID})!==2&&(${ID}\\(${ID},\\{\\.\\.\\.${escapeRe(props)}\\}\\))`),
    `$1!==2&&$2`
  );
  return src.replace(
    new RegExp(
      `!1&&(${ID})===2&&(${ID}\\("div",\\{[\\s\\S]{0,80}?children:${ID}\\(${ID},\\{\\.\\.\\.${escapeRe(props)},ownRow:!0\\}\\)\\})`
    ),
    `$1===2&&$2`
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
  `(\\{session:(${ID})\\}\\)\\{[\\s\\S]{0,700}?)href:(${ID}\\(${ID}\\.sessionUrl\\)),target:"_blank",rel:"noopener noreferrer",` +
  `("aria-label":"Remote Control",)title:"Remote Control is active · Click to open claude\\.ai/code · Run /remote-control to turn off"`
);
const REMOTE_LINK_PATCHED_RE = new RegExp(
  `(\\{session:(${ID})\\}\\)\\{[\\s\\S]{0,700}?)href:!1&&(${ID}\\(${ID}\\.sessionUrl\\)),target:"_blank",rel:"noopener noreferrer",` +
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

// Keep the Remote Control pill mounted while Remote Control is off, as a
// neutral (no pillOn tint) toggle that turns it on. Two anchors:
//  1) the footer only mounts the pill when status !== "disconnected" — gate
//     that test with `!0||`, leaving the remoteControlAvailable check intact;
//  2) the component returns null when disconnected — return the off pill
//     instead, built from the same factories and classes the connected
//     branch uses (captured from it). Between the two branches the
//     component declares its click logger (`let Z=()=>$.logEvent(...)`);
//     the off pill returns before that line, so it does not use it.
const REMOTE_MOUNT_RE = new RegExp(
  `(${ID})\\.remoteControlState\\.value\\.status!=="disconnected"&&\\(\\1\\.remoteControlState\\.value\\.status==="connected"\\|\\|`
);
const REMOTE_MOUNT_PATCHED_RE = new RegExp(
  `\\(!0\\|\\|(${ID})\\.remoteControlState\\.value\\.status!=="disconnected"\\)&&\\(\\1\\.remoteControlState\\.value\\.status==="connected"\\|\\|`
);
const REMOTE_OFF_RE = new RegExp(
  `(\\{session:(${ID})\\}\\)\\{${ID}\\(\\);let (${ID})=\\2\\.remoteControlState\\.value;if\\(\\3\\.status==="disconnected"\\)return )null;` +
    `(let ${ID}=\\(\\)=>\\2\\.logEvent\\([^;]{0,120}\\);` +
    `if\\(\\3\\.status==="connected"\\)return (${ID})\\("a",\\{className:\`\\$\\{(${ID})\\.pill\\} \\$\\{\\6\\.pillOn\\} \\$\\{\\6\\.pillLink\\}\`` +
    `[\\s\\S]{0,600}?children:\\[(${ID})\\((${ID}),\\{\\}\\))`
);
const REMOTE_OFF_TITLE = "Remote Control is off · Click to turn on";
const REMOTE_OFF_PATCHED_RE = new RegExp(
  `if\\((${ID})\\.status==="disconnected"\\)return ${ID}\\("a",\\{className:\`\\$\\{${ID}\\.pill\\} \\$\\{${ID}\\.pillLink\\}\`,` +
    `"aria-label":"Remote Control",title:"${REMOTE_OFF_TITLE}",` +
    `onClick:\\(ev\\)=>\\{ev\\.preventDefault\\(\\);${ID}\\.toggleRemoteControl\\(\\)\\},children:\\[${ID}\\(${ID},\\{\\}\\)\\]\\}\\);`
);

function patchRemoteOff(src) {
  if (!REMOTE_MOUNT_RE.test(src) || !REMOTE_OFF_RE.test(src)) return { src, ok: false };
  src = src.replace(
    REMOTE_MOUNT_RE,
    '(!0||$1.remoteControlState.value.status!=="disconnected")&&($1.remoteControlState.value.status==="connected"||'
  );
  src = src.replace(
    REMOTE_OFF_RE,
    "$1$5(\"a\",{className:`${$6.pill} ${$6.pillLink}`," +
      '"aria-label":"Remote Control",title:"' + REMOTE_OFF_TITLE + '",' +
      "onClick:(ev)=>{ev.preventDefault();$2.toggleRemoteControl()},children:[$7($8,{})]});$4"
  );
  return { src, ok: true };
}

function unpatchRemoteOff(src) {
  src = src.replace(REMOTE_OFF_PATCHED_RE, 'if($1.status==="disconnected")return null;');
  return src.replace(
    REMOTE_MOUNT_PATCHED_RE,
    '$1.remoteControlState.value.status!=="disconnected"&&($1.remoteControlState.value.status==="connected"||'
  );
}

// The footer's "Show command menu (/)" button. Typing `/` opens the same menu,
// so hide the button with `!1&&`.
const MENU_BUTTON_RE = new RegExp(
  `,(${ID}\\("button",\\{type:"button",className:${ID}\\.menuButton,title:"Show command menu \\(/\\)",)`
);
const MENU_BUTTON_PATCHED_RE = new RegExp(
  `,!1&&(${ID}\\("button",\\{type:"button",className:${ID}\\.menuButton,title:"Show command menu \\(/\\)",)`
);

function patchMenuButton(src) {
  if (!MENU_BUTTON_RE.test(src)) return { src, ok: false };
  return { src: src.replace(MENU_BUTTON_RE, ",!1&&$1"), ok: true };
}

function unpatchMenuButton(src) {
  return src.replace(MENU_BUTTON_PATCHED_RE, ",$1");
}

// The footer's agent-map pill (`function b$5({count:$,dot:J,onOpen:Z})`)
// renders an icon span, a status dot, and an "N agents" label span. The
// bundle's CSS shows the label only at fit stage 0; at stages 1 and 2 it hides
// the label and shows the icon (26px, negative margin, so it sits off the
// footer's baseline). The footer mounts the pill whenever the agent map has any
// entry, but `count` holds only the active agents, so the pill can show 0.
// Patch: return null when count is 0; gate the icon and label spans with
// `!1&&`; append a class-less span with the bare count, which no fit-stage rule
// hides. The dot, click handler, title and aria-label stay. The shim CSS
// (src/badge.js) restores the pill's padding, which the app zeroes at narrow
// stages for the icon.
const AGENTS_PILL_BODY =
  `(let (${ID})=${ID}\\(\\2\\),${ID}=${ID}\\(${ID}\\);return ${ID}\\("button",\\{type:"button",` +
  `className:\`\\$\\{${ID}\\.modelPill\\} \\$\\{(${ID})\\.agentsPill\\}\`,[\\s\\S]{0,120}?children:\\[)`;
const AGENTS_PILL_ICON = `(${ID}\\("span",\\{className:\\5\\.icon,children:${ID}\\(${ID},\\{\\}\\)\\}\\),)`;
const AGENTS_PILL_DOT = `(${ID}\\(${ID},\\{state:${ID},className:\\5\\.dot\\}\\),)`;
const AGENTS_PILL_LABEL = `((${ID})\\("span",\\{className:\\5\\.label,children:\\4\\}\\))`;
const AGENTS_PILL_RE = new RegExp(
  `(\\{count:(${ID}),dot:${ID},onOpen:${ID}\\}\\)\\{)` +
    AGENTS_PILL_BODY + AGENTS_PILL_ICON + AGENTS_PILL_DOT + AGENTS_PILL_LABEL
);
const AGENTS_PILL_PATCHED_RE = new RegExp(
  `(\\{count:(${ID}),dot:${ID},onOpen:${ID}\\}\\)\\{)if\\(!\\2\\)return null;` +
    AGENTS_PILL_BODY + "!1&&" + AGENTS_PILL_ICON + AGENTS_PILL_DOT + "!1&&" + AGENTS_PILL_LABEL +
    `,\\9\\("span",\\{children:\\2\\}\\)`
);

function patchAgentsPill(src) {
  if (!AGENTS_PILL_RE.test(src)) return { src, ok: false };
  return {
    src: src.replace(AGENTS_PILL_RE, '$1if(!$2)return null;$3!1&&$6$7!1&&$8,$9("span",{children:$2})'),
    ok: true,
  };
}

function unpatchAgentsPill(src) {
  return src.replace(AGENTS_PILL_PATCHED_RE, "$1$3$6$7$8");
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
  src = unpatchSelectionChip(src);
  src = unpatchModelSwitcher(src);
  src = unpatchPermissionLabel(src);
  src = unpatchMenuButton(src);
  src = unpatchAgentsPill(src);
  src = unpatchRemoteOff(src);
  src = unpatchRemoteLabel(src);
  src = unpatchRemoteLink(src);
  return src.replace(ACTIVE_PATCHED_RE, ACTIVE_UNSUB);
}

// Patch a pristine (or freshly stripped) bundle. Returns the new source plus
// the per-anchor outcome, so callers can report a miss instead of silently
// shipping a half-working badge.
export function applyShim(src, srcDir) {
  const misses = [];

  const sel = patchSelectionChip(src);
  src = sel.src;
  if (!sel.ok) misses.push("selection chip icon");

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

  const ro = patchRemoteOff(src);
  src = ro.src;
  if (!ro.ok) misses.push("remote-control pill off state");

  const mb = patchMenuButton(src);
  src = mb.src;
  if (!mb.ok) misses.push("command menu button");

  const ap = patchAgentsPill(src);
  src = ap.src;
  if (!ap.ok) misses.push("agent map count");

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
