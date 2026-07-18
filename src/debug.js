// ----------------------------------------------------------------- debug ----
// Toggle verbose logging at runtime: localStorage.setItem("cc-badge-debug","1")
// Live state is exposed for one-shot inspection as window.__ccBadge.

const DEBUG = () => {
  try { return !!localStorage.getItem("cc-badge-debug"); } catch { return false; }
};

const dbg = (window.__ccBadge = {});

function dlog(...args) {
  if (DEBUG()) console.log("[cc-badge]", ...args);
}
