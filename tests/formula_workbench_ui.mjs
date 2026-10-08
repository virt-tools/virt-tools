import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const manifest=JSON.parse(fs.readFileSync('formula-workbenches.json','utf8'));
const baseURL=process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({serviceWorkers:'block',locale:'en-US'});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
let examples=0,golden=0;
try {
  for(const workbench of manifest.workbenches){
    await page.goto(`${baseURL}/tools/${workbench.slug}/`);
    await page.locator('#formula-select').waitFor();
    for(const formula of workbench.formulas){
      await page.locator('#formula-select').selectOption(formula.slug);
      await page.locator('#formula-example').click();
      assert.equal(await page.locator('#formula-error').textContent(),'',`${formula.slug}: example error`);
      assert.equal(await page.locator('#formula-results dd').count(),formula.outputs.length,`${formula.slug}: result binding`);
      assert.equal(await page.locator('#formula-results').isVisible(),true);
      examples++;
      for(const fixture of formula.tests){
        for(const field of formula.fields)await page.locator('#formula-field-'+field.id).fill(String(fixture.input[field.id]));
        await page.locator('#formula-form button[type=submit]').click();
        assert.equal(await page.locator('#formula-error').textContent(),'',`${formula.slug}/${fixture.name}: validation`);
        const actual=await page.locator('#formula-results dd').allTextContents();
        actual.forEach((text,index)=>{
          const value=Number(text.replaceAll(',','').match(/^[+-]?[\d.]+(?:e[+-]?\d+)?/i)?.[0]);
          const expected=fixture.expected[index];
          assert.ok(Math.abs(value-expected)<=Math.max(1e-8,Math.abs(expected)*1e-9),`${formula.slug}/${fixture.name}: ${text} != ${expected}`);
        });
        golden++;
      }
      const input=page.locator('#formula-field-'+formula.fields[0].id);
      for(const invalid of ['', '1junk', '1e309']){
        await input.fill(invalid);
        assert.equal(await page.locator('#formula-results').isVisible(),false,`${formula.slug}: stale result`);
        await page.locator('#formula-form button[type=submit]').click();
        assert.ok((await page.locator('#formula-error').textContent()).length,`${formula.slug}: accepts ${invalid}`);
        assert.equal(await input.getAttribute('aria-invalid'),'true');
      }
    }
  }
  assert.deepEqual(errors,[]);
  assert.equal(examples,160);
  assert.equal(golden,57);
  console.log(`Formula UI passed: ${examples} examples, ${golden} golden vectors, ${examples*3} invalid-input/stale-result checks.`);
} finally { await browser.close(); }
