import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
let expectedBeaconWarnings = 0;
try {
  for (const [width, colorScheme] of [[1280, 'light'], [1280, 'dark'], [360, 'light'], [320, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, colorScheme });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (new URL(base).hostname === 'virt.tools' && /static\.cloudflareinsights\.com\/beacon/.test(message.text())
          && /Content Security Policy|content security policy/.test(message.text())) expectedBeaconWarnings++;
      else errors.push(message.text());
    });
    await page.clock.install();
    await page.addInitScript(() => {
      const original = Math.random;
      window.testDice = [];
      Math.random = () => window.testDice.length ? (window.testDice.shift() - 0.5) / 6 : original();
    });
    const response = await page.goto(new URL('/tools/farkle/', base).href);
    assert.equal(response.status(), 200);
    await page.locator('#site-header[data-ready="true"]').waitFor();
    const roll = page.locator('#roll-btn');
    const bank = page.locator('#bank-btn');
    const dice = page.locator('#dice-area button');
    const setRoll = values => page.evaluate(values => { window.testDice = values; }, values);
    const score = async id => Number(await page.locator(id).textContent());
    const select = async indices => { for (const index of indices) await dice.nth(index).click(); };

    await page.locator('#mode').selectOption('local');
    assert.equal(await dice.count(), 6);
    assert.ok(await dice.first().isDisabled()); assert.ok(await bank.isDisabled());
    await setRoll([1, 2, 3, 4, 6, 2]);
    await roll.focus(); await page.keyboard.press('Enter');
    await dice.first().focus(); await page.keyboard.press('Space');
    assert.equal(await dice.first().getAttribute('aria-pressed'), 'true');
    assert.equal(await dice.first().evaluate(el => el === document.activeElement), true);
    await bank.focus(); await page.keyboard.press('Enter');
    assert.equal(await score('#p1'), 100); assert.equal(await score('#p2'), 0);
    assert.match(await page.locator('#msg').textContent(), /Player 2: your turn/);
    await page.clock.runFor(2000);
    assert.equal(await score('#p2'), 0); assert.ok(await roll.isEnabled());

    await setRoll([2, 2, 2, 4, 5, 6]); await roll.click();
    await select([0]); assert.ok(await bank.isDisabled()); assert.ok(await roll.isDisabled());
    await select([1, 2]); assert.equal(await score('#bankable'), 200);
    await select([3]); assert.ok(await bank.isDisabled());
    await select([3]); await bank.click();
    assert.equal(await score('#p2'), 200);
    assert.match(await page.locator('#current-player').textContent(), /Player 1/);

    await setRoll([1, 2, 3, 4, 6, 2, 2, 3, 4, 6, 2]);
    await roll.click(); await select([0]); await roll.click();
    assert.match(await page.locator('#msg').textContent(), /farkled.*Player 2/s);
    assert.equal(await score('#turn-score'), 0); assert.equal(await score('#p1'), 100);

    await setRoll([1, 2, 3, 4, 5, 6, 5, 2, 3, 4, 6, 2]);
    await roll.click(); await select([0, 1, 2, 3, 4, 5]); await roll.click();
    assert.equal(await score('#turn-score'), 1500);
    await select([0]); await bank.click(); assert.equal(await score('#p2'), 1750);

    await page.locator('#target').selectOption('3000');
    assert.equal(await score('#p1'), 0); assert.equal(await score('#p2'), 0);
    await setRoll([2, 3, 4, 6, 2, 3]); await roll.click(); // Player 1 farkles.
    await setRoll([1, 1, 1, 1, 1, 1]); await roll.click();
    await select([0, 1, 2, 3, 4, 5]); await bank.click();
    assert.match(await page.locator('#msg').textContent(), /Player 2 wins/);
    assert.ok(await roll.isDisabled()); assert.ok(await bank.isDisabled());
    await page.locator('#new-game').click();
    assert.match(await page.locator('#current-player').textContent(), /Player 1/);
    assert.equal(await score('#p2'), 0);

    // Switching mode or restarting must cancel an already scheduled AI turn.
    for (const reset of ['mode', 'new-game']) {
      await page.locator('#mode').selectOption('ai');
      await setRoll([1, 2, 3, 4, 6, 2]); await roll.click(); await select([0]); await bank.click();
      assert.ok(await roll.isDisabled()); assert.ok(await bank.isDisabled());
      if (reset === 'mode') await page.locator('#mode').selectOption('local');
      else await page.locator('#new-game').click();
      await page.clock.runFor(2000);
      assert.equal(await score('#p1'), 0); assert.equal(await score('#p2'), 0);
      assert.ok(await roll.isEnabled());
    }
    // The existing AI mode must still bank and return control.
    await setRoll([1, 2, 3, 4, 6, 2, 2, 2, 2, 5, 5, 5]);
    await roll.click(); await select([0]); await bank.click(); await page.clock.runFor(700);
    assert.equal(await score('#p2'), 700); assert.ok(await roll.isEnabled());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await dice.first().evaluate(el => el.getBoundingClientRect().width >= 44));
    assert.deepEqual(errors, []);
    console.log(`Farkle browser passed: ${width}px ${colorScheme}; two players, keyboard, invalid groups, hot dice, farkle, win, reset, AI`);
    await context.close();
  }
  console.log(`Expected blocked Cloudflare beacon warnings: ${expectedBeaconWarnings}`);
} finally { await browser.close(); }
