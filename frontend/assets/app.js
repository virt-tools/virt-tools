/* Virtual Tools shared shell, catalog, trust panel, and local preferences. */
(function () {
  "use strict";

  var ROOT = (window.VT_ROOT = window.VT_ROOT || "/");
  var FAVORITES_KEY = "vt-favorites";
  var SORT_KEY = "vt-sort";
  var PAGE_SIZE = 40;
  var CATEGORY_GROUPS = [
    { id: "text-data", name: "Text & data", categories: ["Text", "Data", "Encoding"] },
    { id: "developer-it", name: "Developer & IT", categories: ["Developer", "Networking", "IT & Networking", "Security", "System"] },
    { id: "math-converters", name: "Math & converters", categories: ["Math", "Converters"] },
    { id: "design-media", name: "Design & media", categories: ["Design", "Image", "Video", "Audio", "Music"] },
    { id: "money-productivity", name: "Money & productivity", categories: ["Finance", "Personal Productivity"] },
    { id: "home-everyday", name: "Home & everyday", categories: ["Home & Garden", "Home Systems", "Food", "Time"] },
    { id: "health-outdoors", name: "Health & outdoors", categories: ["Health", "Sports & Outdoors", "Safety & Emergency"] },
    { id: "science-environment", name: "Science & environment", categories: ["Environment", "Geography"] },
    { id: "engineering", name: "Engineering & construction", categories: ["Construction", "Electrical & Energy", "Mechanical & Structural Engineering", "Oil, Gas & Marine Engineering", "Civil & Geotechnical Engineering", "Communications Engineering"] },
    { id: "fun-hobbies", name: "Fun & hobbies", categories: ["Fun", "Crafts & Hobbies"] }
  ];
  var deferredInstallPrompt = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "disabled") node.disabled = Boolean(value);
      else if (value !== null && value !== undefined) node.setAttribute(key, value);
    });
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function replace(node, children) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    (children || []).forEach(function (child) { node.appendChild(child); });
  }

  function readJSON(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || "null");
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }

  function svgIcon(paths) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    [["width", "16"], ["height", "16"], ["viewBox", "0 0 24 24"],
     ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.7"],
     ["stroke-linecap", "round"], ["stroke-linejoin", "round"],
     ["aria-hidden", "true"], ["focusable", "false"]
    ].forEach(function (pair) { svg.setAttribute(pair[0], pair[1]); });
    paths.forEach(function (d) {
      var path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    return svg;
  }

  function themeIcon(theme) {
    return theme === "dark"
      ? svgIcon([
          "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
          "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4",
          "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"
        ])
      : svgIcon(["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"]);
  }

  function inferredTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || inferredTheme();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("vt-theme", theme); } catch (_) {}
  }

  function syncThemeButton(button) {
    if (!button) return;
    var theme = currentTheme();
    button.replaceChildren(themeIcon(theme));
    button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    button.title = button.getAttribute("aria-label");
  }

  function githubIcon() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    [["width", "16"], ["height", "16"], ["viewBox", "0 0 24 24"],
     ["fill", "currentColor"], ["aria-hidden", "true"], ["focusable", "false"]
    ].forEach(function (pair) { svg.setAttribute(pair[0], pair[1]); });
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z");
    svg.appendChild(path);
    return svg;
  }

  function injectFavicon() {
    if (!document.querySelector('link[rel~="icon"]')) {
      document.head.appendChild(el("link", { rel: "icon", type: "image/svg+xml", href: ROOT + "favicon.svg" }));
    }
    if (!document.querySelector('link[rel="manifest"]')) {
      document.head.appendChild(el("link", { rel: "manifest", href: ROOT + "manifest.webmanifest" }));
    }
  }

  function injectHeader() {
    var mount = document.getElementById("site-header");
    if (!mount || mount.getAttribute("data-ready")) return;
    mount.setAttribute("data-ready", "true");
    var main = document.querySelector("main");
    if (main && !main.id) main.id = "main-content";
    if (main && !document.querySelector(".skip-link")) {
      document.body.insertBefore(el("a", { class: "skip-link", href: "#" + main.id }, ["Skip to main content"]), document.body.firstChild);
    }

    var brand = el("a", { class: "brand", href: ROOT }, ["virt", el("span", {}, [".tools"])]);
    var nav = el("nav", { "aria-label": "Primary" }, [
      el("a", { href: ROOT }, ["All tools"]),
      el("a", { href: ROOT + "privacy/" }, ["Privacy"]),
      el("a", { href: ROOT + "feedback/" }, ["Feedback"])
    ]);
    var themeButton = el("button", {
      class: "theme-toggle", type: "button", "aria-label": "Toggle color theme"
    });
    syncThemeButton(themeButton);
    themeButton.addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
      syncThemeButton(themeButton);
    });

    var githubLink = el("a", {
      class: "github-link",
      href: "https://github.com/virt-tools/virt-tools",
      target: "_blank",
      rel: "noopener noreferrer",
      title: "Virtual Tools on GitHub",
      "aria-label": "Virtual Tools on GitHub"
    });
    githubLink.appendChild(githubIcon());

    var actions = el("div", { class: "header-actions" }, [githubLink, themeButton]);
    mount.appendChild(brand);
    mount.appendChild(nav);
    mount.appendChild(actions);

    var currentPath = location.pathname.replace(/\/+$/, "/");
    nav.querySelectorAll("a").forEach(function (link) {
      try {
        if (new URL(link.href, location.href).pathname.replace(/\/+$/, "/") === currentPath) {
          link.setAttribute("aria-current", "page");
        }
      } catch (_) {}
    });
  }

  function favoritesSet() {
    var value = readJSON(FAVORITES_KEY, []);
    return new Set(Array.isArray(value) ? value.filter(function (item) { return typeof item === "string"; }) : []);
  }

  function isFavorite(slug) { return favoritesSet().has(slug); }

  function setFavorite(slug, favorite) {
    var values = favoritesSet();
    if (favorite) values.add(slug); else values.delete(slug);
    saveJSON(FAVORITES_KEY, Array.from(values).sort());
  }

  function slugFromPath() {
    var match = location.pathname.match(/\/tools\/([^/]+)\/?/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
  }

  function normalizeSearch(value) {
    var normalized = String(value || "").toLowerCase();
    if (normalized.normalize) normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return normalized.replace(/[^a-z0-9+#.]+/g, " ").trim().replace(/\s+/g, " ");
  }

  function words(value) { return normalizeSearch(value).split(" ").filter(Boolean); }

  function editDistanceWithin(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return false;
    var previous = [];
    for (var j = 0; j <= right.length; j++) previous[j] = j;
    for (var i = 1; i <= left.length; i++) {
      var current = [i];
      var rowMin = current[0];
      for (j = 1; j <= right.length; j++) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (left.charAt(i - 1) === right.charAt(j - 1) ? 0 : 1)
        );
        rowMin = Math.min(rowMin, current[j]);
      }
      if (rowMin > limit) return false;
      previous = current;
    }
    return previous[right.length] <= limit;
  }

  var toolIndex = {};
  var searchIndex = {};

  function buildToolIndex() {
    toolIndex = {};
    searchIndex = {};
    (window.VIRTUAL_TOOLS || []).forEach(function (tool) {
      if (!tool || !tool.slug) return;
      tool.maturity = tool.maturity || "unreviewed";
      tool.tags = Array.isArray(tool.tags) ? tool.tags : [];
      tool.aliases = Array.isArray(tool.aliases) ? tool.aliases : [];
      toolIndex[tool.slug] = tool;
      var fields = {
        name: normalizeSearch(tool.name),
        aliases: normalizeSearch(tool.aliases.join(" ")),
        tags: normalizeSearch(tool.tags.join(" ")),
        subcategory: normalizeSearch(tool.subcategory),
        category: normalizeSearch(tool.category),
        slug: normalizeSearch(tool.slug),
        description: normalizeSearch(tool.description)
      };
      fields.all = Object.keys(fields).map(function (key) { return fields[key]; }).join(" ");
      fields.tokens = words(fields.all);
      searchIndex[tool.slug] = fields;
    });
  }

  function scoreTool(tool, query) {
    if (!query) return 0;
    var data = searchIndex[tool.slug];
    var terms = words(query);
    var score = 0;
    if (data.name === query) score += 180;
    if (data.slug === query) score += 160;
    if (data.name.indexOf(query) === 0) score += 90;
    if (data.aliases.split(" ").indexOf(query) !== -1) score += 85;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var termScore = 0;
      if (words(data.name).indexOf(term) !== -1) termScore += 34;
      else if (data.name.indexOf(term) !== -1) termScore += 22;
      if (data.aliases.indexOf(term) !== -1) termScore += 30;
      if (data.tags.indexOf(term) !== -1) termScore += 24;
      if (data.subcategory.indexOf(term) !== -1) termScore += 18;
      if (data.category.indexOf(term) !== -1) termScore += 16;
      if (data.slug.indexOf(term) !== -1) termScore += 12;
      if (data.description.indexOf(term) !== -1) termScore += 7;
      if (!termScore && term.length >= 4) {
        var limit = term.length >= 9 ? 2 : 1;
        for (var j = 0; j < data.tokens.length; j++) {
          if (editDistanceWithin(term, data.tokens[j], limit)) { termScore = 4; break; }
        }
      }
      if (!termScore) return -1;
      score += termScore;
    }
    return score;
  }

  function formatAdded(iso) {
    var date = new Date(iso);
    if (!iso || isNaN(date.getTime())) return "";
    var seconds = (Date.now() - date.getTime()) / 1000;
    if (seconds < 3600) return "Added recently";
    if (seconds < 86400) return "Added " + Math.floor(seconds / 3600) + "h ago";
    if (seconds < 2592000) return "Added " + Math.floor(seconds / 86400) + "d ago";
    return "Added " + date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formulaHref(tool, query) {
    var base = ROOT + "tools/" + tool.slug + "/";
    var normalized = normalizeSearch(query);
    if (!normalized || tool.tags.indexOf("formula-workbench") === -1) return base;
    var candidate = normalized.replace(/ /g, "-");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)) return base;
    var aliases = tool.aliases.map(normalizeSearch);
    return aliases.indexOf(candidate.replace(/-/g, " ")) === -1
      ? base
      : base + "?formula=" + encodeURIComponent(candidate);
  }

  function formulaName(tool, query) {
    var href = formulaHref(tool, query);
    var match = href.match(/[?&]formula=([^&]+)/);
    if (!match) return "";
    var name = normalizeSearch(decodeURIComponent(match[1]).replace(/-/g, " "));
    return tool.aliases.find(function (alias) { return normalizeSearch(alias) === name; }) || "";
  }

  function categoryName(category) {
    return category === "IT & Networking" ? "Networking" : category;
  }

  function catalogRow(tool, query) {
    var article = el("article", { class: "catalog-row", "data-slug": tool.slug });
    var matched = formulaName(tool, query);
    var link = el("a", { class: "catalog-row-main", href: formulaHref(tool, query) });
    link.appendChild(el("span", { class: "catalog-row-name" }, [matched || tool.name]));
    if (matched) link.appendChild(el("span", { class: "catalog-row-parent" }, [tool.name]));
    link.appendChild(el("p", { class: "catalog-row-desc" }, [tool.description]));
    article.appendChild(link);
    article.appendChild(el("span", { class: "catalog-row-cat" }, [categoryName(tool.category)]));
    var favorite = isFavorite(tool.slug);
    article.appendChild(el("button", {
      class: "catalog-star" + (favorite ? " is-favorite" : ""),
      type: "button",
      "data-favorite": tool.slug,
      "aria-pressed": favorite ? "true" : "false",
      "aria-label": (favorite ? "Remove " : "Save ") + tool.name,
      title: favorite ? "Remove from saved" : "Save tool"
    }, [favorite ? "★" : "☆"]));
    return article;
  }

  var catalogMount = null;
  var searchInput = null;
  var emptyNote = null;
  var countElement = null;
  var loadMoreButton = null;
  var chipsMount = null;
  var savedButton = null;
  var activeCategory = "";
  var savedOnly = false;
  var sortMode = "newest";
  var displayLimit = PAGE_SIZE;

  function matchesCategory(tool, category) {
    if (!category) return true;
    if (category === "Networking") return tool.category === "Networking" || tool.category === "IT & Networking";
    var group = CATEGORY_GROUPS.find(function (item) { return "group:" + item.id === category; });
    return group ? group.categories.indexOf(tool.category) !== -1 : tool.category === category;
  }

  function filteredTools() {
    var query = normalizeSearch(searchInput ? searchInput.value : "");
    var ranked = [];
    (window.VIRTUAL_TOOLS || []).forEach(function (tool, order) {
      if (savedOnly && !isFavorite(tool.slug)) return;
      if (!matchesCategory(tool, activeCategory)) return;
      var score = query ? scoreTool(tool, query) : 0;
      if (score < 0) return;
      ranked.push({ tool: tool, score: score, order: order });
    });
    if (query) {
      ranked.sort(function (a, b) {
        return b.score - a.score || a.tool.name.localeCompare(b.tool.name);
      });
    } else if (sortMode === "newest") {
      ranked.sort(function (a, b) { return (Date.parse(b.tool.added) || 0) - (Date.parse(a.tool.added) || 0); });
    } else {
      ranked.sort(function (a, b) { return a.tool.name.localeCompare(b.tool.name); });
    }
    return ranked.map(function (item) { return item.tool; });
  }

  function clearFilters() {
    activeCategory = "";
    savedOnly = false;
    displayLimit = PAGE_SIZE;
    if (savedButton) savedButton.setAttribute("aria-pressed", "false");
    syncChips();
    renderCatalog();
  }

  function renderEmpty(query) {
    if (!emptyNote) return;
    replace(emptyNote, []);
    if (query) {
      emptyNote.appendChild(document.createTextNode('No tools match "' + query + '". '));
      if (activeCategory) {
        var clear = el("button", { class: "link-btn", type: "button" }, ["Search all categories"]);
        clear.addEventListener("click", clearFilters);
        emptyNote.appendChild(clear);
        emptyNote.appendChild(document.createTextNode("."));
      } else {
        var message = 'I searched for "' + query + '" but could not find a matching tool. Could you add one for this?';
        emptyNote.appendChild(el("a", {
          href: ROOT + "feedback/?kind=suggestion&message=" + encodeURIComponent(message)
        }, ["Suggest this tool"]));
        emptyNote.appendChild(document.createTextNode("."));
      }
    } else if (savedOnly) {
      emptyNote.appendChild(document.createTextNode("No saved tools yet. Select the star on any tool to keep it here."));
    } else {
      emptyNote.appendChild(document.createTextNode("No tools match the selected category."));
      var reset = el("button", { class: "link-btn", type: "button" }, ["Show all tools"]);
      reset.addEventListener("click", clearFilters);
      emptyNote.appendChild(document.createTextNode(" "));
      emptyNote.appendChild(reset);
      emptyNote.appendChild(document.createTextNode("."));
    }
    emptyNote.hidden = false;
  }

  function renderCatalog() {
    if (!catalogMount) return;
    var results = filteredTools();
    var shown = results.slice(0, displayLimit);
    replace(catalogMount, []);
    if (shown.length) {
      var grid = el("div", { class: "catalog-list" });
      var query = searchInput ? searchInput.value : "";
      shown.forEach(function (tool) { grid.appendChild(catalogRow(tool, query)); });
      catalogMount.appendChild(grid);
      if (emptyNote) emptyNote.hidden = true;
    } else {
      renderEmpty(searchInput ? searchInput.value.trim() : "");
    }
    if (loadMoreButton) {
      loadMoreButton.hidden = shown.length >= results.length;
      loadMoreButton.textContent = "Show more tools (" + Math.min(PAGE_SIZE, results.length - shown.length) + ")";
    }
    if (countElement) {
      var total = (window.VIRTUAL_TOOLS || []).length;
      countElement.textContent = results.length === shown.length
        ? results.length.toLocaleString() + " of " + total.toLocaleString() + " tools"
        : "Showing " + shown.length.toLocaleString() + " of " + results.length.toLocaleString() + " tools";
    }
    catalogMount.setAttribute("aria-label", savedOnly ? "Saved tools" : "All tools");
  }

  function syncChips() {
    if (!chipsMount) return;
    chipsMount.querySelectorAll(".catalog-chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute("data-category") === activeCategory ? "true" : "false");
    });
  }

  function syncSort() {
    document.querySelectorAll(".catalog-sort-btn").forEach(function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-sort") === sortMode ? "true" : "false");
    });
  }

  function populateChips() {
    if (!chipsMount) return;
    var counts = {};
    (window.VIRTUAL_TOOLS || []).forEach(function (tool) { counts[tool.category] = (counts[tool.category] || 0) + 1; });
    chipsMount.appendChild(el("button", {
      class: "catalog-chip", type: "button", "data-category": "", "aria-pressed": "true"
    }, ["All"]));
    CATEGORY_GROUPS.forEach(function (group) {
      var total = group.categories.reduce(function (sum, category) { return sum + (counts[category] || 0); }, 0);
      if (!total) return;
      chipsMount.appendChild(el("button", {
        class: "catalog-chip", type: "button", "data-category": "group:" + group.id, "aria-pressed": "false"
      }, [group.name]));
    });
    chipsMount.addEventListener("click", function (event) {
      var chip = event.target.closest ? event.target.closest(".catalog-chip") : null;
      if (!chip) return;
      activeCategory = chip.getAttribute("data-category") || "";
      displayLimit = PAGE_SIZE;
      syncChips();
      renderCatalog();
    });
  }

  function initCatalog() {
    catalogMount = document.getElementById("tool-catalog");
    if (!catalogMount || !window.VIRTUAL_TOOLS) return;
    buildToolIndex();
    searchInput = document.getElementById("tool-search");
    if (searchInput) {
      searchInput.placeholder = "Search " + (window.VIRTUAL_TOOLS || []).length.toLocaleString() + " tools";
    }
    emptyNote = document.getElementById("search-empty");
    countElement = document.getElementById("tool-count");
    loadMoreButton = document.getElementById("catalog-load-more");
    chipsMount = document.getElementById("category-chips");
    savedButton = document.getElementById("saved-filter");
    populateChips();

    try {
      var savedSort = localStorage.getItem(SORT_KEY);
      if (savedSort === "newest" || savedSort === "name") sortMode = savedSort;
    } catch (_) {}
    syncSort();

    var timer = null;
    if (searchInput) searchInput.addEventListener("input", function () {
      displayLimit = PAGE_SIZE;
      clearTimeout(timer);
      timer = setTimeout(renderCatalog, 90);
      try { sessionStorage.setItem("vt-search", searchInput.value); } catch (_) {}
    });

    if (savedButton) savedButton.addEventListener("click", function () {
      savedOnly = !savedOnly;
      savedButton.setAttribute("aria-pressed", savedOnly ? "true" : "false");
      displayLimit = PAGE_SIZE;
      renderCatalog();
    });

    document.querySelectorAll(".catalog-sort-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        sortMode = button.getAttribute("data-sort") === "newest" ? "newest" : "name";
        try { localStorage.setItem(SORT_KEY, sortMode); } catch (_) {}
        syncSort();
        displayLimit = PAGE_SIZE;
        renderCatalog();
      });
    });

    if (loadMoreButton) loadMoreButton.addEventListener("click", function () {
      displayLimit += PAGE_SIZE;
      renderCatalog();
      var firstNew = catalogMount.querySelectorAll(".catalog-row")[displayLimit - PAGE_SIZE];
      if (firstNew) {
        var link = firstNew.querySelector("a");
        if (link) link.focus();
      }
    });

    catalogMount.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("button[data-favorite]") : null;
      if (!button) return;
      var slug = button.getAttribute("data-favorite");
      setFavorite(slug, !isFavorite(slug));
      renderCatalog();
      var replacement = catalogMount.querySelector('button[data-favorite="' + slug + '"]');
      if (replacement) replacement.focus();
      else if (searchInput) searchInput.focus();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      var active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      event.preventDefault();
      if (searchInput) searchInput.focus();
    });

    try {
      var params = new URLSearchParams(location.search);
      var query = params.get("q");
      var category = params.get("category");
      if (category === "IT & Networking") category = "Networking";
      if (query && searchInput) searchInput.value = query;
      if (category && Array.prototype.some.call(chipsMount.querySelectorAll(".catalog-chip"), function (chip) {
        return chip.getAttribute("data-category") === category;
      })) {
        activeCategory = category;
      }
      if (!query && performance.getEntriesByType) {
        var navigation = performance.getEntriesByType("navigation")[0];
        if (navigation && navigation.type === "back_forward" && searchInput) {
          searchInput.value = sessionStorage.getItem("vt-search") || "";
        }
      }
    } catch (_) {}
    syncChips();
    renderCatalog();
  }

  function metaContent(name) {
    var node = document.querySelector('meta[name="' + name + '"]');
    return node ? node.getAttribute("content") : "";
  }

  function defaultToolMetadata(slug) {
    return {
      slug: slug,
      guidance: metaContent("vt:guidance") || null,
      related: []
    };
  }

  function renderGuidance(metadata) {
    var guidance = typeof metadata.guidance === "string" ? metadata.guidance.trim() : "";
    var guidanceNote = document.querySelector(".tool-decision-guidance");
    if (!guidance) {
      if (guidanceNote) guidanceNote.remove();
      return;
    }
    if (!guidanceNote) {
      guidanceNote = el("p", { class: "tool-decision-guidance", role: "note", "aria-label": "Verification guidance" });
      var main = document.querySelector("main");
      var firstInteractive = main.querySelector(".input-section, .panel, form");
      if (firstInteractive) firstInteractive.insertAdjacentElement("beforebegin", guidanceNote);
      else {
        var intro = main.querySelector(".subtitle, .tool-desc, .tool-header");
        if (intro) intro.insertAdjacentElement("afterend", guidanceNote);
        else main.insertBefore(guidanceNote, main.firstChild);
      }
    }
    guidanceNote.textContent = guidance;
  }

  function renderRelated(main, metadata) {
    var old = main.querySelector(".related-tools");
    if (old) old.remove();
    if (!Array.isArray(metadata.related) || !metadata.related.length) return;
    var section = el("section", { class: "related-tools", "aria-labelledby": "related-tools-title" });
    section.appendChild(el("h2", { id: "related-tools-title" }, ["Related tools"]));
    var list = el("ul");
    metadata.related.forEach(function (tool) {
      list.appendChild(el("li", {}, [el("a", { href: ROOT + "tools/" + tool.slug + "/" }, [tool.name])]));
    });
    section.appendChild(list);
    main.appendChild(section);
  }

  function injectToolShell() {
    var slug = slugFromPath();
    if (!slug) return;
    var main = document.querySelector("main");
    if (!main || main.dataset.vtShell === "1") return;
    var heading = main.querySelector("h1");
    var title = heading ? heading.textContent.trim() : slug;
    main.dataset.vtShell = "1";
    main.classList.add("tool-page");
    // Fixed-cell boards retain playable target sizes on narrow screens. Scroll
    // just the board (also keyboard accessible), never the entire tool page.
    var boardSelectors = {
      "checkers": "#board", "chess": "#board", "color-sequence-memory": "#board",
      "crossword": "#grid", "game-2048": "#board", "game-of-life": "#grid",
      "gomoku": "#board", "killer-sudoku": "#grid", "knights-tour": "#board",
      "nonogram": "#board", "reversi": "#board", "rubiks-cube": "#cube",
      "simon-says": ".pad-grid", "sliding-puzzle": "#board",
      "sudoku-puzzle": "#grid", "sudoku-solver": "#board", "synthesizer": "#keyboard",
      "tic-tac-toe": "#board", "word-search": "#grid", "wordle": "#grid"
    };
    var board = boardSelectors[slug] && main.querySelector(boardSelectors[slug]);
    if (board) {
      var region = el("div", { class: "tool-scroll-region", tabindex: "0", role: "region", "aria-label": title + " board; scroll horizontally on small screens" });
      board.parentNode.insertBefore(region, board);
      region.appendChild(board);
    }
    main.querySelectorAll(".tool-header .back").forEach(function (back) { back.remove(); });

    var breadcrumbs = el("nav", { class: "tool-breadcrumbs", "aria-label": "Breadcrumb" }, [
      el("a", { href: ROOT }, ["← All tools"])
    ]);
    main.insertBefore(breadcrumbs, main.firstChild);

    var actions = el("div", { class: "tool-shell-actions" });
    var favorite = isFavorite(slug);
    var favoriteButton = el("button", {
      class: "tool-favorite tool-page-favorite" + (favorite ? " is-favorite" : ""), type: "button",
      "aria-pressed": favorite ? "true" : "false",
      "aria-label": (favorite ? "Remove " : "Add ") + title + (favorite ? " from favorites" : " to favorites"),
      title: favorite ? "Remove from favorites" : "Add to favorites"
    }, [favorite ? "★" : "☆"]);
    favoriteButton.addEventListener("click", function () {
      favorite = !favorite;
      setFavorite(slug, favorite);
      favoriteButton.setAttribute("aria-pressed", favorite ? "true" : "false");
      favoriteButton.classList.toggle("is-favorite", favorite);
      favoriteButton.textContent = favorite ? "★" : "☆";
      favoriteButton.setAttribute("aria-label", (favorite ? "Remove " : "Add ") + title + (favorite ? " from favorites" : " to favorites"));
      favoriteButton.title = favorite ? "Remove from favorites" : "Add to favorites";
    });
    if (heading) {
      var headingRow = el("div", { class: "tool-heading-row" });
      heading.parentNode.insertBefore(headingRow, heading);
      headingRow.appendChild(heading);
      headingRow.appendChild(favoriteButton);
    }
    var message = "Feedback about " + title + " (" + slug + "): ";
    actions.appendChild(el("a", {
      href: ROOT + "feedback/?kind=bug&tool=" + encodeURIComponent(slug) + "&message=" + encodeURIComponent(message)
    }, ["Report an issue"]));
    actions.appendChild(el("a", { class: "tool-privacy-link", href: ROOT + "privacy/" }, ["Privacy & local data"]));

    var metadata = defaultToolMetadata(slug);
    main.appendChild(actions);
    renderGuidance(metadata);

    fetch(ROOT + "assets/tool-meta/" + encodeURIComponent(slug) + ".json", {
      credentials: "same-origin", cache: "no-cache", headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("metadata unavailable");
      return response.json();
    }).then(function (loaded) {
      metadata = Object.assign(metadata, loaded || {});
      renderGuidance(metadata);
      renderRelated(main, metadata);
    }).catch(function () {
      renderRelated(main, metadata);
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function virtualToolsStorageKeys() {
    var keys = [];
    try {
      for (var index = 0; index < localStorage.length; index++) {
        var key = localStorage.key(index);
        if (key && (key.indexOf("vt-") === 0 || key.indexOf("vt.") === 0)) keys.push(key);
      }
    } catch (_) {}
    return keys.sort();
  }

  function renderPrivacyStorage() {
    var mount = document.getElementById("privacy-storage-list");
    if (!mount) return;
    replace(mount, []);
    var keys = virtualToolsStorageKeys();
    if (!keys.length) {
      mount.appendChild(el("p", { class: "note" }, ["No Virtual Tools preferences are stored in this browser."]));
      return;
    }
    keys.forEach(function (key) {
      var value = "";
      try { value = localStorage.getItem(key) || ""; } catch (_) {}
      var details = el("details", { class: "storage-entry" });
      details.appendChild(el("summary", {}, [key + " · " + formatBytes(new Blob([value]).size)]));
      details.appendChild(el("pre", { class: "storage-preview" }, [value.slice(0, 20000) + (value.length > 20000 ? "\n… preview truncated" : "")]));
      var remove = el("button", { class: "secondary", type: "button" }, ["Clear this key"]);
      remove.addEventListener("click", function () {
        try { localStorage.removeItem(key); } catch (_) {}
        renderPrivacyStorage();
      });
      details.appendChild(remove);
      mount.appendChild(details);
    });
  }

  function renderOfflineState() {
    var status = document.getElementById("offline-status");
    if (!status) return;
    var online = navigator.onLine ? "Online" : "Offline";
    if (!("caches" in window)) {
      status.textContent = online + " · Offline cache is not supported by this browser.";
      return;
    }
    caches.keys().then(function (names) {
      var ours = names.filter(function (name) { return name.indexOf("virtual-tools-") === 0; });
      return Promise.all(ours.map(function (name) {
        return caches.open(name).then(function (cache) { return cache.keys(); });
      })).then(function (entries) {
        var count = entries.reduce(function (sum, list) { return sum + list.length; }, 0);
        status.textContent = online + " · " + count + (count === 1 ? " cached page · " : " cached pages · ") + ours.length + (ours.length === 1 ? " cache." : " caches.");
      });
    }).catch(function () { status.textContent = online + " · Offline cache details are unavailable."; });
  }

  function clearOfflineData() {
    if (!("caches" in window)) return Promise.resolve();
    return caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return name.indexOf("virtual-tools-") === 0;
      }).map(function (name) { return caches.delete(name); }));
    });
  }

  function initPrivacyCenter() {
    if (!document.getElementById("privacy-center")) return;
    renderPrivacyStorage();
    renderOfflineState();
    window.addEventListener("online", renderOfflineState);
    window.addEventListener("offline", renderOfflineState);
    var clearLocal = document.getElementById("clear-local-data");
    if (clearLocal) clearLocal.addEventListener("click", function () {
      virtualToolsStorageKeys().forEach(function (key) {
        try { localStorage.removeItem(key); } catch (_) {}
      });
      try { sessionStorage.removeItem("vt-search"); } catch (_) {}
      renderPrivacyStorage();
    });
    var clearOffline = document.getElementById("clear-offline-data");
    if (clearOffline) clearOffline.addEventListener("click", function () {
      clearOffline.disabled = true;
      clearOfflineData().then(function () {
        clearOffline.disabled = false;
        renderOfflineState();
      });
    });
    var refresh = document.getElementById("refresh-storage-state");
    if (refresh) refresh.addEventListener("click", function () { renderPrivacyStorage(); renderOfflineState(); });
    var install = document.getElementById("install-app");
    if (install) {
      install.hidden = !deferredInstallPrompt;
      install.addEventListener("click", function () {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.finally(function () {
          deferredInstallPrompt = null;
          install.hidden = true;
        });
      });
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    // Access itself can throw in a sandboxed preview with an opaque origin.
    try {
      navigator.serviceWorker.register(ROOT + "service-worker.js", { scope: ROOT }).catch(function () {});
    } catch (_error) {}
  }

  function ready(callback) {
    if (document.readyState !== "loading") callback();
    else document.addEventListener("DOMContentLoaded", callback);
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    var button = document.getElementById("install-app");
    if (button) button.hidden = false;
  });

  ready(injectFavicon);
  ready(injectHeader);
  ready(initCatalog);
  ready(injectToolShell);
  ready(initPrivacyCenter);
  ready(registerServiceWorker);

  window.VT = {
    el: el,
    ready: ready,
    ROOT: ROOT,
    isFavorite: isFavorite,
    setFavorite: setFavorite
  };
})();
