/*
 * Virtual Tools — shared frontend script.
 * - Injects a consistent site header into any element with id="site-header".
 * - Renders the tool catalog on the homepage from window.VIRTUAL_TOOLS (see tools.js).
 */
(function () {
  "use strict";

  var ROOT = (window.VT_ROOT = window.VT_ROOT || "/");

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function injectHeader() {
    var mount = document.getElementById("site-header");
    if (!mount) return;
    var brand = el("a", { class: "brand", href: ROOT });
    brand.appendChild(el("span", { class: "brand-mark" }, ["▣"]));
    brand.appendChild(el("span", {}, ["Virtual Tools"]));
    var nav = el("nav", {}, [
      el("a", { href: ROOT }, ["Tools"]),
      el("a", { href: ROOT + "feedback/" }, ["Feedback"]),
    ]);
    var themeBtn = el("button", {
      class: "theme-toggle",
      type: "button",
      "aria-label": "Toggle color theme",
      title: "Toggle dark / light theme"
    }, [themeIcon()]);
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
    });
    mount.appendChild(brand);
    mount.appendChild(nav);
    mount.appendChild(themeBtn);
  }

  /* ---- Theme toggle ----------------------------------------------------- */
  function inferredTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light" : "dark";
  }
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || inferredTheme();
  }
  function themeIcon() {
    // Show the icon for the theme the user will switch to.
    return currentTheme() === "dark" ? "☀️" : "🌙";
  }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("vt-theme", t); } catch (e) {}
    var btn = document.querySelector(".theme-toggle");
    if (btn) btn.textContent = themeIcon();
  }

  function renderCatalog() {
    var mount = document.getElementById("tool-catalog");
    if (!mount || !window.VIRTUAL_TOOLS) return;

    var byCategory = {};
    window.VIRTUAL_TOOLS.forEach(function (t) {
      (byCategory[t.category] = byCategory[t.category] || []).push(t);
    });

    Object.keys(byCategory)
      .sort()
      .forEach(function (cat) {
        mount.appendChild(el("h2", { class: "catalog-category" }, [cat]));
        var grid = el("div", { class: "tool-grid" });
        byCategory[cat].forEach(function (t) {
          var card = el("a", { class: "tool-card", href: ROOT + "tools/" + t.slug + "/" });
          // Stash searchable text for the filter so we don't re-scan the DOM text.
          card.setAttribute("data-search", (
            (t.name || "") + " " + (t.description || "") + " " + (t.category || "") + " " + (t.slug || "")
          ).toLowerCase());
          card.appendChild(el("div", { class: "tool-card-icon" }, [t.icon || "🛠️"]));
          card.appendChild(el("div", { class: "tool-card-name" }, [t.name]));
          card.appendChild(el("div", { class: "tool-card-desc" }, [t.description]));
          grid.appendChild(card);
        });
        mount.appendChild(grid);
      });

    wireSearch();
  }

  // Client-side filtering of the rendered catalog. Hides non-matching cards
  // and any category that ends up empty, so new tools are always discoverable.
  function wireSearch() {
    var input = document.getElementById("tool-search");
    if (!input) return;
    var emptyNote = document.getElementById("search-empty");
    var mount = document.getElementById("tool-catalog");

    function filter() {
      var q = input.value.trim().toLowerCase();
      var visibleCount = 0;
      // Each category is an <h2.catalog-category> followed by a <div.tool-grid>.
      var headers = mount.querySelectorAll(".catalog-category");
      headers.forEach(function (h) {
        var grid = h.nextElementSibling;
        if (!grid) return;
        var cards = grid.querySelectorAll(".tool-card");
        var seen = 0;
        cards.forEach(function (card) {
          var match = !q || (card.getAttribute("data-search") || "").indexOf(q) !== -1;
          card.style.display = match ? "" : "none";
          if (match) seen++;
        });
        h.style.display = seen ? "" : "none";
        grid.style.display = seen ? "" : "none";
        visibleCount += seen;
      });
      if (emptyNote) emptyNote.hidden = visibleCount !== 0;
    }

    input.addEventListener("input", filter);
    filter();
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(injectHeader);
  ready(renderCatalog);

  // Expose helpers for tool pages to reuse.
  window.VT = { el: el, ready: ready, ROOT: ROOT };
})();