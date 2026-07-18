// ------------------------------------------------------------ rate limits ----
// The same query the app's own /usage panel runs: the connection's get_usage
// request returns {usage:{rate_limits:{five_hour, seven_day, model_scoped[],
// …}}} — the full picture in one round trip, including the model-scoped
// weekly windows (the Fable quota among them) that usage_update pushes drop.
//
// We call it with the session's EXISTING channelId; the session's no-arg
// getUsage() would launchClaude() and spawn a session on an idle window.
// No channel yet → persisted last-known values show until one exists.

let usageFetchTimer = 0;
let usageFetchedOnce = false;

function scheduleUsageFetch(delayMs) {
  clearTimeout(usageFetchTimer);
  usageFetchTimer = setTimeout(() => fetchUsage("scheduled"), delayMs);
}

async function fetchUsage(reason) {
  const s = activeSession();
  const ch = s && s.claudeChannelId;
  const conn = sessionConnection(s);
  if (!ch || !conn || typeof conn.getUsage !== "function") {
    // No channel yet (fresh window, session still connecting) — keep trying
    // until the first fetch lands; afterwards the event-driven fetches and
    // the 5-minute interval take over.
    if (!usageFetchedOnce) scheduleUsageFetch(4000);
    return;
  }
  try {
    const res = await conn.getUsage(ch);
    dbg.lastUsageResponse = res;
    const rl = findRateLimits(res);
    if (!rl) {
      // Show the actual response so the tooltip says WHY (error field,
      // rate_limits_available:false, unexpected shape, …).
      state.rlError = "get_usage: no rate_limits — " + JSON.stringify(res).slice(0, 400);
      if (!usageFetchedOnce) scheduleUsageFetch(8000); // may just not be warm yet
      scheduleRender();
      return;
    }
    usageFetchedOnce = true;
    dbg.lastRateLimits = rl;
    state.five = pickWindow(rl.five_hour);
    state.week = pickWindow(rl.seven_day);
    state.fable = pickFable(rl);
    state.rlError = state.fable
      ? null
      : "get_usage: no Fable window — model_scoped: " + JSON.stringify(rl.model_scoped ?? null);
    saveRateLimits();
    scheduleRender();
  } catch (e) {
    state.rlError = "get_usage failed: " + ((e && e.message) || e);
    if (!usageFetchedOnce) scheduleUsageFetch(8000);
    dlog("get_usage failed (" + reason + "):", e);
    scheduleRender();
  }
}

// The response is {usage:{rate_limits:{…}}}; tolerate extra wrapping by
// walking down to the object that actually carries the windows.
function findRateLimits(o, depth) {
  depth = depth || 0;
  if (!o || typeof o !== "object" || depth > 4) return null;
  if (o.rate_limits && typeof o.rate_limits === "object") return o.rate_limits;
  if ("five_hour" in o || "model_scoped" in o) return o;
  for (const k of Object.keys(o)) {
    const r = findRateLimits(o[k], depth + 1);
    if (r) return r;
  }
  return null;
}

// utilization is already 0..100 (the app's panel floors it as a percent).
function pickWindow(w) {
  if (!w || typeof w !== "object") return null;
  const util = typeof w.utilization === "number" ? w.utilization : null;
  return { util, resets: w.resets_at ?? w.resetsAt ?? null };
}

function pickFable(rl) {
  const scoped = Array.isArray(rl.model_scoped) ? rl.model_scoped : [];
  const w =
    scoped.find((o) => o && /fable/i.test(o.display_name || "")) ||
    rl.seven_day_overage_included || // the plan-included "Fable 5 limit" window
    null;
  return pickWindow(w);
}

// usage_update pushes (wrapped by the host as requests) carry fresh five-hour
// and seven-day windows after each turn — free updates between polls.
function ingestPush(msg) {
  if (!msg || msg.type !== "request") return;
  const req = msg.request;
  if (!req || req.type !== "usage_update" || !req.utilization) return;
  dbg.lastUsagePush = req;
  state.five = pickWindow(req.utilization.fiveHour);
  state.week = pickWindow(req.utilization.sevenDay);
  saveRateLimits();
  scheduleRender();
}

function startUsagePolling() {
  // fetchUsage self-retries until the first success; then the event-driven
  // fetches plus this 5-minute interval keep things fresh.
  scheduleUsageFetch(2000);
  setInterval(() => fetchUsage("interval"), 5 * 60 * 1000);
}

dbg.fetchUsage = fetchUsage; // manual trigger from the devtools console
