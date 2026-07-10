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

  // Brand mark: a wrench (this is a tools catalog, after all) — theme-colored via currentColor.
  var WRENCH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

  function injectHeader() {
    var mount = document.getElementById("site-header");
    if (!mount) return;
    var brand = el("a", { class: "brand", href: ROOT });
    brand.appendChild(el("span", { class: "brand-mark", html: WRENCH_SVG }));
    brand.appendChild(el("span", {}, ["Virtual Tools"]));
    var nav = el("nav", {}, [
      el("a", { href: ROOT }, ["Tools"]),
      el("a", { href: ROOT + "feedback/" }, ["Feedback"]),
      el("a", {
        href: "https://github.com/virt-tools/virt-tools",
        target: "_blank",
        rel: "noopener noreferrer"
      }, ["GitHub"]),
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

  /* ---- Catalog ---------------------------------------------------------- *
   * The homepage offers two views over the same registry:
   *   "all"    — grouped by category (the original layout).
   *   "recent" — flat list, newest tools first, each card showing when it was
   *              added. The chosen view is remembered across visits.
   */
  var currentView = (function () {
    try { return localStorage.getItem("vt-view") === "recent" ? "recent" : "all"; }
    catch (e) { return "all"; }
  })();
  var searchInput = null, emptyNote = null, catalogMount = null, countEl = null;

  // Relative "added X ago" label, with the exact ISO timestamp as a tooltip so
  // the precise add time is available on hover without crowding the card.
  function formatAdded(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 0) return "just now";
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 2592000) return Math.floor(diff / 86400) + "d ago";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function toolCard(t) {
    var card = el("a", { class: "tool-card", href: ROOT + "tools/" + t.slug + "/" });
    // Stash searchable text for the filter so we don't re-scan the DOM text.
    card.setAttribute("data-search", (
      (t.name || "") + " " + (t.description || "") + " " + (t.category || "") + " " + (t.slug || "")
    ).toLowerCase());
    card.appendChild(el("div", { class: "tool-card-icon" }, [t.icon || "🛠️"]));
    card.appendChild(el("div", { class: "tool-card-name" }, [t.name]));
    // Description is intentionally not rendered on the card — kept in the
    // data-search attribute and the registry so search and SEO still work, but
    // the homepage lists just icon + name (+ "added X ago" in the recent view)
    // for less clutter and quicker navigation.
    if (t.added) {
      var added = el("div", { class: "tool-card-added", title: t.added }, ["Added " + formatAdded(t.added)]);
      card.appendChild(added);
    }
    return card;
  }

  function renderView() {
    catalogMount.innerHTML = "";
    if (currentView === "recent") {
      // Newest first, by parsed timestamp. Comparing the ISO strings with
      // localeCompare is not reliable (it can reorder the T/-/: separators
      // depending on locale), so parse to a Date and compare numerically.
      // Tools without a parseable `added` date sort to the end.
      var sorted = window.VIRTUAL_TOOLS.slice().sort(function (a, b) {
        var ta = Date.parse(a.added), tb = Date.parse(b.added);
        var an = isNaN(ta), bn = isNaN(tb);
        if (an && bn) return 0;
        if (an) return 1;
        if (bn) return -1;
        return tb - ta;
      });
      var grid = el("div", { class: "tool-grid recent-grid" });
      sorted.forEach(function (t) { grid.appendChild(toolCard(t)); });
      catalogMount.appendChild(grid);
    } else {
      var byCategory = {};
      window.VIRTUAL_TOOLS.forEach(function (t) {
        (byCategory[t.category] = byCategory[t.category] || []).push(t);
      });
      Object.keys(byCategory).sort().forEach(function (cat) {
        catalogMount.appendChild(el("h2", { class: "catalog-category" }, [cat]));
        var grid = el("div", { class: "tool-grid" });
        byCategory[cat].forEach(function (t) { grid.appendChild(toolCard(t)); });
        catalogMount.appendChild(grid);
      });
    }
  }

  // Client-side filtering of the rendered catalog. Hides non-matching cards
  // and any category/grid that ends up empty, so new tools are always
  // discoverable. Works for both the grouped and flat (recent) layouts.
  function filter() {
    if (!catalogMount) return;
    var q = (searchInput ? searchInput.value : "").trim().toLowerCase();
    var visibleCount = 0;
    // Grouped layout: each category is an <h2.catalog-category> + sibling grid.
    var headers = catalogMount.querySelectorAll(".catalog-category");
    headers.forEach(function (h) {
      var grid = h.nextElementSibling;
      if (!grid) return;
      var seen = 0;
      grid.querySelectorAll(".tool-card").forEach(function (card) {
        var match = !q || (card.getAttribute("data-search") || "").indexOf(q) !== -1;
        card.style.display = match ? "" : "none";
        if (match) seen++;
      });
      h.style.display = seen ? "" : "none";
      grid.style.display = seen ? "" : "none";
      visibleCount += seen;
    });
    // Flat (recent) layout: a single grid with no category headers.
    var flat = catalogMount.querySelector(".recent-grid");
    if (flat) {
      var seen = 0;
      flat.querySelectorAll(".tool-card").forEach(function (card) {
        var match = !q || (card.getAttribute("data-search") || "").indexOf(q) !== -1;
        card.style.display = match ? "" : "none";
        if (match) seen++;
      });
      flat.style.display = seen ? "" : "none";
      visibleCount += seen;
    }
    if (emptyNote) emptyNote.hidden = visibleCount !== 0;
    if (countEl) {
      var total = (window.VIRTUAL_TOOLS || []).length;
      var q = (searchInput ? searchInput.value : "").trim();
      countEl.textContent = q
        ? visibleCount + " of " + total + " tools match \"" + q + "\""
        : total + " tools available";
    }
  }

  function switchView(view) {
    if (view === currentView) return;
    currentView = view;
    try { localStorage.setItem("vt-view", view); } catch (e) {}
    syncTabs();
    renderView();
    filter();
  }

  function syncTabs() {
    document.querySelectorAll(".view-tab").forEach(function (tab) {
      var active = tab.getAttribute("data-view") === currentView;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function wireTabs() {
    document.querySelectorAll(".view-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        switchView(tab.getAttribute("data-view"));
      });
    });
    syncTabs();
  }

  function initCatalog() {
    catalogMount = document.getElementById("tool-catalog");
    if (!catalogMount || !window.VIRTUAL_TOOLS) return;
    searchInput = document.getElementById("tool-search");
    emptyNote = document.getElementById("search-empty");
    countEl = document.getElementById("tool-count");
    renderView();
    wireTabs();
    if (searchInput) searchInput.addEventListener("input", filter);
    // Honour ?q=… so the site-search action advertised in JSON-LD resolves to a
    // real, linkable results view (e.g. https://virt.tools/?q=base64).
    try {
      var q = new URLSearchParams(window.location.search).get("q");
      if (q && searchInput) {
        searchInput.value = q;
        // "Recent" view is flat, so a search there is most useful.
        if (currentView !== "recent") switchView("recent");
        else filter();
        searchInput.focus();
      }
    } catch (e) {}
    filter();
  }

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  /* ---- Recently visited tools (client-side only, localStorage) -----------
   * Records each tool page visit so the feedback page can suggest leaving a
   * comment about the tool the user just used. Never sent to any server. */
  function slugFromPath() {
    var m = location.pathname.match(/\/tools\/([^\/]+)\/?/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function recordVisit() {
    var slug = slugFromPath();
    if (!slug) return;
    var name = "";
    var h1 = document.querySelector("main h1, .tool-header h1, h1");
    if (h1) name = h1.textContent.trim();
    if (!name) name = (document.title.replace(/\s*—.*$/, "").trim()) || slug;
    var list;
    try { list = JSON.parse(localStorage.getItem("vt-recent-tools") || "[]"); }
    catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (e) { return e && e.slug !== slug; });
    list.unshift({ slug: slug, name: name, ts: Date.now() });
    list = list.slice(0, 8);
    try { localStorage.setItem("vt-recent-tools", JSON.stringify(list)); } catch (e) {}
  }
  function recentTools() {
    try {
      var list = JSON.parse(localStorage.getItem("vt-recent-tools") || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  ready(injectHeader);
  ready(initCatalog);
  ready(recordVisit);

  // Expose helpers for tool pages to reuse.
  window.VT = { el: el, ready: ready, ROOT: ROOT, recentTools: recentTools };
})();