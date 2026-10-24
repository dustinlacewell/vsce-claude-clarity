// ------------------------------------------------------------- selection ----
// Selection sharing, off by default. The patched submit handler shares the
// editor selection only while window.__ccShareSel is true; the patched chip
// spreads window.__ccSelChip(label) into its title span, so the chip shows the
// state and a click toggles it.
//
// The chip's props derive from the flag on every render, and only a click
// changes the flag, so the click writes the same values straight to the DOM
// and preact's next diff agrees with them.

window.__ccShareSel = false;

function selShareState() {
  return window.__ccShareSel ? "on" : "off";
}

function selChipTitle(label) {
  return window.__ccShareSel
    ? "Sharing your current file selection with Claude (" + label + ") · Click to stop"
    : "Not sharing your current file selection (" + label + ") · Click to share";
}

function toggleSelShare(el, label) {
  window.__ccShareSel = !window.__ccShareSel;
  el.dataset.ccShare = selShareState();
  el.title = selChipTitle(label);
}

window.__ccSelChip = (label) => ({
  "data-cc-share": selShareState(),
  title: selChipTitle(label),
  onClick: (ev) => toggleSelShare(ev.currentTarget, label),
});
