/* Virtual Tools shared shell, catalog, trust panel, and local preferences. */
(function () {
  "use strict";

  var ROOT = (window.VT_ROOT = window.VT_ROOT || "/");
  var USAGE_KEY = "vt-tool-usage";
  var RECENT_KEY = "vt-recent-tools";
  var FAVORITES_KEY = "vt-favorites";
  var VIEW_KEY = "vt-view";
  var SORT_KEY = "vt-sort";
  var PAGE_SIZE = 36;
  var TOOL_VIEWS = ["all", "favorites", "recently-used"];
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

  function wrenchIcon() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    [
      ["width", "20"], ["height", "20"], ["viewBox", "0 0 24 24"],
      ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"],
      ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]
    ].forEach(function (pair) { svg.setAttribute(pair[0], pair[1]); });
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z");
    svg.appendChild(path);
    return svg;
  }

  function inferredTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || inferredTheme();
  }

  function themeIcon() { return currentTheme() === "dark" ? "☀️" : "🌙"; }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("vt-theme", theme); } catch (_) {}
    var button = document.querySelector(".theme-toggle");
    if (button) button.textContent = themeIcon();
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

    var brand = el("a", { class: "brand", href: ROOT });
    var mark = el("span", { class: "brand-mark" });
    mark.appendChild(wrenchIcon());
    brand.appendChild(mark);
    brand.appendChild(el("span", {}, ["Virtual Tools"]));

    var nav = el("nav", { "aria-label": "Primary" }, [
      el("a", { href: ROOT }, ["Tools"]),
      el("a", { href: ROOT + "privacy/" }, ["Privacy & trust"]),
      el("a", { href: ROOT + "feedback/" }, ["Feedback"]),
      el("a", { href: "https://github.com/virt-tools/virt-tools", target: "_blank", rel: "noopener noreferrer" }, ["GitHub"])
    ]);
    var themeButton = el("button", {
      class: "theme-toggle", type: "button", "aria-label": "Toggle color theme",
      title: "Toggle dark or light theme"
    }, [themeIcon()]);
    themeButton.addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
    mount.appendChild(brand);
    mount.appendChild(nav);
    mount.appendChild(themeButton);

    var currentPath = location.pathname.replace(/\/+$/, "/");
    nav.querySelectorAll("a").forEach(function (link) {
      try {
        if (new URL(link.href, location.href).pathname.replace(/\/+$/, "/") === currentPath) {
          link.setAttribute("aria-current", "page");
        }
      } catch (_) {}
    });
  }

  function usageMap() {
    var value = readJSON(USAGE_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

  function recentTools() {
    var value = readJSON(RECENT_KEY, []);
    return Array.isArray(value) ? value.filter(function (item) { return item && typeof item.slug === "string"; }) : [];
  }

  function slugFromPath() {
    var match = location.pathname.match(/\/tools\/([^/]+)\/?/);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
  }

  function recordVisit() {
    var slug = slugFromPath();
    if (!slug) return;
    var usage = usageMap();
    usage[slug] = Math.max(0, Number(usage[slug]) || 0) + 1;
    saveJSON(USAGE_KEY, usage);

    var heading = document.querySelector("main h1, .tool-header h1, h1");
    var name = heading ? heading.textContent.trim() : "";
    if (!name) name = document.title.replace(/\s*[—|-].*$/, "").trim() || slug;
    var recent = recentTools().filter(function (item) { return item.slug !== slug; });
    recent.unshift({ slug: slug, name: name, ts: Date.now() });
    saveJSON(RECENT_KEY, recent.slice(0, 20));
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

  function maturityLabel(value) {
    return ({ unreviewed: "Not reviewed", draft: "Draft", reviewed: "Reviewed", verified: "Verified", deprecated: "Deprecated" })[value] || "Not reviewed";
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

  function toolCard(tool, showAdded, query) {
    var card = el("article", { class: "tool-card", "data-slug": tool.slug });
    var matchedFormula = formulaName(tool, query);
    var link = el("a", { class: "tool-card-link", href: formulaHref(tool, query) });
    link.appendChild(el("span", { class: "tool-card-icon", "aria-hidden": "true" }, [tool.icon || "🛠️"]));
    var content = el("div", { class: "tool-card-content" });
    content.appendChild(el("span", { class: "tool-card-name" }, [matchedFormula || tool.name]));
    if (matchedFormula) content.appendChild(el("span", { class: "tool-card-parent" }, [tool.name]));
    content.appendChild(el("p", { class: "tool-card-desc" }, [tool.description]));
    content.appendChild(el("span", { class: "tool-card-category" }, [categoryName(tool.category)]));
    if (showAdded && tool.added) content.appendChild(el("span", { class: "tool-card-added" }, [formatAdded(tool.added)]));
    link.appendChild(content);
    card.appendChild(link);
    var favorite = isFavorite(tool.slug);
    var favoriteButton = el("button", {
      class: "tool-favorite" + (favorite ? " is-favorite" : ""), type: "button",
      "data-favorite": tool.slug,
      "aria-label": (favorite ? "Remove " : "Add ") + tool.name + (favorite ? " from favorites" : " to favorites"),
      "aria-pressed": favorite ? "true" : "false", title: favorite ? "Remove from favorites" : "Add to favorites"
    }, [favorite ? "★" : "☆"]);
    card.appendChild(favoriteButton);
    return card;
  }

  var catalogMount = null;
  var searchInput = null;
  var emptyNote = null;
  var countElement = null;
  var categoryFilter = null;
  var maturityFilter = null;
  var loadMoreButton = null;
  var sortSelect = null;
  var searchAllButton = null;
  var displayLimit = PAGE_SIZE;
  var currentView = "all";

  function savedView() {
    try {
      var value = localStorage.getItem(VIEW_KEY) || "all";
      if (value === "most-used") return "recently-used";
      return TOOL_VIEWS.indexOf(value) === -1 ? "all" : value;
    } catch (_) { return "all"; }
  }

  function sourceForView() {
    var all = (window.VIRTUAL_TOOLS || []).slice();
    if (currentView === "recently-used") {
      all = recentTools().map(function (item) { return toolIndex[item.slug]; }).filter(Boolean);
      var visited = new Set(all.map(function (tool) { return tool.slug; }));
      var usage = usageMap();
      all = all.concat((window.VIRTUAL_TOOLS || []).filter(function (tool) {
        return Number(usage[tool.slug]) > 0 && !visited.has(tool.slug);
      }).sort(function (a, b) { return Number(usage[b.slug]) - Number(usage[a.slug]); }));
    }
    if (currentView === "favorites") {
      var favorites = favoritesSet();
      all = all.filter(function (tool) { return favorites.has(tool.slug); });
    }
    var sort = sortSelect ? sortSelect.value : "name";
    if (sort === "newest") return all.sort(function (a, b) { return (Date.parse(b.added) || 0) - (Date.parse(a.added) || 0); });
    if (sort === "used") {
      var counts = usageMap();
      return all.sort(function (a, b) {
        return (Number(counts[b.slug]) || 0) - (Number(counts[a.slug]) || 0) || a.name.localeCompare(b.name);
      });
    }
    if (currentView === "recently-used") return all;
    return all.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function matchesCategory(tool, category) {
    if (!category) return true;
    if (category === "Networking") return tool.category === "Networking" || tool.category === "IT & Networking";
    var group = CATEGORY_GROUPS.find(function (item) { return "group:" + item.id === category; });
    return group ? group.categories.indexOf(tool.category) !== -1 : tool.category === category;
  }

  function filteredTools() {
    var query = normalizeSearch(searchInput ? searchInput.value : "");
    var category = categoryFilter ? categoryFilter.value : "";
    var maturity = maturityFilter ? maturityFilter.value : "";
    var ranked = [];
    sourceForView().forEach(function (tool, order) {
      if (!matchesCategory(tool, category)) return;
      if (maturity && tool.maturity !== maturity) return;
      var score = query ? scoreTool(tool, query) : 0;
      if (score < 0) return;
      ranked.push({ tool: tool, score: score, order: order });
    });
    if (query) {
      ranked.sort(function (a, b) {
        return b.score - a.score || a.tool.name.localeCompare(b.tool.name);
      });
    } else {
      ranked.sort(function (a, b) { return a.order - b.order; });
    }
    return ranked.map(function (item) { return item.tool; });
  }

  function renderEmpty(query) {
    if (!emptyNote) return;
    replace(emptyNote, []);
    if (query) {
      emptyNote.appendChild(document.createTextNode('No tools match "' + query + '". '));
      if (currentView !== "all" || (categoryFilter && categoryFilter.value) || (maturityFilter && maturityFilter.value)) {
        emptyNote.appendChild(document.createTextNode("Try searching all tools with filters cleared."));
        emptyNote.hidden = false;
        return;
      }
      var message = 'I searched for "' + query + '" but could not find a matching tool. Could you add one for this?';
      emptyNote.appendChild(el("a", {
        href: ROOT + "feedback/?kind=suggestion&message=" + encodeURIComponent(message)
      }, ["Suggest this tool"]));
      emptyNote.appendChild(document.createTextNode("."));
    } else if (currentView === "favorites") {
      emptyNote.appendChild(document.createTextNode("You have no favorite tools yet. Select the star on any tool to add one."));
    } else if (currentView === "recently-used") {
      emptyNote.appendChild(document.createTextNode("Your local tool history is empty. It will appear here after you use a tool."));
    } else {
      emptyNote.appendChild(document.createTextNode("No tools match the selected filters."));
    }
    emptyNote.hidden = false;
  }

  function renderCatalog() {
    if (!catalogMount) return;
    var results = filteredTools();
    var shown = results.slice(0, displayLimit);
    replace(catalogMount, []);
    if (shown.length) {
      var grid = el("div", { class: "tool-grid" + (searchInput && searchInput.value.trim() ? " tool-grid-search" : "") });
      var query = searchInput ? searchInput.value : "";
      shown.forEach(function (tool) {
        grid.appendChild(toolCard(tool, sortSelect && sortSelect.value === "newest", query));
      });
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
        ? results.length + " matching tools · " + total + " available"
        : "Showing " + shown.length + " of " + results.length + " matching tools · " + total + " available";
    }
    var hasQuery = Boolean(searchInput && searchInput.value.trim());
    if (sortSelect) sortSelect.disabled = hasQuery;
    if (searchAllButton) searchAllButton.hidden = !hasQuery || (currentView === "all" && !categoryFilter.value && !maturityFilter.value);
    var selectedFilters = Number(Boolean(categoryFilter && categoryFilter.value)) + Number(Boolean(maturityFilter && maturityFilter.value));
    var filterLabel = document.getElementById("catalog-filter-label");
    if (filterLabel) filterLabel.textContent = selectedFilters ? "Filters (" + selectedFilters + ")" : "Filters";
    catalogMount.setAttribute("aria-label", currentView === "favorites" ? "Favorite tools" : currentView === "recently-used" ? "Recently used tools" : "All tools");
    renderStart();
  }

  function syncTabs() {
    document.querySelectorAll(".view-tab").forEach(function (tab) {
      var active = tab.getAttribute("data-view") === currentView;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
  }

  function switchView(view) {
    if (TOOL_VIEWS.indexOf(view) === -1) return;
    currentView = view;
    displayLimit = PAGE_SIZE;
    try { localStorage.setItem(VIEW_KEY, view); } catch (_) {}
    syncTabs();
    renderCatalog();
  }

  function populateCategories() {
    if (!categoryFilter) return;
    var counts = {};
    (window.VIRTUAL_TOOLS || []).forEach(function (tool) { counts[tool.category] = (counts[tool.category] || 0) + 1; });
    var grouped = new Set();
    CATEGORY_GROUPS.forEach(function (group) {
      var categories = group.categories.filter(function (category) { return counts[category]; });
      if (!categories.length) return;
      var options = el("optgroup", { label: group.name });
      var total = categories.reduce(function (sum, category) { grouped.add(category); return sum + counts[category]; }, 0);
      options.appendChild(el("option", { value: "group:" + group.id }, ["All " + group.name.toLowerCase() + " (" + total + ")"]));
      categories.forEach(function (category) {
        if (category === "IT & Networking" && counts.Networking) return;
        var count = counts[category] + (category === "Networking" ? counts["IT & Networking"] || 0 : 0);
        options.appendChild(el("option", { value: category }, [categoryName(category) + " (" + count + ")"]));
      });
      categoryFilter.appendChild(options);
    });
    Object.keys(counts).sort().filter(function (category) { return !grouped.has(category); }).forEach(function (category) {
      categoryFilter.appendChild(el("option", { value: category }, [categoryName(category) + " (" + counts[category] + ")"]));
    });
    if (maturityFilter) {
      var statuses = {};
      (window.VIRTUAL_TOOLS || []).forEach(function (tool) { statuses[tool.maturity] = true; });
      ["verified", "reviewed", "draft", "unreviewed", "deprecated"].filter(function (status) { return statuses[status]; }).forEach(function (status) {
        maturityFilter.appendChild(el("option", { value: status }, [maturityLabel(status)]));
      });
    }
  }

  function renderStart() {
    var mount = document.getElementById("catalog-start");
    if (!mount) return;
    mount.hidden = currentView !== "all" || Boolean(searchInput.value.trim() || categoryFilter.value || maturityFilter.value);
    if (mount.hidden) return;
    replace(mount, []);
    var favorites = favoritesSet();
    var shortcuts = (window.VIRTUAL_TOOLS || []).filter(function (tool) { return favorites.has(tool.slug); }).slice(0, 4);
    recentTools().forEach(function (item) {
      if (shortcuts.length < 6 && toolIndex[item.slug] && !shortcuts.some(function (tool) { return tool.slug === item.slug; })) shortcuts.push(toolIndex[item.slug]);
    });
    if (shortcuts.length) {
      mount.appendChild(el("h2", {}, ["Pick up where you left off"]));
      var links = el("div", { class: "catalog-shortcuts" });
      shortcuts.forEach(function (tool) { links.appendChild(el("a", { href: ROOT + "tools/" + tool.slug + "/" }, [tool.name])); });
      mount.appendChild(links);
    }
    mount.appendChild(el("h2", {}, ["Common tasks"]));
    var tasks = el("div", { class: "catalog-shortcuts" });
    [
      { name: "Format JSON", query: "JSON formatter" },
      { name: "Convert units", query: "unit converter" },
      { name: "Count words", query: "word counter" },
      { name: "Create a QR code", query: "QR code" },
      { name: "Calculate a loan", query: "loan" }
    ].forEach(function (task) {
      var button = el("button", { class: "secondary", type: "button" }, [task.name]);
      button.addEventListener("click", function () {
        searchInput.value = task.query;
        displayLimit = PAGE_SIZE;
        renderCatalog();
        searchInput.focus();
      });
      tasks.appendChild(button);
    });
    mount.appendChild(tasks);
    var browse = el("details", { class: "catalog-browse" });
    browse.appendChild(el("summary", {}, ["Browse by category"]));
    var groups = el("div", { class: "catalog-groups" });
    CATEGORY_GROUPS.forEach(function (group) {
      if (!Array.prototype.some.call(categoryFilter.options, function (option) { return option.value === "group:" + group.id; })) return;
      var button = el("button", { class: "secondary", type: "button", "data-category-group": group.id }, [group.name]);
      button.addEventListener("click", function () {
        categoryFilter.value = "group:" + group.id;
        document.getElementById("catalog-filters").open = true;
        displayLimit = PAGE_SIZE;
        renderCatalog();
        categoryFilter.focus();
      });
      groups.appendChild(button);
    });
    browse.appendChild(groups);
    mount.appendChild(browse);
  }

  function initCatalog() {
    catalogMount = document.getElementById("tool-catalog");
    if (!catalogMount || !window.VIRTUAL_TOOLS) return;
    buildToolIndex();
    searchInput = document.getElementById("tool-search");
    emptyNote = document.getElementById("search-empty");
    countElement = document.getElementById("tool-count");
    categoryFilter = document.getElementById("category-filter");
    maturityFilter = document.getElementById("maturity-filter");
    loadMoreButton = document.getElementById("catalog-load-more");
    sortSelect = document.getElementById("catalog-sort");
    searchAllButton = document.getElementById("catalog-search-all");
    currentView = savedView();
    populateCategories();
    try {
      var previousView = localStorage.getItem(VIEW_KEY);
      var savedSort = localStorage.getItem(SORT_KEY);
      if (sortSelect && ["name", "newest", "used"].indexOf(savedSort) !== -1) sortSelect.value = savedSort;
      else if (sortSelect && previousView === "recent-added") sortSelect.value = "newest";
      else if (sortSelect && previousView === "most-used") sortSelect.value = "used";
    } catch (_) {}
    syncTabs();

    var timer = null;
    if (searchInput) searchInput.addEventListener("input", function () {
      displayLimit = PAGE_SIZE;
      clearTimeout(timer);
      timer = setTimeout(renderCatalog, 90);
      try { sessionStorage.setItem("vt-search", searchInput.value); } catch (_) {}
    });
    [categoryFilter, maturityFilter].forEach(function (control) {
      if (control) control.addEventListener("change", function () { displayLimit = PAGE_SIZE; renderCatalog(); });
    });
    if (sortSelect) sortSelect.addEventListener("change", function () {
      try { localStorage.setItem(SORT_KEY, sortSelect.value); } catch (_) {}
      displayLimit = PAGE_SIZE;
      renderCatalog();
    });
    if (searchAllButton) searchAllButton.addEventListener("click", function () {
      categoryFilter.value = "";
      maturityFilter.value = "";
      switchView("all");
      searchInput.focus();
    });
    var reset = document.getElementById("catalog-reset");
    if (reset) reset.addEventListener("click", function () {
      if (searchInput) searchInput.value = "";
      if (categoryFilter) categoryFilter.value = "";
      if (maturityFilter) maturityFilter.value = "";
      displayLimit = PAGE_SIZE;
      try { sessionStorage.removeItem("vt-search"); } catch (_) {}
      renderCatalog();
      if (searchInput) searchInput.focus();
    });
    if (loadMoreButton) loadMoreButton.addEventListener("click", function () {
      displayLimit += PAGE_SIZE;
      renderCatalog();
      var firstNew = catalogMount.querySelectorAll(".tool-card")[displayLimit - PAGE_SIZE];
      if (firstNew) {
        var link = firstNew.querySelector("a");
        if (link) link.focus();
      }
    });
    document.querySelectorAll(".view-tab").forEach(function (tab) {
      tab.addEventListener("click", function () { switchView(tab.getAttribute("data-view")); });
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        var tabs = Array.prototype.slice.call(document.querySelectorAll(".view-tab"));
        var next = (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        switchView(tabs[next].getAttribute("data-view"));
      });
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

    try {
      var params = new URLSearchParams(location.search);
      var query = params.get("q");
      var category = params.get("category");
      if (category === "IT & Networking") category = "Networking";
      if (query && searchInput) searchInput.value = query;
      if (query || category) currentView = "all";
      if (category && categoryFilter && Array.prototype.some.call(categoryFilter.options, function (option) { return option.value === category; })) {
        categoryFilter.value = category;
      }
      if (!query && performance.getEntriesByType) {
        var navigation = performance.getEntriesByType("navigation")[0];
        if (navigation && navigation.type === "back_forward" && searchInput) {
          searchInput.value = sessionStorage.getItem("vt-search") || "";
        }
      }
    } catch (_) {}
    syncTabs();
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
      maturity: metaContent("vt:maturity") || "unreviewed",
      reviewedAt: metaContent("vt:reviewed-at") || null,
      method: metaContent("vt:method") || null,
      sources: [],
      testCaseCount: Number(metaContent("vt:test-count")) || 0,
      related: []
    };
  }

  function safeHttpURL(value) {
    try {
      var url = new URL(value, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch (_) { return null; }
  }

  function renderTrustPanel(panel, metadata) {
    var statusClass = "status-" + metadata.maturity;
    var badges = el("div", { class: "tool-trust-badges" }, [
      el("span", { class: "trust-badge privacy-ok" }, ["Browser-local inputs"]),
      el("span", { class: "trust-badge " + statusClass }, [maturityLabel(metadata.maturity)])
    ]);
    var guidance = typeof metadata.guidance === "string" ? metadata.guidance.trim() : "";
    var details = el("details", { class: "tool-method" });
    details.appendChild(el("summary", {}, ["About this tool: method & review status"]));
    details.appendChild(badges);
    details.appendChild(el("p", {}, [metadata.method || "A tool-specific method description has not been published yet."]));
    if (metadata.reviewedAt) {
      var reviewed = new Date(metadata.reviewedAt);
      details.appendChild(el("p", {}, ["Last reviewed: " + (isNaN(reviewed.getTime()) ? metadata.reviewedAt : reviewed.toLocaleDateString()) + "."]));
    } else {
      details.appendChild(el("p", {}, ["Independent review date: not recorded."]));
    }
    var sources = Array.isArray(metadata.sources) ? metadata.sources : [];
    if (sources.length) {
      var list = el("ul", { class: "tool-source-list" });
      sources.forEach(function (source) {
        var item = el("li");
        var href = source && safeHttpURL(source.url);
        item.appendChild(href
          ? el("a", { href: href, target: "_blank", rel: "noopener noreferrer" }, [source.title])
          : document.createTextNode(source && source.title ? source.title : "Untitled source"));
        list.appendChild(item);
      });
      details.appendChild(list);
    } else {
      details.appendChild(el("p", {}, ["Published sources: none recorded."]));
    }
    details.appendChild(el("p", {}, ["Recorded test cases: " + (Number(metadata.testCaseCount) || 0) + "."]));
    replace(panel, [details]);
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
    if (!main || main.querySelector(".tool-trust-panel")) return;
    var heading = main.querySelector("h1");
    var title = heading ? heading.textContent.trim() : slug;
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

    var panel = el("aside", { class: "tool-trust-panel", "aria-label": "Tool trust and status" });
    var metadata = defaultToolMetadata(slug);
    main.appendChild(actions);
    main.appendChild(panel);
    renderTrustPanel(panel, metadata);

    fetch(ROOT + "assets/tool-meta/" + encodeURIComponent(slug) + ".json", {
      credentials: "same-origin", cache: "no-cache", headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("metadata unavailable");
      return response.json();
    }).then(function (loaded) {
      metadata = Object.assign(metadata, loaded || {});
      renderTrustPanel(panel, metadata);
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
      mount.appendChild(el("p", { class: "note" }, ["No Virtual Tools preferences or history are stored in this browser."]));
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
        status.textContent = online + " · " + count + " offline entries across " + ours.length + " Virtual Tools caches.";
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
  ready(recordVisit);
  ready(initCatalog);
  ready(injectToolShell);
  ready(initPrivacyCenter);
  ready(registerServiceWorker);

  window.VT = {
    el: el,
    ready: ready,
    ROOT: ROOT,
    recentTools: recentTools,
    isFavorite: isFavorite,
    setFavorite: setFavorite
  };
})();
