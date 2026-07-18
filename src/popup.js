// ----------------------------------------------------------------- popup ----
// Click the model name → a model × effort grid:
//
//            Low  Med  High  Extra  Max  Ultra
//   Haiku     ·    ·    ·     —      —    —
//   Sonnet    ·    ·    ·     ·      ·    ·
//   ...
//
// Rows come from the app's live model catalog (one per family), columns are
// the effort ladder plus the Ultracode toggle. Clicking a cell sets model and
// effort in one go via the session's own setters; a row name sets model only.
// Cells a model doesn't support are disabled.

const POPUP_ID = "cc-model-popup";

const POPUP_COLUMNS = [
  { key: "low", label: "Low", title: EFFORT_FULL.low },
  { key: "medium", label: "Med", title: EFFORT_FULL.medium },
  { key: "high", label: "High", title: EFFORT_FULL.high },
  { key: "xhigh", label: "Extra", title: EFFORT_FULL.xhigh },
  { key: "max", label: "Max", title: EFFORT_FULL.max },
  { key: "ultra", label: "Ultra", title: ULTRA_TITLE },
];

const CSS_POPUP =
  ".cc-popup{position:fixed;z-index:10000;display:grid;grid-template-columns:auto repeat(6,32px);" +
  "align-items:center;padding:10px 12px;font-size:11px;line-height:1;" +
  "color:var(--app-secondary-foreground,#bbb);" +
  "background:var(--app-editor-widget-background,var(--app-menu-background,#252526));" +
  "border:1px solid var(--app-input-border,#444);border-radius:6px;" +
  "box-shadow:0 6px 24px rgba(0,0,0,.45)}" +
  ".cc-popup .cc-p-head{font-size:10px;opacity:.6;text-align:center;padding-bottom:6px}" +
  ".cc-popup .cc-p-name{font-weight:600;text-align:right;padding-right:10px;cursor:pointer}" +
  ".cc-popup .cc-p-name:hover{color:var(--app-foreground,#eee)}" +
  ".cc-popup .cc-p-name.cc-p-current{color:var(--app-claude-orange,#d97757)}" +
  ".cc-popup .cc-p-cell{display:flex;align-items:center;justify-content:center;height:24px;" +
  "cursor:pointer;border-radius:4px}" +
  ".cc-popup .cc-p-cell:hover{background:var(--app-list-hover-background,rgba(255,255,255,.07))}" +
  ".cc-popup .cc-p-dot{width:9px;height:9px;border-radius:50%;background:currentColor;opacity:.3}" +
  ".cc-popup .cc-p-active .cc-p-dot{background:var(--app-claude-orange,#d97757);opacity:1}" +
  ".cc-popup .cc-p-disabled{pointer-events:none}" +
  ".cc-popup .cc-p-disabled .cc-p-dot{opacity:.08}" +
  ".cc-popup .cc-p-modelonly .cc-p-dot{opacity:.18}";

function togglePopup(anchor) {
  if (document.getElementById(POPUP_ID)) closePopup();
  else openPopup(anchor);
}

function closePopup() {
  const el = document.getElementById(POPUP_ID);
  if (el) el.remove();
  document.removeEventListener("mousedown", onPopupOutside, true);
  document.removeEventListener("keydown", onPopupKey, true);
}

function onPopupOutside(e) {
  const el = document.getElementById(POPUP_ID);
  if (!el || el.contains(e.target)) return;
  // Let the model cell's own click handler do the toggling, else its
  // mousedown closes the popup and its click immediately reopens it.
  const badge = document.getElementById(BADGE_ID);
  const model = badge && badge.querySelector(".cc-modelcell");
  if (model && model.contains(e.target)) return;
  closePopup();
}

function onPopupKey(e) {
  if (e.key === "Escape") closePopup();
}

function popupHead(text) {
  const el = document.createElement("div");
  el.className = "cc-p-head";
  el.textContent = text;
  return el;
}

function popupName(row, current) {
  const el = document.createElement("div");
  el.className = "cc-p-name" + (row.family === current ? " cc-p-current" : "");
  el.textContent = prettyFamily(row.family);
  el.title = prettyModel(row.entry.value) + " — click to switch model";
  el.addEventListener("click", () => {
    applySelection(row, null);
    closePopup();
  });
  return el;
}

function popupCell(s, row, col, currentFamily) {
  const isUltra = col.key === "ultra";
  const levels = rowEffortLevels(row.entry);
  const supported = isUltra ? rowSupportsUltra(s, row.entry) : levels.includes(col.key);
  // A model with no effort support at all is still selectable — any cell in
  // its row sets the model; only per-level gaps on effort-capable models
  // are dead cells.
  const modelOnly = !supported && levels.length === 0;
  const active =
    row.family === currentFamily &&
    (isUltra ? state.ultracode : !state.ultracode && state.effort === col.key);

  const el = document.createElement("div");
  el.className =
    "cc-p-cell" +
    (active ? " cc-p-active" : "") +
    (modelOnly ? " cc-p-modelonly" : supported ? "" : " cc-p-disabled");
  el.title = supported
    ? prettyFamily(row.family) + " · " + col.title
    : modelOnly
      ? prettyFamily(row.family) + " — no effort levels; sets model only"
      : col.title + " — not supported";
  el.innerHTML = '<span class="cc-p-dot"></span>';
  if (supported || modelOnly)
    el.addEventListener("click", () => {
      applySelection(row, supported ? col.key : null);
      closePopup();
    });
  return el;
}

function openPopup(anchor) {
  const s = activeSession();
  const rows = modelRows(s);
  if (!s || !rows.length) return;

  const pop = document.createElement("div");
  pop.id = POPUP_ID;
  pop.className = "cc-popup";

  pop.appendChild(popupHead(""));
  for (const col of POPUP_COLUMNS) pop.appendChild(popupHead(col.label));

  const currentFamily = familyOf(state.model);
  for (const row of rows) {
    pop.appendChild(popupName(row, currentFamily));
    for (const col of POPUP_COLUMNS) pop.appendChild(popupCell(s, row, col, currentFamily));
  }

  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left =
    Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 8) + "px";

  document.addEventListener("mousedown", onPopupOutside, true);
  document.addEventListener("keydown", onPopupKey, true);
}
