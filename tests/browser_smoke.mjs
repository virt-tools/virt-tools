import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = (process.env.BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const siteOrigin = new URL(baseURL).origin;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const errors = [];

const representativeTools = [
  { slug: "json-formatter", category: "Text" },
  { slug: "base64", category: "Encoding" },
  { slug: "color-converter", category: "Design" },
  { slug: "cron-generator", category: "Time" },
  { slug: "password-generator", category: "Security" },
];

function routeURL(pathname) {
  return new URL(pathname, `${baseURL}/`).href;
}

function watchPage(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`${label}: console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`${label}: pageerror: ${error.message}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === siteOrigin && response.status() >= 400) {
      errors.push(`${label}: HTTP ${response.status()} for ${url.pathname}${url.search}`);
    }
  });
}

async function openPage(label, pathname) {
  const page = await context.newPage();
  watchPage(page, label);
  const response = await page.goto(routeURL(pathname), {
    waitUntil: "domcontentloaded",
  });
  assert.ok(response, `${label} returned no navigation response`);
  assert.equal(response.status(), 200, `${label} returned HTTP ${response.status()}`);
  return page;
}

async function assertSharedPage(page, expectedHeading, label) {
  await page.locator('#site-header[data-ready="true"]').waitFor({ timeout: 10_000 });
  const heading = page.locator("h1").first();
  await heading.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal((await heading.textContent()).trim(), expectedHeading, `${label} heading changed`);
  assert.ok((await page.title()).trim(), `${label} has no document title`);
}

try {
  const homepage = await openPage("homepage", "/");
  await assertSharedPage(homepage, "All tools", "homepage");
  await homepage.locator("#tool-catalog .catalog-row[data-slug]").first().waitFor({
    state: "visible",
    timeout: 10_000,
  });

  const initialCatalogState = await homepage.evaluate(() => ({
    rendered: document.querySelectorAll("#tool-catalog .catalog-row[data-slug]").length,
    countText: document.getElementById("tool-count")?.textContent?.trim() || "",
    catalogSize: Array.isArray(window.VIRTUAL_TOOLS) ? window.VIRTUAL_TOOLS.length : 0,
  }));
  assert.ok(initialCatalogState.rendered >= 5, "homepage rendered fewer than five tool rows");
  assert.ok(initialCatalogState.catalogSize >= initialCatalogState.rendered, "catalog size is inconsistent");
  assert.match(initialCatalogState.countText, /of [\d,]+ tools/i, "homepage tool count did not render");
  assert.equal(await homepage.locator("#risk-filter").count(), 0, "internal risk filter is publicly visible");
  assert.equal(await homepage.locator('[class*="risk-"]').count(), 0, "internal risk class is publicly rendered");
  assert.doesNotMatch(
    await homepage.locator("body").innerText(),
    /Risk not classified|Low risk|Use with care|High-stakes|Critical-risk/i,
    "internal risk taxonomy is publicly rendered",
  );

  const representativeCatalogEntries = await homepage.evaluate((tools) => {
    return tools.map(({ slug }) => {
      const entry = window.VIRTUAL_TOOLS.find((tool) => tool.slug === slug);
      return entry ? { slug: entry.slug, category: entry.category } : null;
    });
  }, representativeTools);
  representativeTools.forEach((expected, index) => {
    assert.deepEqual(
      representativeCatalogEntries[index],
      expected,
      `${expected.slug} is missing or has moved from the expected representative category`,
    );
  });

  const manifestHref = await homepage.locator('link[rel="manifest"]').getAttribute("href");
  assert.equal(manifestHref, "/manifest.webmanifest", "homepage manifest link changed");
  const pwaResources = await homepage.evaluate(async () => {
    const [manifestResponse, workerResponse] = await Promise.all([
      fetch("/manifest.webmanifest", { cache: "no-store" }),
      fetch("/service-worker.js", { cache: "no-store" }),
    ]);
    return {
      manifestStatus: manifestResponse.status,
      manifest: await manifestResponse.json(),
      workerStatus: workerResponse.status,
      workerSource: await workerResponse.text(),
    };
  });
  assert.equal(pwaResources.manifestStatus, 200, "web app manifest is not fetchable");
  assert.equal(pwaResources.manifest.name, "Virtual Tools", "web app manifest name changed");
  assert.equal(pwaResources.manifest.start_url, "/", "web app manifest start URL changed");
  assert.equal(pwaResources.manifest.scope, "/", "web app manifest scope changed");
  assert.equal(pwaResources.manifest.display, "standalone", "web app manifest display mode changed");
  assert.equal(pwaResources.workerStatus, 200, "service worker script is not fetchable");
  assert.match(pwaResources.workerSource, /addEventListener\(["']install["']/, "service worker has no install handler");
  const serviceWorker = await homepage.evaluate(async () => {
    let timer;
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Service worker did not become ready")), 10_000);
        }),
      ]);
      return { scope: registration.scope, scriptURL: registration.active.scriptURL };
    } finally {
      clearTimeout(timer);
    }
  });
  assert.equal(serviceWorker.scope, routeURL("/"), "service worker registered with the wrong scope");
  assert.equal(
    new URL(serviceWorker.scriptURL).pathname,
    "/service-worker.js",
    "unexpected active service worker script",
  );

  await homepage.locator('.catalog-chip', { hasText: "Math & converters" }).click();
  await homepage.waitForFunction(() => {
    const rows = [...document.querySelectorAll("#tool-catalog .catalog-row[data-slug]")];
    const allowed = ["Math", "Converters"];
    return rows.length > 0 && rows.every((row) => {
      const tool = window.VIRTUAL_TOOLS.find((entry) => entry.slug === row.dataset.slug);
      return tool && allowed.includes(tool.category);
    });
  });
  const mathCountText = (await homepage.locator("#tool-count").textContent()).trim();
  assert.match(mathCountText, /of [\d,]+ tools/i, "category chip did not update the result count");

  await homepage.locator('.catalog-chip', { hasText: "All" }).first().click();
  await homepage.waitForFunction(() => {
    return document.getElementById("tool-search")?.value === ""
      && document.querySelectorAll("#tool-catalog .catalog-row[data-slug]").length > 0
      && document.querySelector('.catalog-chip[aria-pressed="true"]')?.textContent.trim() === "All";
  });
  assert.notEqual(
    (await homepage.locator("#tool-count").textContent()).trim(),
    mathCountText,
    "reset did not restore the full catalog result count",
  );

  const noMatchQuery = "qzxvjkf829a647ac";
  await homepage.locator("#tool-search").fill(noMatchQuery);
  await homepage.locator("#search-empty").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    await homepage.locator("#tool-catalog .catalog-row[data-slug]").count(),
    0,
    "no-match search still rendered cards",
  );
  const suggestionHref = await homepage.locator("#search-empty a").getAttribute("href");
  const suggestionURL = new URL(suggestionHref, baseURL);
  assert.equal(suggestionURL.pathname, "/feedback/", "no-match search points outside feedback");
  assert.equal(suggestionURL.searchParams.get("kind"), "suggestion", "no-match feedback kind changed");
  assert.match(
    suggestionURL.searchParams.get("message") || "",
    new RegExp(noMatchQuery),
    "no-match feedback lost the search query",
  );
  await homepage.close();

  const workbenchPage = await openPage("formula deep link", "/");
  await workbenchPage.locator("#tool-catalog .catalog-row[data-slug]").first().waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await workbenchPage.locator("#tool-search").fill("triangle area heron");
  const formulaLink = workbenchPage.locator(
    '[data-slug="geometry-formula-workbench"] a.catalog-row-main[href*="formula=triangle-area-heron"]',
  );
  await formulaLink.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    await formulaLink.getAttribute("href"),
    "/tools/geometry-formula-workbench/?formula=triangle-area-heron",
    "formula search lost its exact deep-link intent",
  );
  await Promise.all([
    workbenchPage.waitForURL((url) => (
      url.pathname === "/tools/geometry-formula-workbench/"
      && url.searchParams.get("formula") === "triangle-area-heron"
    )),
    formulaLink.click(),
  ]);
  await assertSharedPage(workbenchPage, "Geometry Formula Workbench", "formula workbench");
  await workbenchPage.locator(".tool-shell-actions").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    await workbenchPage.locator(".tool-decision-guidance").count(),
    0,
    "low-consequence workbench displays unnecessary caution",
  );
  await workbenchPage.locator('#formula-select option[value="triangle-area-heron"]').waitFor({
    state: "attached",
    timeout: 10_000,
  });
  assert.equal(
    await workbenchPage.locator("#formula-select").inputValue(),
    "triangle-area-heron",
    "deep link selected the wrong formula",
  );
  assert.equal(
    (await workbenchPage.locator("#selected-formula-title").textContent()).trim(),
    "Triangle Area (Heron)",
    "deep link rendered the wrong formula title",
  );
  await workbenchPage.locator("#formula-example").click();
  await workbenchPage.locator("#formula-results").waitFor({ state: "visible", timeout: 10_000 });
  assert.deepEqual(
    await workbenchPage.locator("#formula-fields input").evaluateAll((inputs) => inputs.map((input) => input.value)),
    ["3", "4", "5"],
    "Heron example inputs changed",
  );
  assert.equal(
    (await workbenchPage.locator("#formula-error").textContent()).trim(),
    "",
    "Heron example displayed an error",
  );
  const formulaResults = await workbenchPage.locator("#formula-results dl").evaluate((list) => {
    const rows = {};
    for (let term = list.firstElementChild; term; term = term.nextElementSibling?.nextElementSibling) {
      rows[term.textContent.trim()] = term.nextElementSibling?.textContent.trim() || "";
    }
    return rows;
  });
  assert.deepEqual(
    formulaResults,
    { Area: "6 m²", Perimeter: "12 m" },
    "Heron example results changed",
  );
  Object.values(formulaResults).forEach((display) => {
    const numeric = Number(display.replace(/,/g, "").match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)?.[0]);
    assert.ok(Number.isFinite(numeric), `workbench rendered a non-finite result: ${display}`);
  });
  await workbenchPage.close();

  await context.route("**/assets/tool-meta/construction-materials-workbench.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "not valid JSON",
  }));
  const guidancePage = await openPage(
    "plain-language decision guidance",
    "/tools/construction-materials-workbench/",
  );
  await guidancePage.locator(".tool-decision-guidance").waitFor({ state: "visible", timeout: 10_000 });
  assert.match(
    (await guidancePage.locator(".tool-decision-guidance").textContent()).trim(),
    /verify measurements.*local requirements/i,
    "consequential tool lost its plain-language verification guidance",
  );
  assert.doesNotMatch(
    await guidancePage.locator(".tool-decision-guidance").innerText(),
    /moderate|high|critical|risk/i,
    "tool guidance exposes the internal risk taxonomy",
  );
  await guidancePage.close();
  await context.unroute("**/assets/tool-meta/construction-materials-workbench.json");

  const privacyPage = await openPage("privacy page", "/privacy/");
  await assertSharedPage(privacyPage, "Privacy & Trust", "privacy page");
  await privacyPage.locator("#privacy-storage-list").waitFor({ state: "visible", timeout: 10_000 });
  assert.match(
    (await privacyPage.locator("#privacy-center").textContent()),
    /Tool inputs stay local/,
    "privacy page lost its local-processing disclosure",
  );
  await privacyPage.waitForFunction(() => {
    const status = document.getElementById("offline-status")?.textContent || "";
    return status.length > 0 && !status.includes("Checking offline storage");
  });
  await privacyPage.close();

  const feedbackMessage = "Deterministic browser smoke";
  const feedbackPage = await openPage(
    "feedback page",
    `/feedback/?kind=bug&tool=${encodeURIComponent("Geometry Formula Workbench")}&message=${encodeURIComponent(feedbackMessage)}`,
  );
  await assertSharedPage(feedbackPage, "Feedback & Suggestions", "feedback page");
  assert.equal(await feedbackPage.locator("#kind").inputValue(), "bug", "feedback kind was not prefilled");
  assert.equal(
    await feedbackPage.locator("#tool").inputValue(),
    "Geometry Formula Workbench",
    "feedback tool was not prefilled",
  );
  assert.equal(
    await feedbackPage.locator("#message").inputValue(),
    feedbackMessage,
    "feedback message was not prefilled",
  );
  assert.ok(await feedbackPage.locator("#submit-panel").isVisible(), "feedback form is hidden");
  assert.ok(await feedbackPage.locator("#lookup-form").isVisible(), "feedback lookup form is hidden");

  const feedbackId = "123e4567-e89b-42d3-a456-426614174000";
  const originalMessage = "Original <b>feedback</b> remains plain text";
  await context.route(`**/api/feedback/${feedbackId}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      uuid: feedbackId,
      kind: "bug",
      tool: "Geometry Formula Workbench",
      message: originalMessage,
      status: "received",
      reply: "",
      created_at: "2026-01-02T03:04:05+00:00",
      updated_at: null,
    }),
  }));
  await feedbackPage.locator("#lookup-id").fill(feedbackId);
  await feedbackPage.locator("#lookup-btn").click();
  await feedbackPage.locator("#status-panel").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    await feedbackPage.locator("#status-message").count(),
    1,
    "feedback status does not display the original message",
  );
  assert.equal(
    await feedbackPage.locator("#status-message").textContent(),
    originalMessage,
    "feedback status changed or interpreted the original message",
  );
  assert.equal(
    await feedbackPage.locator("#status-message b").count(),
    0,
    "feedback message was rendered as HTML",
  );
  await context.unroute(`**/api/feedback/${feedbackId}`);
  await feedbackPage.close();

  for (const tool of representativeTools) {
    const toolPage = await openPage(`${tool.category} representative`, `/tools/${tool.slug}/`);
    await toolPage.locator('#site-header[data-ready="true"]').waitFor({ timeout: 10_000 });
    const heading = toolPage.locator("h1").first();
    await heading.waitFor({ state: "visible", timeout: 10_000 });
    assert.ok((await heading.textContent()).trim(), `${tool.slug} has an empty heading`);
    assert.ok((await toolPage.title()).trim(), `${tool.slug} has no document title`);
    await toolPage.close();
  }

  const moonPage = await openPage("moon phase regression", "/tools/moon-phase/");
  await assertSharedPage(moonPage, "Moon Phase Calculator", "moon phase regression");
  await moonPage.locator("#date").fill("2000-01-06T18:14");
  await moonPage.locator("#tz").fill("0");
  const utcPhase = {
    name: (await moonPage.locator("#name").textContent()).trim(),
    illumination: (await moonPage.locator("#ill").textContent()).trim(),
    next: (await moonPage.locator("#next").textContent()).trim(),
  };
  assert.match(utcPhase.name, /New Moon/, "reference instant is not classified as a new moon");
  assert.match(utcPhase.illumination, /^0\.0% illuminated · age 0\.0 days$/, "reference phase values changed");
  assert.match(utcPhase.next, /UTC\+00:00/, "UTC event times do not show the selected offset");

  await moonPage.locator("#tz").fill("13.75");
  await moonPage.locator("#date").fill("2000-01-07T07:59");
  const offsetPhase = {
    name: (await moonPage.locator("#name").textContent()).trim(),
    illumination: (await moonPage.locator("#ill").textContent()).trim(),
    next: (await moonPage.locator("#next").textContent()).trim(),
  };
  assert.equal(offsetPhase.name, utcPhase.name, "equivalent instants produced different phase names");
  assert.equal(
    offsetPhase.illumination,
    utcPhase.illumination,
    "equivalent instants produced different phase values",
  );
  assert.match(offsetPhase.next, /UTC\+13:45/, "fractional selected offset is missing from event times");
  assert.doesNotMatch(offsetPhase.next, /UTC\+00:00/, "event times ignored the selected offset");
  assert.equal(
    await moonPage.locator('#cycle [aria-current="true"]').count(),
    1,
    "moon cycle does not expose exactly one current phase",
  );
  assert.match(
    (await moonPage.locator("#note").textContent()).trim(),
    /mean-cycle estimate, not an astronomical ephemeris/i,
    "moon phase precision warning is missing",
  );
  assert.equal(
    await moonPage.locator('#note a[href*="aa.usno.navy.mil"]').count(),
    1,
    "moon phase authoritative comparison link is missing",
  );
  await moonPage.close();

  // Regressions fixed during the full-catalog audit.
  const previewer = await openPage("markdown previewer regression", "/tools/markdown-previewer/");
  await previewer.locator("#site-header[data-ready=\"true\"]").waitFor({ timeout: 10_000 });
  await previewer.locator("#src").fill("# Audit\n\n- one");
  await previewer.locator("#preview h1", { hasText: "Audit" }).waitFor({ timeout: 5_000 });
  assert.match(
    (await previewer.locator("#preview").innerText()).trim(),
    /Audit\s+one/i,
    "markdown previewer did not render its input",
  );
  await previewer.close();

  const puzzle = await openPage("2048 layout", "/tools/game-2048/");
  await puzzle.locator("#site-header[data-ready=\"true\"]").waitFor({ timeout: 10_000 });
  const tilesAligned = async () =>
    puzzle.evaluate(() => {
      const cells = [...document.querySelectorAll(".grid-cell")].map((el) => el.getBoundingClientRect());
      return [...document.querySelectorAll(".tile")].every((tile) => {
        const r = tile.getBoundingClientRect();
        return cells.some(
          (c) => Math.abs(c.x - r.x) < 1 && Math.abs(c.y - r.y) < 1 && Math.abs(c.width - r.width) < 1,
        );
      });
    });
  assert.ok(await tilesAligned(), "2048 tiles do not sit on the grid cells");
  await puzzle.locator("#board").press("ArrowLeft");
  await puzzle.waitForTimeout(300);
  assert.ok(await tilesAligned(), "2048 tiles drift off the grid after a move");
  const tileState = () =>
    puzzle.evaluate(() =>
      [...document.querySelectorAll(".tile")]
        .map((t) => `${t.textContent}@${t.style.left},${t.style.top}`)
        .sort()
        .join("|"),
    );
  const beforeTaps = await tileState();
  await puzzle.evaluate(() => {
    const board = document.getElementById("board");
    const fire = (type, x, y) =>
      board.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          changedTouches: [new Touch({ identifier: 1, target: board, clientX: x, clientY: y })],
        }),
      );
    fire("touchstart", 100, 300);
    fire("touchend", 100, 300);
    fire("touchstart", 300, 300);
    fire("touchend", 300, 300);
  });
  assert.equal(await tileState(), beforeTaps, "two taps queued a phantom 2048 swipe");
  await puzzle.evaluate(() => {
    const board = document.getElementById("board");
    const fire = (type, x, y) =>
      board.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          changedTouches: [new Touch({ identifier: 2, target: board, clientX: x, clientY: y })],
        }),
      );
    fire("touchstart", 100, 300);
    fire("touchmove", 300, 300);
    fire("touchend", 300, 300);
  });
  assert.notEqual(await tileState(), beforeTaps, "a 2048 swipe did not move tiles");
  await puzzle.close();

  // Landscape phones: the board must shrink to the viewport height instead of
  // forcing a mid-game scroll, and pull-to-refresh must not reload the game.
  const landscape = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const landscapePage = await landscape.newPage();
  try {
    await landscapePage.goto(routeURL("/tools/game-2048/"), { waitUntil: "domcontentloaded" });
    await landscapePage.locator('#site-header[data-ready="true"]').waitFor({ timeout: 10_000 });
    await landscapePage.evaluate(() =>
      document.getElementById("board").scrollIntoView({ block: "center" }),
    );
    await landscapePage.waitForTimeout(200);
    const landscapeFit = await landscapePage.evaluate(() => {
      const board = document.getElementById("board").getBoundingClientRect();
      const cells = [...document.querySelectorAll(".grid-cell")].map((el) => el.getBoundingClientRect());
      const aligned = [...document.querySelectorAll(".tile")].every((tile) => {
        const r = tile.getBoundingClientRect();
        return cells.some(
          (c) => Math.abs(c.x - r.x) < 1 && Math.abs(c.y - r.y) < 1 && Math.abs(c.width - r.width) < 1,
        );
      });
      return {
        top: board.top,
        bottom: board.bottom,
        height: board.height,
        viewport: window.innerHeight,
        aligned,
        overscrollY: getComputedStyle(document.body).overscrollBehaviorY,
        scrollRange: document.documentElement.scrollHeight - window.innerHeight,
      };
    });
    assert.ok(
      landscapeFit.top >= -0.5 && landscapeFit.bottom <= landscapeFit.viewport + 0.5,
      `2048 board does not fit a landscape viewport (${landscapeFit.height}px in ${landscapeFit.viewport}px)`,
    );
    assert.ok(landscapeFit.aligned, "2048 tiles do not sit on the grid cells in landscape");
    assert.equal(
      landscapeFit.overscrollY,
      "contain",
      "2048 page lets pull-to-refresh reload an in-progress game",
    );
    assert.ok(landscapeFit.scrollRange > 0, "2048 landscape page has no scrollable content");
    await landscapePage.evaluate(() => window.scrollTo(0, 40));
    await landscapePage.waitForTimeout(100);
    const landscapeScrollY = await landscapePage.evaluate(() => window.scrollY);
    assert.ok(landscapeScrollY >= 30, "2048 page can no longer scroll normally");
  } finally {
    await landscape.close();
  }

  const sudoku = await openPage("sudoku grid", "/tools/sudoku-puzzle/");
  await sudoku.locator("#site-header[data-ready=\"true\"]").waitFor({ timeout: 10_000 });
  const cellsFit = await sudoku.evaluate(() => {
    const grid = document.querySelector("#grid");
    const bounds = grid.getBoundingClientRect();
    const cells = [...grid.children];
    return cells.length === 81 && cells.every((cell) => {
      const r = cell.getBoundingClientRect();
      return r.right <= bounds.right + 0.5 && r.bottom <= bounds.bottom + 0.5;
    });
  });
  assert.ok(cellsFit, "sudoku cells overflow the board");
  await sudoku.close();

  for (const slug of ["piano", "peg-solitaire", "game-2048"]) {
    const game = await openPage(`${slug} mobile layout`, "/tools/" + slug + "/");
    await game.setViewportSize({ width: 320, height: 800 });
    await game.locator("#site-header[data-ready=\"true\"]").waitFor({ timeout: 10_000 });
    const overflow = await game.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(overflow <= 1, `${slug} overflows a 320px viewport by ${overflow}px`);
    await game.close();
  }

  const remoteExampleRequests = [];
  await context.route("https://example.com/**", (route) => {
    remoteExampleRequests.push(route.request().url());
    return route.abort();
  });
  const ogMeta = await openPage("og meta regression", "/tools/og-meta-generator/");
  await ogMeta.locator("#site-header[data-ready=\"true\"]").waitFor({ timeout: 10_000 });
  await ogMeta.waitForTimeout(500);
  assert.deepEqual(
    remoteExampleRequests,
    [],
    "og-meta-generator fetched the example image before the visitor edited it",
  );
  await ogMeta.close();
  await context.unroute("https://example.com/**");

  const wifiPlan = await openPage("Wi-Fi coverage sketch", "/tools/wifi-access-point-capacity-planner/");
  await assertSharedPage(wifiPlan, "Wi-Fi Access Point Capacity Planner", "Wi-Fi coverage sketch");
  await wifiPlan.locator("#coverage-canvas").waitFor({ state: "visible", timeout: 10_000 });
  await wifiPlan.locator("#clear-plan").click();
  assert.equal(
    (await wifiPlan.locator("#plan-summary strong").textContent()).trim(),
    "0.0% at target",
    "clearing the Wi-Fi sketch left coverage behind",
  );
  await wifiPlan.locator("#ap-x").fill("4");
  await wifiPlan.locator("#ap-y").fill("6");
  await wifiPlan.locator("#ap-add-form button[type=submit]").click();
  assert.equal(
    await wifiPlan.locator('#object-select option[value^="ap-"]').count(),
    1,
    "precise entry did not add an access point",
  );
  await wifiPlan.locator("#obstacle-add-form button[type=submit]").click();
  assert.equal(
    await wifiPlan.locator('#object-select option[value^="wall-"]').count(),
    1,
    "precise entry did not add a wall",
  );
  const planDownloadEvent = wifiPlan.waitForEvent("download");
  await wifiPlan.locator("#download-plan").click();
  const planDownload = await planDownloadEvent;
  assert.equal(planDownload.suggestedFilename(), "wifi-coverage-plan.json", "Wi-Fi plan download name changed");
  await wifiPlan.locator("#save-plan").click();
  await wifiPlan.reload({ waitUntil: "domcontentloaded" });
  await wifiPlan.locator("#coverage-canvas").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    await wifiPlan.locator('#object-select option[value^="ap-"]').count(),
    1,
    "browser-saved access point was not restored",
  );
  assert.equal(
    await wifiPlan.locator('#object-select option[value^="wall-"]').count(),
    1,
    "browser-saved wall was not restored",
  );
  await wifiPlan.locator("#add-floor").click();
  assert.equal(await wifiPlan.locator("#floor-select option").count(), 2, "second floor was not added");
  await wifiPlan.locator("#ap-add-form button[type=submit]").click();
  await wifiPlan.locator("#floor-select").selectOption("0");
  assert.match(
    await wifiPlan.locator("#plan-summary").innerText(),
    /Access points in building\s*2/,
    "cross-floor access points are omitted from the building plan",
  );
  await wifiPlan.setViewportSize({ width: 320, height: 900 });
  const wifiLayout = await wifiPlan.evaluate(() => {
    const panel = document.querySelector(".plan-panel").getBoundingClientRect();
    const canvasRect = document.getElementById("coverage-canvas").getBoundingClientRect();
    const controlsFit = [...document.querySelectorAll(".plan-panel button, .plan-panel input, .plan-panel select")]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= panel.left - 1 && rect.right <= panel.right + 1 && rect.height >= 43;
      });
    return { panelLeft: panel.left, panelRight: panel.right, canvasRight: canvasRect.right, controlsFit };
  });
  assert.ok(wifiLayout.canvasRight <= wifiLayout.panelRight + 1, "Wi-Fi canvas overflows its mobile panel");
  assert.ok(wifiLayout.controlsFit, "Wi-Fi plan controls overflow or miss the 44px target at 320px");
  await wifiPlan.close();

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Browser smoke passed: homepage/PWA, search/filter, formula deep link and calculation, privacy/feedback, ${representativeTools.length} representative tools, moon phase, Wi-Fi coverage sketch, and audit regressions`,
  );
} finally {
  await context.close();
  await browser.close();
}
