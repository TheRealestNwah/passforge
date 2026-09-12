// Runs synchronously in <head>, before the popup paints. Restores the look
// popup.js last applied, so a Waterfox or forced-dark popup does not open in
// the default Firefox style and then visibly switch once the async theme and
// storage lookups finish. popup.js repaints from the real sources right after.
//
// The key must match SNAPSHOT_KEY in src/appearance.js. A classic script cannot
// import it, so it is repeated here.
(function () {
  try {
    const snap = JSON.parse(localStorage.getItem('passmint:appearance-snapshot') || 'null');
    if (!snap) return;
    const root = document.documentElement;
    if (snap.css) root.style.cssText = snap.css;
    if (snap.style) root.dataset.style = snap.style;
    if (snap.theme) root.dataset.theme = snap.theme;
  } catch {
    // No cache yet, or storage is blocked: the stylesheet defaults are fine.
  }
})();
