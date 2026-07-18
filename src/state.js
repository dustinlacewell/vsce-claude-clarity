// ----------------------------------------------------------------- state ----
// Single mutable store the badge renders from. Context/model/effort are
// re-read live from the app's session state and need no persistence; the
// rate-limit windows persist across reloads because they only refresh once a
// session channel exists (nothing to query on a freshly loaded idle window).

const state = {
  model: null,      // model slug, e.g. "claude-fable-5[1m]"
  effort: null,     // "low"|"medium"|"high"|"xhigh"|"max", or null (auto)
  ultracode: false, // the app's Ultracode toggle (xhigh + workflows)
  used: null,       // context tokens (the app's usageData.totalTokens)
  five: null,       // { util: 0..100|null, resets }
  week: null,       // { util, resets }
  fable: null,      // { util, resets } — the model-scoped Fable quota window
  rlError: null,    // last get_usage problem, surfaced in the fb tooltip
};

dbg.state = state;

const LS_KEY = "cc-badge-state";

function saveRateLimits() {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ five: state.five, week: state.week, fable: state.fable })
    );
  } catch {}
}

function loadRateLimits() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (!s) return;
    if (s.five) state.five = s.five;
    if (s.week) state.week = s.week;
    if (s.fable) state.fable = s.fable;
  } catch {}
}
