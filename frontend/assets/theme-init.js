/*
 * Virtual Tools — early theme bootstrap.
 * Loaded synchronously in <head> so the saved theme is applied to <html>
 * before the first paint, avoiding a flash of the wrong color scheme.
 * Falls back to the OS preference when no choice has been saved.
 */
(function () {
  try {
    var saved = localStorage.getItem("vt-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  } catch (e) {
    /* localStorage unavailable (private mode, etc.) — fall back to OS pref. */
  }
})();