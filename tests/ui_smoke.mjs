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
  await page.locator("#tool-catalog .catalog-row").first().waitFor();
  assert.ok(await page.locator("#tool-catalog .catalog-row").count());
}

try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const home = await open(context, "/");
  await expectResults(home);
  assert.equal(await home.locator(".catalog-chip").count(), 11);
  assert.equal(
    await home.locator('.catalog-sort-btn[data-sort="newest"]').getAttribute("aria-pressed"),
    "true",
    "catalog does not default to recent ordering",
  );
  assert.equal(
    await home.locator(".github-link").getAttribute("href"),
    "https://github.com/virt-tools/virt-tools",
    "navbar GitHub link points elsewhere",
  );
  assert.equal((await home.locator('.catalog-chip[aria-pressed="true"]').textContent()).trim(), "All");
  assert.equal(await home.locator("#maturity-filter").count(), 0);
  assert.equal(await home.locator("#catalog-filters").count(), 0);

  await home.locator('.catalog-chip', { hasText: "Developer & IT" }).click();
  await home.waitForFunction(() => {
    const rows = [...document.querySelectorAll("#tool-catalog .catalog-row[data-slug]")];
    const groups = ["Developer", "Networking", "IT & Networking", "Security", "System"];
    return rows.length > 0 && rows.every((row) => {
      const tool = window.VIRTUAL_TOOLS.find((entry) => entry.slug === row.dataset.slug);
      return tool && groups.includes(tool.category);
    });
  });
  assert.match((await home.locator("#tool-count").textContent()).trim(), /of [\d,]+ tools/);
  await home.locator('.catalog-chip', { hasText: "All" }).first().click();
  await expectResults(home);

  const firstSlug = await home.locator("#tool-catalog .catalog-row").first().getAttribute("data-slug");
  await home.locator(`#tool-catalog [data-slug="${firstSlug}"] .catalog-star`).click();
  assert.equal(new URL(home.url()).pathname, "/", "save click opened the tool");
  await home.locator("#saved-filter").click();
  assert.equal(await home.locator("#tool-catalog .catalog-row").count(), 1);
  await home.locator("#saved-filter").click();
  assert.equal(await home.locator("#saved-filter").getAttribute("aria-pressed"), "false");

  await home.locator("#tool-search").fill("JSON formatter");
  await home.waitForFunction(() => document.querySelectorAll("#tool-catalog .catalog-row").length > 0);
  await home.locator("#tool-search").fill("");
  await home.waitForFunction(() => document.querySelectorAll("#tool-catalog .catalog-row").length > 0);

  await home.locator("#tool-search").fill("triangle area heron");
  await home
    .locator('[data-slug="geometry-formula-workbench"] .catalog-row-name', { hasText: "Triangle Area (Heron)" })
    .waitFor();
  const formulaLink = home.locator('[data-slug="geometry-formula-workbench"] .catalog-row-main');
  assert.equal(await formulaLink.locator(".catalog-row-name").textContent(), "Triangle Area (Heron)");
  assert.match(await formulaLink.getAttribute("href"), /\?formula=triangle-area-heron$/);
  await formulaLink.click();
  await home.locator("#formula-fields input").first().waitFor();
  assert.equal(await home.locator(".tool-header .back").count(), 0);
  assert.equal(await home.locator(".tool-breadcrumbs a").count(), 1);
  assert.ok(await home.evaluate(() => {
    const picker = document.querySelector(".formula-picker");
    const actions = document.querySelector(".tool-shell-actions");
    return Boolean(picker.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING);
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
      const activeColors = await page.locator('.catalog-chip[aria-pressed="true"]').evaluate((button) => {
        const style = getComputedStyle(button);
        return { foreground: style.color, background: style.backgroundColor, height: button.getBoundingClientRect().height };
      });
      assert.ok(contrast(activeColors.foreground, activeColors.background) >= 4.5, `${colorScheme}: active chip text contrast is too low`);
      assert.ok(activeColors.height >= 32, "chip target is smaller than 32px");
      await page.locator("#tool-search").fill("JSON formatter");
      await expectResults(page);
      await page.locator('[data-slug="json-formatter"] .catalog-row-main').click();
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

  const sortContext = await browser.newContext({ serviceWorkers: "block" });
  const sortPage = await open(sortContext, "/");
  await sortPage.locator('.catalog-sort-btn[data-sort="name"]').click();
  await sortPage.reload();
  await expectResults(sortPage);
  assert.equal(
    await sortPage.locator('.catalog-sort-btn[data-sort="name"]').getAttribute("aria-pressed"),
    "true",
    "saved sort preference was not restored",
  );
  await sortContext.close();

  assert.deepEqual(errors, [], "UI produced browser errors");
  console.log("UI smoke passed: catalog index, chips, saved filter, search, formula results, guidance, sort persistence, and 8 responsive/theme combinations");
} finally {
  await browser.close();
}
