/* Bounded, privacy-aware offline support for Virtual Tools. */
"use strict";

// The production image replaces this sentinel with the deterministic shared
// asset hash. Keeping the value in this file makes a changed release install a
// fresh worker and retire every older bounded cache namespace.
var VERSION = "__VT_ASSET_VERSION__";
var PREFIX = "virtual-tools-";
var SHELL_CACHE = PREFIX + "shell-" + VERSION;
var PAGE_CACHE = PREFIX + "pages-" + VERSION;
var ASSET_CACHE = PREFIX + "assets-" + VERSION;
var MAX_PAGES = 32;
var MAX_ASSETS = 64;
var SHELL = [
  "/",
  "/index.html",
  "/privacy/",
  "/assets/style.css",
  "/assets/app.js",
  "/assets/theme-init.js",
  "/assets/tools.js",
  "/favicon.svg",
  "/manifest.webmanifest"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(SHELL_CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (name) {
      return name.indexOf(PREFIX) === 0 && [SHELL_CACHE, PAGE_CACHE, ASSET_CACHE].indexOf(name) === -1;
    }).map(function (name) { return caches.delete(name); }));
  }).then(function () { return self.clients.claim(); }));
});

function trim(cacheName, maximum) {
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= maximum) return undefined;
      return Promise.all(keys.slice(0, keys.length - maximum).map(function (request) {
        return cache.delete(request);
      }));
    });
  });
}

function canStore(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.hash) return false;
  if (url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("/feedback") === 0) return false;
  if (url.pathname.indexOf("/assets/tool-meta/") === 0) return false;
  if (url.pathname === "/assets/tool-catalog.json" || url.pathname === "/assets/tool-catalog.schema.json") return false;
  return true;
}

function assetCacheKey(request, url) {
  if (!url.search) return request;
  // Docker adds an allowlisted build version to shared asset URLs. It is the only
  // query form safe to strip; all arbitrary query values bypass storage.
  if (!/^\?v=[A-Za-z0-9._-]{8,64}$/.test(url.search)) return null;
  return new Request(url.origin + url.pathname, { method: "GET" });
}

function networkFirstPage(request) {
  return fetch(request).then(function (response) {
    if (response.ok && response.type === "basic") {
      var clone = response.clone();
      return caches.open(PAGE_CACHE).then(function (cache) {
        return cache.put(request, clone);
      }).then(function () {
        return trim(PAGE_CACHE, MAX_PAGES);
      }).catch(function () {
        // A quota/cache failure must not hide a successful network response.
        return undefined;
      }).then(function () { return response; });
    }
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      return cached || caches.match("/");
    });
  });
}

function updateAsset(request, key) {
  return fetch(request).then(function (response) {
    if (!response.ok || response.type !== "basic") return response;
    var clone = response.clone();
    return caches.open(ASSET_CACHE).then(function (cache) {
      return cache.put(key, clone);
    }).then(function () {
      return trim(ASSET_CACHE, MAX_ASSETS);
    }).catch(function () {
      return undefined;
    }).then(function () { return response; });
  });
}

function cachedAsset(request, key, event) {
  var update = updateAsset(request, key);
  // A cached response can resolve immediately; explicitly retain the refresh
  // so the worker cannot be terminated before cache.put/trim completes.
  event.waitUntil(update.then(function () { return undefined; }).catch(function () { return undefined; }));
  return caches.match(key).then(function (cached) {
    return cached || update;
  }).catch(function () {
    return update.catch(function () { return Response.error(); });
  });
}

function networkFirstAsset(request, key) {
  return updateAsset(request, key).catch(function () {
    return caches.match(key).then(function (cached) { return cached || Response.error(); });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (!canStore(request, url)) return;

  // Navigation URLs with any query are deliberately network-only. Feedback
  // bearer identifiers and user inputs must never enter Cache Storage.
  if (request.mode === "navigate" && url.search) return;
  var isToolPage = request.mode === "navigate" && /^\/tools\/[a-z0-9-]+\/$/.test(url.pathname);
  var isSafeShellPage = request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/privacy/");
  if (isToolPage || isSafeShellPage) {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.indexOf("/assets/") === 0 || url.pathname === "/favicon.svg" || url.pathname === "/manifest.webmanifest") {
    var key = assetCacheKey(request, url);
    if (key) event.respondWith(url.search ? networkFirstAsset(request, key) : cachedAsset(request, key, event));
  }
});

self.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "CLEAR_VIRTUAL_TOOLS_CACHES") return;
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (name) { return name.indexOf(PREFIX) === 0; })
      .map(function (name) { return caches.delete(name); }));
  }));
});
