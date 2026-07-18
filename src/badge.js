// ----------------------------------------------------------------- badge ----
// Two-row cells injected into the chat input footer:
//   Fable 5    ctx ▮▮▮   5h ▮▮▮    wk ▮▮     fb ▮▮
//    Extra       64k      2h13m     Wed       Wed
// The model cell is clickable and opens the model × effort grid popup.

const BADGE_ID = "cc-status-badge";
const SPACER2_ID = "cc-status-spacer2";
const STYLE_ID = "cc-badge-style";

const CTX_CAP = 200000; // hard cap — the app-reported window (e.g. 1M) is ignored

function cellHtml(title, topHtml, caption) {
  return (
    '<span class="cc-cell" title="' + title + '">' +
    '<span class="cc-cell-top">' + topHtml + "</span>" +
    '<span class="cc-cell-cap">' + (caption || "") + "</span>" +
    "</span>"
  );
}

function barHtml(short, pct, high) {
  const p = Math.min(100, Math.max(0, pct));
  return (
    '<span class="cc-barlabel">' + short + "</span>" +
    '<span class="cc-bar"><span class="cc-fill' + (high ? " cc-fill-high" : "") +
    '" style="width:' + p + '%"></span></span>'
  );
}

function ctxCell() {
  if (state.used == null) return "";
  const pct = (state.used / CTX_CAP) * 100;
  const title =
    "Context " + fmtK(state.used) + " / " + fmtK(CTX_CAP) + " · " + Math.round(pct) + "%";
  return cellHtml(title, barHtml("ctx", pct, pct >= 90), fmtK(state.used));
}

// caption: 5h shows time until the window resets, weeklies show the day.
function rateCell(w, label, short, capFn, extraTitle) {
  const util = w && typeof w.util === "number" ? w.util : null;
  const pct = util == null ? 0 : util;
  const shown = Math.floor(Math.min(100, Math.max(0, pct)));
  let title =
    label + (util == null ? " (pending)" : " " + shown + "%") +
    (w && w.resets ? " · resets in " + fmtReset(w.resets) : "");
  if (extraTitle) title += "\n" + extraTitle;
  const caption = w && w.resets ? capFn(w.resets) : "";
  return cellHtml(title, barHtml(short, pct, pct >= 80), caption);
}

// ---------------------------------------------------------------- render ----
let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function render() {
  const el = document.getElementById(BADGE_ID);
  if (!el) return;
  const modelCell = el.querySelector(".cc-modelcell");
  modelCell.title = (state.model || "no session yet") + " — click to set model / effort";
  el.querySelector(".cc-model").textContent = prettyModel(state.model);
  el.querySelector(".cc-effort").textContent =
    state.ultracode ? "Ultra" : EFFORT_SHORT[state.effort] || "";
  el.querySelector(".cc-bars").innerHTML =
    ctxCell() +
    rateCell(state.five, "Session (5h)", "5h", fmtReset) +
    rateCell(state.week, "Weekly", "wk", fmtResetDay) +
    rateCell(state.fable, "Fable quota", "fb", fmtResetDay, state.rlError);
}

// ---------------------------------------------------------------- inject ----
const CSS_BADGE =
  ".cc-badge{display:flex;align-items:center;gap:10px;font-size:11px;line-height:1;" +
  "color:var(--app-secondary-foreground,#999);white-space:nowrap;min-width:0;overflow:hidden}" +
  ".cc-badge .cc-modelcell{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer}" +
  ".cc-badge .cc-modelcell:hover .cc-model{color:var(--app-foreground,#ddd)}" +
  ".cc-badge .cc-modelcell:hover .cc-effort{opacity:1;color:var(--app-foreground,#ddd)}" +
  ".cc-badge .cc-model{font-weight:600}" +
  ".cc-badge .cc-effort{font-size:9px;opacity:.55;min-height:9px}" +
  ".cc-badge .cc-bars{display:flex;align-items:flex-start;gap:10px}" +
  ".cc-badge .cc-cell{display:flex;flex-direction:column;align-items:center;gap:2px}" +
  ".cc-badge .cc-cell-top{display:flex;align-items:center;gap:4px}" +
  ".cc-badge .cc-cell-cap{font-size:9px;opacity:.55;min-height:9px}" +
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
  s.textContent = CSS_BADGE + CSS_POPUP;
  document.head.appendChild(s);
}

function makeBadge() {
  const el = document.createElement("div");
  el.id = BADGE_ID;
  el.className = "cc-badge";
  el.innerHTML =
    '<span class="cc-modelcell"><span class="cc-model"></span><span class="cc-effort"></span></span>' +
    '<span class="cc-bars"></span>';
  el.querySelector(".cc-modelcell").addEventListener("click", (ev) => {
    ev.stopPropagation();
    togglePopup(ev.currentTarget);
  });
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
