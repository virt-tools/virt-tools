import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = (process.env.BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const browser = await chromium.launch({ headless: true });
const errors = [];

function luminance(color) {
  const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function open(context, path) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(`${baseURL}${path}`);
  assert.equal(response.status(), 200);
  await page.locator('#site-header[data-ready="true"]').waitFor();
  return page;
}

async function expectResults(page) {
  await page.locator("#tool-catalog .tool-card").first().waitFor();
  assert.ok(await page.locator("#tool-catalog .tool-card").count());
}

try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const home = await open(context, "/");
  await expectResults(home);
  assert.deepEqual(await home.locator(".view-tab").allTextContents(), ["All tools", "Favorites", "Recent"]);
  assert.equal(await home.locator("#catalog-filters").getAttribute("open"), null);
  assert.deepEqual(await home.locator("#maturity-filter option").allTextContents(), ["All statuses", "Draft", "Not reviewed"]);
  assert.equal(await home.locator("#catalog-start [data-category-group]").count(), 10);

  for (const task of ["Format JSON", "Convert units", "Count words", "Create a QR code", "Calculate a loan"]) {
    await home.locator("#tool-search").fill("");
    await home.getByRole("button", { name: task, exact: true }).click();
    await expectResults(home);
    assert.equal(await home.locator("#catalog-start").isVisible(), false);
  }
  await home.locator("#tool-search").fill("");
  await home.locator(".catalog-browse > summary").click();
  await home.locator('[data-category-group="developer-it"]').click();
  assert.equal(await home.locator("#category-filter").inputValue(), "group:developer-it");
  assert.equal(await home.locator("#catalog-filters").getAttribute("open"), "");
  await home.locator("#catalog-reset").click();
  await expectResults(home);

  const firstSlug = await home.locator("#tool-catalog .tool-card").first().getAttribute("data-slug");
  await home.locator(`#tool-catalog [data-slug="${firstSlug}"] .tool-favorite`).click();
  assert.equal(new URL(home.url()).pathname, "/", "favorite click opened the tool");
  await home.getByRole("tab", { name: "Favorites", exact: true }).click();
  assert.equal(await home.locator("#tool-catalog .tool-card").count(), 1);
  await home.locator("#tool-search").fill("JSON formatter");
  await home.locator("#search-empty").waitFor({ state: "visible" });
  await home.getByRole("button", { name: "Search all tools", exact: true }).click();
  await expectResults(home);
  assert.equal(await home.locator("#tool-search").inputValue(), "JSON formatter");
  assert.equal(await home.getByRole("tab", { name: "All tools", exact: true }).getAttribute("aria-selected"), "true");

  await home.locator("#tool-search").fill("triangle area heron");
  const formulaLink = home.locator('[data-slug="geometry-formula-workbench"] .tool-card-link');
  await formulaLink.waitFor();
  assert.equal(await formulaLink.locator(".tool-card-name").textContent(), "Triangle Area (Heron)");
  assert.match(await formulaLink.getAttribute("href"), /\?formula=triangle-area-heron$/);
  await formulaLink.click();
  await home.locator("#formula-fields input").first().waitFor();
  assert.equal(await home.locator(".tool-header .back").count(), 0);
  assert.equal(await home.locator(".tool-breadcrumbs a").count(), 1);
  assert.equal(await home.locator(".tool-trust-panel details").getAttribute("open"), null);
  assert.ok(await home.evaluate(() => {
    const picker = document.querySelector(".formula-picker");
    const actions = document.querySelector(".tool-shell-actions");
    const trust = document.querySelector(".tool-trust-panel");
    return Boolean(picker.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)
      && Boolean(picker.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), "secondary actions precede the tool inputs");
  await home.locator("#formula-example").click();
  await home.locator("#formula-results").waitFor({ state: "visible" });
  assert.match(await home.locator("#formula-results").innerText(), /6 m²/);

  const guidance = await open(context, "/tools/construction-materials-workbench/");
  await guidance.locator(".tool-decision-guidance").waitFor({ state: "visible" });
  assert.ok(await guidance.evaluate(() => {
    const note = document.querySelector(".tool-decision-guidance");
    const picker = document.querySelector(".formula-picker");
    return Boolean(note.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), "calculation guidance is hidden below the tool");
  await guidance.close();
  await home.close();
  await context.close();

  for (const colorScheme of ["light", "dark"]) {
    for (const width of [320, 390, 768, 1280]) {
      const responsive = await browser.newContext({ colorScheme, viewport: { width, height: 900 }, serviceWorkers: "block" });
      const page = await open(responsive, "/");
      await expectResults(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${colorScheme}/${width}: homepage overflows horizontally`);
      const activeColors = await page.locator(".view-tab.active").evaluate((button) => {
        const style = getComputedStyle(button);
        return { foreground: style.color, background: style.backgroundColor, height: button.getBoundingClientRect().height };
      });
      assert.ok(contrast(activeColors.foreground, activeColors.background) >= 4.5, `${colorScheme}: active tab text contrast is too low`);
      assert.ok(activeColors.height >= 44, "tab target is smaller than 44px");
      await page.locator("#tool-search").fill("JSON formatter");
      await expectResults(page);
      await page.locator('[data-slug="json-formatter"] .tool-card-link').click();
      await page.locator("#in").waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${colorScheme}/${width}: tool overflows horizontally`);
      await page.locator("#in").fill('{"hello":"world"}');
      await page.locator("#format").click();
      assert.match(await page.locator("#out").textContent(), /"hello": "world"/);
      const buttonColors = await page.locator("#format").evaluate((button) => {
        const style = getComputedStyle(button);
        return { foreground: style.color, background: style.backgroundColor };
      });
      assert.ok(contrast(buttonColors.foreground, buttonColors.background) >= 4.5, `${colorScheme}: primary button text contrast is too low`);
      if (process.env.SCREENSHOT_DIR && [390, 1280].includes(width)) {
        await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/tool-${colorScheme}-${width}.png`, fullPage: true });
        await page.goto(`${baseURL}/`);
        await expectResults(page);
        await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/home-${colorScheme}-${width}.png`, fullPage: false });
      }
      await responsive.close();
    }
  }

  for (const legacyView of ["recent-added", "most-used"]) {
    const legacy = await browser.newContext({ serviceWorkers: "block" });
    const page = await open(legacy, "/");
    await page.evaluate((value) => {
      localStorage.setItem("vt-view", value);
      localStorage.setItem("vt-tool-usage", JSON.stringify({ "json-formatter": 3 }));
    }, legacyView);
    await page.reload();
    await expectResults(page);
    assert.equal(await page.locator("#catalog-sort").inputValue(), legacyView === "recent-added" ? "newest" : "used");
    assert.equal(await page.locator(".view-tab.active").textContent(), legacyView === "recent-added" ? "All tools" : "Recent");
    await legacy.close();
  }
  assert.deepEqual(errors, [], "UI produced browser errors");
  console.log("UI smoke passed: discovery, scoped search, favorites, formula results, guidance, legacy preferences, and 8 responsive/theme combinations");
} finally {
  await browser.close();
}
