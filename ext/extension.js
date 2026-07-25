// Claude Clarity — keeps the Claude Code extension's webview bundle patched.
//
// Claude Code updates overwrite webview/index.js, silently dropping the shim.
// This extension re-applies it: on startup, on command, and whenever the
// extensions directory changes (a Marketplace update lands as a new versioned
// directory on disk; vscode.extensions.onDidChange does not reliably fire for
// that).
//
// Support model is latest-or-bust. The anchors match the current bundle shape;
// when Claude Code changes it, an anchor misses. That surfaces as a visible
// warning telling the user this extension needs an update — never a silent
// no-op that leaves a broken badge.

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");

// patch.mjs is ESM; the extension host loads us as CommonJS. Dynamic import
// bridges the two so there is exactly one copy of the patch logic.
const patchModule = (() => {
  let p = null;
  return () => (p ||= import(require("node:url").pathToFileURL(path.join(__dirname, "patch.mjs")).href));
})();

const SRC_DIR = () => path.join(__dirname, "src");
const LAST_PATCHED_KEY = "claudeClarity.lastPatched";

let status = null;
let watcher = null;
let output = null;

function log(msg) {
  output.appendLine(new Date().toISOString() + "  " + msg);
}

// ------------------------------------------------------------------ patch ----

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Write through a temp file: a torn write to the bundle bricks Claude Code
// until reinstall. The .orig backup is taken once, from the pristine source,
// so restore always has a clean target even after repeated re-patching.
//
// On Windows, renaming onto a file that another process has open (an AV
// scanner, an indexer, a still-loading webview) fails with EPERM — usually
// for a moment, not forever. Retry briefly before giving up.
async function writeBundle(bundle, contents) {
  const tmp = bundle + ".cc-tmp";
  fs.writeFileSync(tmp, contents);
  const attempts = 5;
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.renameSync(tmp, bundle);
      return;
    } catch (e) {
      if (e.code !== "EPERM" && e.code !== "EBUSY") throw e;
      if (i === attempts) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
        throw e;
      }
      await sleep(200 * i);
    }
  }
}

function backupPath(bundle) {
  return bundle + ".orig";
}

async function patchInstall(inst, { remove = false } = {}) {
  const patch = await patchModule();
  const src = fs.readFileSync(inst.bundle, "utf8");
  const was = patch.isPatched(src);
  const stripped = patch.stripShim(src);

  if (remove) {
    if (!was) return { inst, action: "clean", misses: [] };
    await writeBundle(inst.bundle, stripped);
    return { inst, action: "removed", misses: [] };
  }

  // Back up the pristine bundle before the first write to it.
  const backup = backupPath(inst.bundle);
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, stripped);

  const { src: patched, misses } = patch.applyShim(stripped, SRC_DIR());
  if (misses.length) {
    // Leave the bundle untouched rather than shipping a half-patched one.
    if (was) await writeBundle(inst.bundle, stripped);
    return { inst, action: "failed", misses };
  }
  await writeBundle(inst.bundle, patched);
  return { inst, action: was ? "updated" : "patched", misses: [] };
}

// -------------------------------------------------------------- run + report ----

async function run(context, { remove = false, silent = false } = {}) {
  const patch = await patchModule();
  const installs = patch.findClaudeCodeInstalls();

  if (!installs.length) {
    setStatus(null, "Claude Code not installed");
    if (!silent)
      vscode.window.showWarningMessage(
        "Claude Clarity: no Claude Code extension found under " + patch.extensionsRoot()
      );
    return;
  }

  const results = [];
  for (const inst of installs) {
    try {
      results.push(await patchInstall(inst, { remove }));
    } catch (e) {
      log("error patching " + inst.dir + ": " + (e && e.stack ? e.stack : e));
      results.push({ inst, action: "error", misses: [String(e && e.message ? e.message : e)] });
    }
  }

  for (const r of results)
    log(r.action + " " + r.inst.dir + (r.misses.length ? " — " + r.misses.join(", ") : ""));

  report(context, installs[0], results, { remove, silent });
}

// The newest install is the one VS Code actually loads; its outcome drives
// what the user sees.
function report(context, current, results, { remove, silent }) {
  const primary = results.find((r) => r.inst.dir === current.dir) || results[0];
  const broken = results.filter((r) => r.action === "failed" || r.action === "error");

  if (broken.length) {
    const versions = broken.map((r) => r.inst.version).join(", ");
    setStatus("error", "Claude Clarity: needs an update for Claude Code " + versions);
    vscode.window
      .showErrorMessage(
        "Claude Clarity could not patch Claude Code " +
          versions +
          " — the bundle layout changed (" +
          broken[0].misses.join("; ") +
          "). Claude Code is unmodified; update Claude Clarity.",
        "Show Log"
      )
      .then((pick) => pick === "Show Log" && output.show());
    return;
  }

  if (remove) {
    setStatus(null, "Claude Clarity: patch removed");
    context.globalState.update(LAST_PATCHED_KEY, undefined);
    promptReload("Claude Clarity removed from Claude Code " + current.version + ".");
    return;
  }

  setStatus(null, "Claude Clarity: active on Claude Code " + current.version);

  // Reload is only needed when the bundle actually changed under a webview
  // that may already have loaded the old one.
  const stamp = current.dir;
  const changed = primary.action === "patched" || primary.action === "updated";
  const known = context.globalState.get(LAST_PATCHED_KEY);
  context.globalState.update(LAST_PATCHED_KEY, stamp);

  if (changed && !(silent && known === stamp))
    promptReload("Claude Clarity patched Claude Code " + current.version + ".");
}

function promptReload(message) {
  vscode.window
    .showInformationMessage(message + " Reload to apply.", "Reload Window")
    .then((pick) => {
      if (pick === "Reload Window")
        vscode.commands.executeCommand("workbench.action.reloadWindow");
    });
}

function setStatus(kind, text) {
  status.text = kind === "error" ? "$(warning) Claude Clarity" : "$(sparkle) Claude Clarity";
  status.tooltip = text;
  status.backgroundColor =
    kind === "error" ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
  if (kind === "error") status.show();
  else status.hide();
}

// ----------------------------------------------------------------- watching ----

// A Marketplace update materializes as a new anthropic.claude-code-<version>
// directory. Watch the extensions root for that, debounced — the install
// writes many files and we only want to act once it settles.
async function watchForUpdates(context) {
  const patch = await patchModule();
  const root = patch.extensionsRoot();
  if (!fs.existsSync(root)) return;

  let timer = null;
  let known = new Set(patch.findClaudeCodeInstalls().map((i) => i.dir));

  const w = fs.watch(root, { persistent: false }, (_evt, name) => {
    if (!name || !String(name).startsWith("anthropic.claude-code-")) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const p = await patchModule();
      const now = p.findClaudeCodeInstalls();
      const fresh = now.filter((i) => !known.has(i.dir));
      if (!fresh.length) return;
      known = new Set(now.map((i) => i.dir));
      log("new install detected: " + fresh.map((i) => i.dir).join(", "));
      if (vscode.workspace.getConfiguration("claudeClarity").get("autoPatch"))
        run(context, { silent: false });
    }, 3000);
  });

  watcher = w;
  context.subscriptions.push({ dispose: () => w.close() });
}

// ---------------------------------------------------------------- activate ----

function activate(context) {
  output = vscode.window.createOutputChannel("Claude Clarity");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  status.command = "claudeClarity.status";
  context.subscriptions.push(output, status);

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeClarity.apply", () => run(context)),
    vscode.commands.registerCommand("claudeClarity.remove", () =>
      run(context, { remove: true })
    ),
    vscode.commands.registerCommand("claudeClarity.status", () => output.show())
  );

  if (vscode.workspace.getConfiguration("claudeClarity").get("autoPatch"))
    run(context, { silent: true });

  watchForUpdates(context);
}

function deactivate() {
  if (watcher) watcher.close();
}

module.exports = { activate, deactivate };
