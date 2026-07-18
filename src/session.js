// ---------------------------------------------- app session state access ----
// The applier taps the input-footer render so the session whose input row is
// on screen lands in window.__ccActiveSession. Everything flows through that
// one handle: signal reads (context, model, effort), the get_usage query, and
// the app's own setModel / setEffortLevel / enableUltracode setters — so the
// badge always agrees with the app and never re-implements its behavior.
//
// Session fields are preact-ish signals (.value); we poll rather than
// subscribe to stay decoupled from the signal implementation.

function activeSession() {
  return window.__ccActiveSession || null;
}

function sessionConnection(s) {
  return (s && s.connection && s.connection.value) || null;
}

// The app's model catalog. Entries look like {value, supportsEffort,
// supportedEffortLevels, ...} — the same objects the app's own picker passes
// to session.setModel().
function sessionModels(s) {
  const conn = sessionConnection(s);
  const cfg =
    (s && s.claudeConfig && s.claudeConfig.value) ||
    (conn && conn.claudeConfig && conn.claudeConfig.value) ||
    null;
  return (cfg && cfg.models) || [];
}

function familyOf(slug) {
  const v = String(slug || "").toLowerCase();
  for (const f of MODEL_FAMILIES) if (v.includes(f)) return f;
  return null;
}

// One grid row per family, preferring a plain entry over a [1m] variant.
function modelRows(s) {
  const rows = new Map();
  const models = sessionModels(s);
  for (const pass of [0, 1]) {
    for (const m of models) {
      if (!m || typeof m.value !== "string" || m.value === "default") continue;
      if (pass === 0 && /\[1m\]/i.test(m.value)) continue;
      const fam = familyOf(m.value);
      if (fam && !rows.has(fam)) rows.set(fam, { family: fam, entry: m });
    }
  }
  return MODEL_FAMILIES.filter((f) => rows.has(f)).map((f) => rows.get(f));
}

function rowEffortLevels(entry) {
  if (!entry || !entry.supportsEffort) return [];
  return entry.supportedEffortLevels || ["low", "medium", "high"];
}

// Mirrors the app's ultracodeAvailable gate: workflows enabled + xhigh support.
function workflowsDisabled(s) {
  try {
    return s.config.value.claudeSettings.effective.disableWorkflows === true;
  } catch {
    return false;
  }
}

function rowSupportsUltra(s, entry) {
  return !workflowsDisabled(s) && rowEffortLevels(entry).includes("xhigh");
}

// Apply a grid pick: switch model if needed, then effort. level is an effort
// string, "ultra" for the Ultracode toggle, or null for model-only.
async function applySelection(row, level) {
  const s = activeSession();
  if (!s) return;
  try {
    const cur = String(state.model || "").replace(/\[1m\]$/i, "");
    let switched = false;
    if (cur !== row.entry.value && typeof s.setModel === "function") {
      const ok = await s.setModel(row.entry);
      if (ok === false) return; // the app already showed its error notification
      switched = true;
    }
    if (level === "ultra") await s.enableUltracode();
    else if (level) await s.setEffortLevel(level);
    // The app's own picker leaves no trace in the transcript; drop the same
    // kind of meta line the rewind flow uses so the switch is visible.
    if (switched && typeof s.insertMetaMessage === "function") {
      const eff = level === "ultra" ? "Ultracode" : level ? EFFORT_FULL[level] : null;
      s.insertMetaMessage(
        "Switched to " + prettyModel(row.entry.value) + (eff ? " · " + eff + " effort" : "")
      );
    }
  } catch (e) {
    dlog("applySelection failed:", e);
  }
  pollSession();
}

// ------------------------------------------------------------ signal poll ----
let lastBusy = false;
let lastSessionRef = null;

function pollSession() {
  const s = activeSession();
  if (!s) return;
  try {
    // New session (window switched tabs, session restarted): refetch limits.
    if (s !== lastSessionRef) {
      lastSessionRef = s;
      scheduleUsageFetch(1500);
    }
    // A turn just finished — the rate-limit windows moved.
    const busy = !!(s.busy && s.busy.value);
    if (lastBusy && !busy) scheduleUsageFetch(2000);
    lastBusy = busy;

    const u = s.usageData && s.usageData.value;
    if (u && typeof u.totalTokens === "number") state.used = u.totalTokens;

    // What's actually serving beats the picker selection; the picker keeps
    // the [1m] variant suffix that served-model strings sometimes drop.
    const sel = s.modelSelection && s.modelSelection.value;
    const served = s.lastServedModel && s.lastServedModel.value;
    let slug = served || sel || (s.currentMainLoopModel && s.currentMainLoopModel.value) || null;
    if (slug && sel && /\[1m\]/i.test(sel) && !/\[1m\]/i.test(slug)) slug += "[1m]";
    if (slug) state.model = slug;

    state.effort = (s.effortLevel && s.effortLevel.value) || null;
    state.ultracode = !!(s.ultracodeEnabled && s.ultracodeEnabled.value);
  } catch (e) {
    dlog("pollSession failed:", e);
  }
  scheduleRender();
}
