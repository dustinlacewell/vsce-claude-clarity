// ------------------------------------------------------------------ boot ----

function start() {
  loadRateLimits();
  const root = document.getElementById("root") || document.body;
  new MutationObserver(() => inject()).observe(root, { childList: true, subtree: true });
  inject();
  startUsagePolling();
  setInterval(pollSession, 500);
  setInterval(scheduleRender, 60 * 1000); // keep the reset countdowns fresh
}

window.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "from-extension") ingestPush(d.message);
});

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start);
else start();
