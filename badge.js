// Claude Code webview status badge.
// Injected into the chat input row (between the left and right button groups):
//   <model>   [ctx bar]   [5h bar + reset]   [wk bar + reset day]
//
// Context and model are read directly from the app's own session state — the
// applier patches the input-footer render to expose the displayed session as
// window.__ccActiveSession, so the badge always agrees with the app's context
// pie (compaction, model switches, reloads, replays: all the app's problem).
// Rate limits come from the host's usage_update pushes, plus polling.
//
// Toggle verbose logging at runtime: localStorage.setItem("cc-badge-debug","1")
//
// This file is the BODY of the shim; the applier wraps it in an IIFE.

const BADGE_ID = "cc-status-badge";
const SPACER2_ID = "cc-status-spacer2";
const STYLE_ID = "cc-badge-style";

const DEBUG = () => {
  try { return !!localStorage.getItem("cc-badge-debug"); } catch { return false; }
};

// ---------------------------------------------------------------- state ----
const state = {
  model: null,        // model slug, e.g. "claude-opus-4-8[1m]" or "default"
  used: null,         // context tokens (the app's usageData.totalTokens)
  cap: null,          // usable context (the app's pie denominator), null = unknown
  five: null,         // { util: 0..100|null, resets }
  week: null,         // { util, resets }
  rlError: null,      // error string from the host's usage fetch, if any
};

// Diagnostics surfaced in the badge tooltip so we can see what actually flows
// without opening webview devtools.
const cnt = { raw: 0, ext: 0, usg: 0, req: 0, types: {} };

// Live state exposed for one-shot inspection from the devtools console.
const dbg = (window.__ccBadge = { state, cnt, byType: {} });

// ------------------------------------------------------------ persistence ----
// usage_update is only pushed after activity — on a fresh reload nothing
// arrives until the startup poll answers, so show the last-known rate limits.
// Context/model need no persistence: the app restores its own session state.
const LS_KEY = "cc-badge-state";

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ five: state.five, week: state.week }));
  } catch {}
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (!s) return;
    if (s.five) state.five = s.five;
    if (s.week) state.week = s.week;
  } catch {}
}

// -------------------------------------------------- app session state poll ----
// The applier rewrites the footer render so the session whose input row is on
// screen lands in window.__ccActiveSession. Its fields are preact-ish signals
// (.value); we poll instead of subscribing to stay decoupled from the
// signal implementation.
const PIE_RESERVE = 13000; // the app reserves this many tokens in its pie math

function pollSession() {
  const s = window.__ccActiveSession;
  if (!s) return;
  try {
    const u = s.usageData && s.usageData.value;
    if (u && typeof u.totalTokens === "number") {
      state.used = u.totalTokens;
      state.cap = u.contextWindow
        ? Math.max(1, u.contextWindow - (u.maxOutputTokens || 0) - PIE_RESERVE)
        : null;
    }

    // What's actually serving beats the picker selection; the picker keeps
    // the [1m] variant suffix that served-model strings sometimes drop.
    const sel = s.modelSelection && s.modelSelection.value;
    const served = s.lastServedModel && s.lastServedModel.value;
    let slug = served || sel || (s.currentMainLoopModel && s.currentMainLoopModel.value) || null;
    if (slug && sel && /\[1m\]/i.test(sel) && !/\[1m\]/i.test(slug)) slug += "[1m]";
    if (slug) state.model = slug;
  } catch (e) {
    if (DEBUG()) console.log("[cc-badge] pollSession failed:", e);
  }
  scheduleRender();
}

// ---------------------------------------------------------- rate limits ----
function pickWindow(w) {
  if (!w || typeof w !== "object") return null;
  const util = typeof w.utilization === "number" ? w.utilization : null;
  return { util, resets: w.resets_at ?? w.resetsAt ?? null };
}

function ingest(msg) {
  if (!msg || typeof msg !== "object") return;
  cnt.ext++;
  if (typeof msg.type === "string") {
    cnt.types[msg.type] = (cnt.types[msg.type] || 0) + 1;
    if (!dbg.byType[msg.type]) dbg.byType[msg.type] = msg;
  }

  // The host wraps notifications as requests:
  // {type:"request", requestId, request:{type:"usage_update", utilization}}.
  if (msg.type === "request" && msg.request && msg.request.type === "usage_update") {
    cnt.usg++;
    dbg.lastUsage = msg.request;
    const u = msg.request.utilization;
    state.rlError = msg.request.error || null;
    if (u) {
      state.five = pickWindow(u.fiveHour);
      state.week = pickWindow(u.sevenDay);
      saveState();
    }
    scheduleRender();
  }
}

// ------------------------------------------------------------- formatting ----
function prettyModel(s) {
  if (!s) return "—";
  if (s === "default") return "Default";
  const big = /\[1m\]/i.test(s) ? " 1M" : "";
  const base = s.replace(/^claude-/, "").replace(/\[1m\]/i, "");
  const m = base.match(/(opus|sonnet|haiku|fable)-?(\d+)?-?(\d+)?/i);
  if (m) {
    const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const ver = [m[2], m[3]].filter(Boolean).join(".");
    return name + (ver ? " " + ver : "") + big;
  }
  return base + big;
}

function fmtK(n) {
  if (n == null) return "";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return "" + n;
}

function resetMs(r) {
  if (r == null) return NaN;
  return typeof r === "number" ? (r < 1e12 ? r * 1000 : r) : Date.parse(r);
}

function fmtReset(r) {
  const t = resetMs(r);
  if (isNaN(t)) return "";
  const d = t - Date.now();
  if (d <= 0) return "now";
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  return h ? h + "h" + m + "m" : m + "m";
}

function fmtResetDay(r) {
  const t = resetMs(r);
  if (isNaN(t)) return "";
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "today";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

const CTX_CAP_FALLBACK = 200000; // until the app learns the real window

function bar(pct, short, title, high, suffix) {
  const p = Math.min(100, Math.max(0, pct));
  return (
    '<span class="cc-barwrap" title="' + title + '">' +
    '<span class="cc-barlabel">' + short + "</span>" +
    '<span class="cc-bar"><span class="cc-fill' + (high ? " cc-fill-high" : "") +
    '" style="width:' + p + '%"></span></span>' +
    (suffix ? '<span class="cc-barlabel">' + suffix + "</span>" : "") +
    "</span>"
  );
}

function ctxBar() {
  if (state.used == null) return "";
  const cap = state.cap || CTX_CAP_FALLBACK;
  const pct = (state.used / cap) * 100;
  const title =
    "Context " + fmtK(state.used) + " / " + fmtK(cap) + " · " + Math.round(pct) + "%";
  return bar(pct, "ctx", title, pct >= 90);
}

// suffix: 5h shows time until the session window resets, wk shows the day.
function rateBar(w, label, short, suffixFn) {
  const util = w && typeof w.util === "number" ? w.util : null;
  const pct = util == null ? 0 : util;
  const suffix = w && w.resets ? suffixFn(w.resets) : "";
  const shown = Math.floor(Math.min(100, Math.max(0, pct)));
  const title =
    label + (util == null ? " (pending)" : " " + shown + "%") +
    (w && w.resets ? " · resets in " + fmtReset(w.resets) : "");
  return bar(pct, short, title, pct >= 80, suffix);
}

// ----------------------------------------------------------------- render ----
let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function render() {
  const el = document.getElementById(BADGE_ID);
  if (!el) return;
  const types = Object.keys(cnt.types).map((k) => k + ":" + cnt.types[k]).join("  ");
  el.title =
    "raw=" + cnt.raw + " ext=" + cnt.ext + " usg=" + cnt.usg + " req=" + cnt.req +
    " api=" + !!window.__ccVsc + " session=" + !!window.__ccActiveSession +
    " used=" + state.used + " cap=" + state.cap + " model=" + state.model +
    (state.rlError ? "\nusage error: " + state.rlError : "") + "\n" + types;
  el.querySelector(".cc-model").textContent = prettyModel(state.model);
  el.querySelector(".cc-bars").innerHTML =
    ctxBar() +
    rateBar(state.five, "Session (5h)", "5h", fmtReset) +
    rateBar(state.week, "Weekly", "wk", fmtResetDay);
}

// ---------------------------------------------------------------- inject ----
const CSS =
  "." + "cc-badge{display:flex;align-items:center;gap:8px;font-size:11px;line-height:1;" +
  "color:var(--app-secondary-foreground,#999);white-space:nowrap;min-width:0;overflow:hidden}" +
  ".cc-badge .cc-model{font-weight:600}" +
  ".cc-badge .cc-bars{display:flex;align-items:center;gap:8px}" +
  ".cc-badge .cc-barwrap{display:flex;align-items:center;gap:4px}" +
  ".cc-badge .cc-barlabel{opacity:.55;font-size:10px}" +
  ".cc-badge .cc-bar{position:relative;display:inline-block;width:34px;height:6px;border-radius:3px;" +
  "background:var(--app-input-border,#444);overflow:hidden}" +
  ".cc-badge .cc-fill{position:absolute;left:0;top:0;bottom:0;width:0;" +
  "background:var(--app-progressbar-background,#6b9bd1);transition:width .3s}" +
  ".cc-badge .cc-fill-high{background:var(--app-claude-orange,#d97757)}";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function makeBadge() {
  const el = document.createElement("div");
  el.id = BADGE_ID;
  el.className = "cc-badge";
  el.innerHTML =
    '<span class="cc-model"></span><span class="cc-bars"></span>';
  return el;
}

function inject() {
  const spacer =
    document.querySelector(".inputFooterV2_gGYT1w .spacer_gGYT1w") ||
    document.querySelector(".spacer_gGYT1w");
  if (!spacer) return;
  const row = spacer.parentElement;
  if (!row) return;

  ensureStyle();

  let badge = document.getElementById(BADGE_ID);
  if (!badge || badge.parentElement !== row) {
    if (badge) badge.remove();
    badge = makeBadge();
    spacer.insertAdjacentElement("afterend", badge);
    render();
  }

  // Second flex spacer keeps the badge centered between the two groups.
  let sp2 = document.getElementById(SPACER2_ID);
  if (!sp2 || sp2.parentElement !== row) {
    if (sp2) sp2.remove();
    sp2 = document.createElement("div");
    sp2.id = SPACER2_ID;
    sp2.style.flexGrow = "1";
    badge.insertAdjacentElement("afterend", sp2);
  }
}

// ---------------------------------------------------------- usage polling ----
// usage_update is push-only and infrequent, so ask the host for one. The
// applier exposes the app's VS Code API handle as window.__ccVsc; requests
// are fire-and-forget ({type:"request"} → host pushes usage_update, which the
// message listener already ingests; the response itself is ignored).
let reqN = 0;

function requestUsage() {
  const api = window.__ccVsc;
  if (!api) return;
  try {
    api.postMessage({
      type: "request",
      channelId: "",
      requestId: "ccbadge-" + ++reqN,
      request: { type: "request_usage_update" },
    });
    cnt.req++;
    scheduleRender();
  } catch (e) {
    state.rlError = "postMessage failed: " + e;
  }
}

// Ship diagnostics into the extension host's output log: the host logs every
// webview message verbatim ("Received message from webview: ..."), so an
// unknown-typed message is a free write-to-file channel for debugging.
function report(tag) {
  const api = window.__ccVsc;
  if (!api) return;
  try {
    api.postMessage({
      type: "cc_badge_report",
      tag,
      cnt,
      state,
      lastUsage: dbg.lastUsage || null,
    });
  } catch {}
}

dbg.report = report; // manual trigger from the devtools console

function startPolling() {
  // Retry at startup until the first usage_update lands, then every 5 min.
  for (const ms of [1500, 5000, 15000])
    setTimeout(() => { if (cnt.usg === 0) requestUsage(); }, ms);
  setInterval(requestUsage, 5 * 60 * 1000);
}

// ------------------------------------------------------------------ boot ----
function start() {
  loadState();
  const root = document.getElementById("root") || document.body;
  new MutationObserver(() => inject()).observe(root, { childList: true, subtree: true });
  inject();
  startPolling();
  setInterval(pollSession, 500);
  setInterval(scheduleRender, 60 * 1000); // keep the reset countdown fresh
}

window.addEventListener("message", (e) => {
  cnt.raw++;
  const d = e.data;
  if (d && d.type === "from-extension") ingest(d.message);
});

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start);
else start();
