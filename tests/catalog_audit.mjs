// Full public-catalog browser baseline. This is not a mathematical certification.
// Run against a local checkout only; see docs/audits/TOOL_REVIEW_FIXES.md.
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('The catalog audit must run against a local test server.');
}
const registry = { window: {} };
vm.runInNewContext(fs.readFileSync('frontend/assets/tools.js', 'utf8'), registry);
const hasFindings = result => result.status !== 200 || result.errors.length || result.httpErrors.length || result.nonFiniteOutput?.length || result.layouts.some(layout => layout.overflow.length || layout.missingNames.length || !layout.heading);
const filter = new Set(process.env.AUDIT_FROM
  ? JSON.parse(fs.readFileSync(process.env.AUDIT_FROM,'utf8')).results.filter(hasFindings).map(tool => tool.slug)
  : (process.env.AUDIT_SLUGS || '').split(',').filter(Boolean));
const tools = registry.window.VIRTUAL_TOOLS.filter(tool => !filter.size || filter.has(tool.slug));
const browser = await chromium.launch({ headless: true });
const results = [];
let next = 0;

async function inspect(page) {
  return page.evaluate(() => {
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const describe = element => `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).join('.') : ''}`;
    const main = document.querySelector('main');
    const missingNames = [...(main?.querySelectorAll('input:not([type=hidden]), select, textarea') || [])]
      .filter(visible).filter(element => !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.title)
      .map(describe);
    const overflow = document.documentElement.scrollWidth > innerWidth + 1
      ? [...document.querySelectorAll('main *')].filter(visible).filter(element => {
        const rect = element.getBoundingClientRect();
        if (rect.right <= innerWidth + 1 && rect.left >= -1) return false;
        // An intentionally scrolling table/code region is not page overflow.
        for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) return false;
        }
        return true;
      }).slice(0, 12).map(describe) : [];
    return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, overflow, missingNames,
      heading: main?.querySelector('h1')?.textContent.trim() || '' };
  });
}

async function invalidOutputs(page) {
  return page.locator('main').evaluate(main => [...main.querySelectorAll('.result-section, .result, .output, #result, #results, #out, #summary')]
    .filter(el => el.getClientRects().length).map(el => el.innerText)
    .filter(text => /\b(?:NaN|Infinity|undefined)\b/.test(text)).slice(0, 3));
}

async function worker() {
  while (next < tools.length) {
    const tool = tools[next++];
    // Playwright's SW-blocking init script throws inside opaque sandboxed
    // frames. The CSV preview deliberately uses such a frame for isolation.
    const context = await browser.newContext({ viewport: { width: 320, height: 900 }, colorScheme: 'light', serviceWorkers: tool.slug === 'csv-to-html' ? 'allow' : 'block', reducedMotion: 'reduce' });
    // Tools may not send audit inputs to third parties or access production APIs.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/api/')
        ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const result = { slug: tool.slug, errors: [], httpErrors: [], layouts: [] };
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) result.httpErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on('dialog', dialog => dialog.dismiss());
    const watchdog = setTimeout(() => { result.errors.push('Tool exceeded the 30-second audit budget'); context.close().catch(() => {}); }, 30000);
    try {
      const response = await page.goto(`${baseURL}/tools/${tool.slug}/`, { waitUntil: 'load', timeout: 15000 });
      result.status = response.status();
      await page.locator('#site-header[data-ready="true"]').waitFor();
      await page.locator('.related-tools').waitFor({ timeout: 1000 }).catch(() => {});
      result.layouts.push({ theme: 'light', ...await inspect(page) });
      result.nonFiniteOutput = await invalidOutputs(page);
      // Exercise an existing, bounded default example only. No blank/file/hardware
      // inputs, start buttons, uploads, downloads, or feedback submission.
      const action = page.getByRole('button', { name: /^(calculate|convert|format|encode|decode|analyze|analyse|count|validate|check|use example|solve|simplify|compute|encrypt|decrypt|profile)\b/i }).first();
      const ready = await page.locator('main').evaluate(main => {
        const inputs = [...main.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')].filter(input => input.getClientRects().length && !input.disabled && !input.readOnly);
        return inputs.length > 0 && inputs.every(input => input.type !== 'file' && input.value.trim() !== '');
      });
      if (ready && await action.count() && await action.isVisible() && await action.isEnabled()) {
        result.action = await action.innerText();
        await action.click({ timeout: 3000 });
        result.nonFiniteOutput.push(...await invalidOutputs(page));
        result.layouts.push({ theme: 'light', afterAction: true, ...await inspect(page) });
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark' });
      result.layouts.push({ theme: 'dark', ...await inspect(page) });
    } catch (error) {
      result.errors.push(error.message);
    } finally {
      clearTimeout(watchdog);
      await context.close();
    }
    results.push(result);
    if (results.length % 100 === 0) console.log(`Audited ${results.length}/${tools.length} public tools`);
  }
}

try {
  await Promise.all(Array.from({ length: 4 }, worker));
} finally {
  await browser.close();
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  const failed = results.filter(hasFindings);
  const report = { date: new Date().toISOString(), count: results.length, expected: tools.length, failedCount: failed.length, results };
  if (process.env.AUDIT_REPORT) fs.writeFileSync(process.env.AUDIT_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ count: report.count, failedCount: failed.length, failures: failed.map(result => result.slug) }, null, 2));
  if (failed.length || results.length !== tools.length || !tools.length) process.exitCode = 1;
}
