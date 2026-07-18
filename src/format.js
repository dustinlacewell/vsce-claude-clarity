// ------------------------------------------------------------ formatting ----

// The effort ladder as the app defines it. "Ultra" in our grid is the app's
// separate Ultracode toggle (forces xhigh + enables workflows), not a sixth
// effort value.
const EFFORT_SHORT = { low: "Low", medium: "Med", high: "High", xhigh: "Extra", max: "Max" };
const EFFORT_FULL = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const ULTRA_TITLE = "Ultracode — xhigh + workflows";

// Grid row order; matches the app's own family list.
const MODEL_FAMILIES = ["haiku", "sonnet", "opus", "fable"];

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

function prettyFamily(f) {
  return f ? f[0].toUpperCase() + f.slice(1) : "";
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
  if (d.toDateString() === new Date().toDateString()) return "today";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
