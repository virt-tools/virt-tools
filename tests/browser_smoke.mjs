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
  await assertSharedPage(homepage, "Virtual Tools", "homepage");
  await homepage.locator("#tool-catalog .tool-card[data-slug]").first().waitFor({
    state: "visible",
    timeout: 10_000,
  });

  const initialCatalogState = await homepage.evaluate(() => ({
    rendered: document.querySelectorAll("#tool-catalog .tool-card[data-slug]").length,
    countText: document.getElementById("tool-count")?.textContent?.trim() || "",
    catalogSize: Array.isArray(window.VIRTUAL_TOOLS) ? window.VIRTUAL_TOOLS.length : 0,
  }));
  assert.ok(initialCatalogState.rendered >= 5, "homepage rendered fewer than five tool cards");
  assert.ok(initialCatalogState.catalogSize >= initialCatalogState.rendered, "catalog size is inconsistent");
  assert.match(initialCatalogState.countText, /available/i, "homepage tool count did not render");
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
  await homepage.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration("/");
      return Boolean(registration?.active);
    },
    undefined,
    { timeout: 10_000 },
  );
  const serviceWorker = await homepage.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return {
      scope: registration?.scope || "",
      scriptURL: registration?.active?.scriptURL || "",
    };
  });
  assert.equal(serviceWorker.scope, routeURL("/"), "service worker registered with the wrong scope");
  assert.equal(
    new URL(serviceWorker.scriptURL).pathname,
    "/service-worker.js",
    "unexpected active service worker script",
  );

  await homepage.locator("#catalog-filters > summary").click();
  await homepage.locator("#category-filter").selectOption("Math");
  await homepage.waitForFunction(() => {
    const cards = [...document.querySelectorAll("#tool-catalog .tool-card[data-slug]")];
    return cards.length > 0 && cards.every((card) => {
      const tool = window.VIRTUAL_TOOLS.find((entry) => entry.slug === card.dataset.slug);
      return tool?.category === "Math";
    });
  });
  const mathCountText = (await homepage.locator("#tool-count").textContent()).trim();
  assert.match(mathCountText, /matching tools/i, "Math filter did not update the result count");

  await homepage.locator("#catalog-reset").click();
  await homepage.waitForFunction(() => {
    return document.getElementById("tool-search")?.value === ""
      && document.getElementById("category-filter")?.value === ""
      && document.getElementById("maturity-filter")?.value === ""
      && document.querySelectorAll("#tool-catalog .tool-card[data-slug]").length > 0;
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
    await homepage.locator("#tool-catalog .tool-card[data-slug]").count(),
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
  await workbenchPage.locator("#tool-catalog .tool-card[data-slug]").first().waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await workbenchPage.locator("#tool-search").fill("triangle area heron");
  const formulaLink = workbenchPage.locator(
    '[data-slug="geometry-formula-workbench"] a.tool-card-link',
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
  await workbenchPage.locator(".tool-trust-panel").waitFor({ state: "visible", timeout: 10_000 });
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
    await guidancePage.locator(".tool-trust-panel").innerText(),
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

  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Browser smoke passed: homepage/PWA, search/filter, formula deep link and calculation, privacy/feedback, ${representativeTools.length} representative tools, and moon phase regression`,
  );
} finally {
  await context.close();
  await browser.close();
}
