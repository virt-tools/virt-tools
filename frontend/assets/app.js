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
    mount.appendChild(brand);
    mount.appendChild(nav);
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
          card.appendChild(el("div", { class: "tool-card-icon" }, [t.icon || "🛠️"]));
          card.appendChild(el("div", { class: "tool-card-name" }, [t.name]));
          card.appendChild(el("div", { class: "tool-card-desc" }, [t.description]));
          grid.appendChild(card);
        });
        mount.appendChild(grid);
      });
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