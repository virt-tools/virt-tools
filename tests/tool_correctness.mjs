import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseURL=process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({serviceWorkers:'block',locale:'en-US',viewport:{width:390,height:900}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
async function open(slug){await page.goto(`${baseURL}/tools/${slug}/`);await page.locator('#site-header[data-ready=true]').waitFor();}
async function text(selector){return (await page.locator(selector).innerText()).trim();}
async function fill(selector,value){await page.locator(selector).fill(String(value));}
try {
  await open('percentage-calculator');
  await page.getByRole('button',{name:'Calculate',exact:true}).click();
  assert.equal(await text('#result'),'20% of 50 = 10');
  await page.locator('#mode').selectOption('increase');
  assert.equal(await page.locator('#incInput').isVisible(),true);
  await page.locator('#val5').press('Enter');
  assert.equal(await text('#result'),'Increase: 20 (+20%)');
  await fill('#val5',80);assert.equal(await page.locator('#result').isVisible(),false);
  await page.locator('#calc').click();assert.equal(await text('#result'),'Decrease: -20 (-20%)');
  await fill('#val4',0);await page.locator('#calc').click();assert.match(await text('#result'),/must be positive/);
  await page.locator('#mode').selectOption('pct');
  await fill('#val3',0);await page.locator('#calc').click();assert.match(await text('#result'),/non-zero/);
  await fill('#val3',50);await fill('#val2','');await page.locator('#calc').click();assert.match(await text('#result'),/Enter a finite number/);

  await open('length-converter');
  const lengthCases=[['Inch (in)',1,'Pica (computer)',6],['Inch (in)',1,'Point (computer)',72],['Angstrom (Å)',1,'Meter (m)',1e-10],['Chain',1,'Foot (ft)',66],['Rod',1,'Foot (ft)',16.5]];
  for(const [from,value,to,expected] of lengthCases){
    await fill('#value',value);await page.locator('#from').selectOption({label:from});await page.locator('#calc').click();
    const actual=await page.locator('.result-row').evaluateAll((rows,label)=>Number(rows.find(row=>row.firstElementChild.textContent===label).lastElementChild.textContent.replaceAll(',','')),to);
    assert.ok(Math.abs(actual-expected)<=Math.abs(expected)*1e-10,`${from} to ${to}: ${actual}`);
  }
  await fill('#value','');await page.locator('#calc').click();assert.match(await text('#result'),/finite number/);

  await open('fraction-calculator');
  for(const [a,b,expected] of [['1e-7','0','1/10000000'],['1e21','1','1000000000000000000001'],['9007199254740993e0','0','9007199254740993'],['-0 1/2','0','-1/2'],['1/3','1/6','1/2']]){
    await fill('#a',a);await fill('#b',b);assert.equal(await text('#err'),'');
    assert.equal(await page.locator('#summary .stat-value').first().innerText(),expected);
  }
  await fill('#a','.');assert.match(await text('#err'),/Enter A/);
  await fill('#a','1e1001');assert.match(await text('#err'),/Enter A/);
  await fill('#a','1/10007');await fill('#b','0');assert.match(await text('#summary'),/truncated/);
  await page.locator('[data-op=div]').click();assert.match(await text('#err'),/divide by zero/);

  await open('temperature-converter');
  await page.locator('#from').selectOption('F');await fill('#value',32);await page.locator('#calc').click();
  assert.match(await text('#result'),/°C\s+0\s/);
  await page.locator('#from').selectOption('K');await fill('#value',-1);await page.locator('#calc').click();assert.match(await text('#result'),/absolute zero/);

  // Exercise every shared configuration in the actual browser runtime.
  const manifest=JSON.parse(fs.readFileSync('generated-conversion-tools.json','utf8'));
  for(const tool of manifest.tools){
    await open(tool.slug);
    const first=tool.units[0];
    await page.locator('#unit-from').selectOption(first.slug);await page.locator('#unit-to').selectOption(first.slug);
    await fill('#unit-value','0.0000000001');
    assert.match(await text('#unit-result'),/^1\.0000000000e-10 /,`${tool.slug}: identity precision`);
    await fill('#unit-value','');assert.match(await text('#unit-result'),/finite number/);
  }
  await open('length-unit-converter');
  await page.locator('#unit-from').selectOption('kilometers');await page.locator('#unit-to').selectOption('nanometers');
  await fill('#unit-value','1e308');assert.match(await text('#unit-result'),/outside the supported/);
  await open('temperature-unit-converter');
  await page.locator('#unit-from').selectOption('kelvin');await fill('#unit-value',-1);assert.match(await text('#unit-result'),/absolute zero/);

  await open('loan-calculator');
  assert.equal(await page.locator('#schedule').getAttribute('open'),null);
  await fill('#amount',1200);await fill('#rate',0);await fill('#years',1);
  assert.match(await text('#results'),/Monthly payment\s+\$100\.00/);
  await fill('#amount',100000);await fill('#rate',4);await fill('#years',30);
  assert.match(await text('#results'),/\$477\.42/);
  await fill('#years',40);assert.equal(await page.locator('#schedule-rows tr').count(),480);
  assert.equal(await page.locator('#schedule-rows tr').last().locator('td').last().textContent(),'$0.00');
  await fill('#rate','0.000000000001');assert.doesNotMatch(await text('#results'),/NaN|Infinity/);
  await fill('#rate','');assert.match(await text('#loan-error'),/must be a number/);assert.equal(await text('#results'),'');
  await fill('#rate',4);await fill('#years',1.01);assert.match(await text('#loan-error'),/whole number of months/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.SCREENSHOT_DIR){
    await fill('#years',30);
    await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/loan-mobile.png`,fullPage:true});
    await page.setViewportSize({width:1280,height:900});await page.emulateMedia({colorScheme:'dark'});
    await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/loan-desktop-dark.png`,fullPage:true});
  }
  await open('compound-interest-calculator');
  await fill('#principal',1000);await fill('#monthly',100);await fill('#rate',0);await fill('#years',2);
  for(const frequency of ['1','2','4','12','365']){
    await page.locator('#freq').selectOption(frequency);assert.match(await text('#results'),/\$3,400/);assert.doesNotMatch(await text('#results'),/NaN|Infinity/);
  }
  await fill('#monthly',0);await fill('#years',2);await fill('#rate',10);await page.locator('#freq').selectOption('1');
  assert.match(await text('#results'),/\$1,210/);
  await fill('#monthly',100);await page.locator('#freq').selectOption('12');
  const expected=1000*(1+0.1/12)**24+100*((1+0.1/12)**24-1)/(0.1/12);
  const shown=Number((await page.locator('#results .big').first().innerText()).replace(/[$,]/g,''));
  assert.ok(Math.abs(shown-expected)<0.01);
  await fill('#principal','');assert.match(await text('#results'),/Enter non-negative/);
  await open('compound-interest');await fill('#years',1.5);assert.match(await text('#err'),/whole years/);
  assert.equal(await text('#summary'),'');

  await open('statistics-calculator');
  for(const [values,q1,q3] of [['1,2,3,4','1.75','3.25'],['5','5','5'],['1,2','1.25','1.75']]){
    await fill('#data',values);await page.locator('#calc').click();
    const results=await page.locator('.result-row').evaluateAll(rows=>Object.fromEntries(rows.map(row=>[row.firstElementChild.textContent,row.lastElementChild.textContent])));
    assert.equal(results['Q1:'],q1);assert.equal(results['Q3:'],q3);assert.doesNotMatch(await text('#result'),/NaN|undefined/);
  }
  await fill('#data','1, 2garbage, 3');await page.locator('#calc').click();assert.match(await text('#result'),/invalid values/);

  await open('vector-calculator');await page.locator('#calc').click();assert.match(await text('#result'),/25/);
  await fill('#vecA_x',0);await fill('#vecA_y',0);await page.locator('#op').selectOption('angle');await page.locator('#calc').click();assert.match(await text('#result'),/zero vector/);
  await page.locator('#op').selectOption('cross');await page.locator('#calc').click();assert.match(await text('#result'),/Select 3D/);
  await open('matrix-multiplier');await page.locator('#calc').click();
  assert.deepEqual(await page.locator('#result td').allTextContents(),['5.0000','4.0000','4.0000','5.0000']);
  await fill('#aRows',10000);await page.locator('#calc').click();assert.match(await text('#result'),/1 to 6/);
  await open('matrix-determinant');
  for(const [id,value] of [['m00',1],['m01',2],['m10',3],['m11',4]])await fill('#'+id,value);
  await page.locator('#calc').click();assert.match(await text('#result'),/Determinant:\s+-2/);
  await fill('#m00','');await page.locator('#calc').click();assert.match(await text('#result'),/finite number/);
  await open('system-of-equations-solver');await page.locator('#calc').click();assert.match(await text('#result'),/x =\s+1\.000000/);
  await fill('#a00','');await page.locator('#calc').click();assert.match(await text('#result'),/finite coefficients/);
  await open('geometry-calculator');await page.locator('#calc').click();assert.doesNotMatch(await text('#result'),/NaN|undefined/);
  await page.locator('#inputs input').first().fill('-1');await page.locator('#calc').click();assert.match(await text('#result'),/positive finite/);

  await open('retirement-savings-calculator');
  for(const [id,value] of [['age',40],['retire',41],['current',0],['contrib',1000],['match',3],['salary',50000],['return',0]])await fill('#'+id,value);
  await page.getByRole('button',{name:'Calculate',exact:true}).click();assert.match(await text('#result'),/Projected balance\s+\$2,500/);
  await fill('#salary','');await page.getByRole('button',{name:'Calculate',exact:true}).click();assert.match(await text('#result'),/Enter finite/);

  await open('ring-size-converter');await fill('#dia',18.1);await page.locator('#calc').click();
  assert.match(await text('#result'),/US \/ Canada\s+8\s/);assert.match(await text('#result'),/UK \/ Australia\s+P\s/);
  await fill('#dia',0);await page.locator('#calc').click();assert.match(await text('#result'),/reference chart/);

  await open('date-duration');await fill('#from','2026-10-05');await fill('#to','2026-10-05');
  await page.locator('#inclusive').check();assert.match(await text('#totals'),/1\s+Weekdays/);
  await page.locator('#mode').selectOption('add');await fill('#start','2024-01-31');await fill('#amount',1);await page.locator('#unit').selectOption('months');
  assert.match(await text('#result'),/2024-02-29/);
  await fill('#start','0099-01-01');await page.locator('#unit').selectOption('years');assert.match(await text('#result'),/100-01-01/);
  await fill('#amount','');assert.match(await text('#result'),/whole-number/);

  await open('pem-viewer');
  await fill('#input','-----BEGIN TEST-----\nYQ==\n-----END TEST-----\n-----BEGIN TEST-----\nYg==\n-----END TEST-----');
  await page.getByRole('button',{name:'Inspect',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('out').textContent.includes('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'));
  assert.match(await text('#out'),/3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d/);
  await fill('#input','-----BEGIN TEST-----\n!\n-----END TEST-----');await page.getByRole('button',{name:'Inspect',exact:true}).click();assert.match(await text('#out'),/invalid Base64/);

  await open('gratitude-journal');assert.equal(await page.locator('.stat-val').first().innerText(),'0');
  await page.evaluate(()=>localStorage.setItem('vt_gratitude','not json'));await page.reload();await page.locator('#prompt0').waitFor();
  await open('html-entity-table');await fill('#search','Ampersand');
  assert.equal(await page.locator('#tbl tbody td').nth(1).innerText(),'&amp;');
  assert.equal(await page.locator('#tbl tbody td').nth(3).innerText(),'&#38;');

  await open('xml-formatter');
  for(const xml of ['<p>Hello <b>world</b> !</p>','<root xml:space="preserve">  <a> A </a>  </root>','<root><![CDATA[ a < b ]]></root>','<parsererror>ordinary user element</parsererror>']){
    await fill('#input',xml);
    for(const action of ['format','minify']){await page.locator('#'+action).click();assert.equal(await page.locator('#result textarea').inputValue(),xml);}
  }
  await fill('#input','<?xml version="1.0"?><root><a>one</a><b>two</b></root>');
  await page.locator('#format').click();assert.equal(await page.locator('#result textarea').inputValue(),'<?xml version="1.0"?>\n<root>\n  <a>one</a>\n  <b>two</b>\n</root>');
  await fill('#input','<root>\n  <a>one</a>\n</root>');await page.locator('#minify').click();assert.equal(await page.locator('#result textarea').inputValue(),'<root><a>one</a></root>');
  await fill('#input','<root><a></root>');await page.locator('#format').click();assert.match(await text('#result'),/well-formed/);assert.equal(await page.locator('#result textarea').count(),0);

  await open('food-shelf-life-guide');
  assert.deepEqual(await page.locator('#out dd').allTextContents(),['1–2 days','1 year']);
  let foods=0;
  for(const category of await page.locator('#in-cat option').evaluateAll(options=>options.map(option=>option.value))){
    await page.locator('#in-cat').selectOption(category);
    for(const value of await page.locator('#in-food option').evaluateAll(options=>options.map(option=>option.value))){
      await page.locator('#in-food').selectOption(value);assert.equal(await page.locator('#out dd').count(),2);assert.doesNotMatch(await text('#out'),/undefined|NaN/);foods++;
    }
  }
  assert.equal(foods,22);assert.match(await page.locator('main').innerText(),/Smell and appearance cannot establish safety/);
  assert.deepEqual(errors,[]);
  console.log('Correctness regressions passed: numeric boundaries, all shared converters, financial models, statistics, dates, algebra, PEM, journal, entities, XML, and food-storage display.');
}finally{await browser.close();}
