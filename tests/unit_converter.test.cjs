const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const manifest = JSON.parse(fs.readFileSync('generated-conversion-tools.json', 'utf8'));
const source = fs.readFileSync('frontend/assets/unit-converter.js', 'utf8');
// Independently stated reference conversions: SI decimal prefixes, exact
// definitions, and NIST SP 811. These are not derived from manifest factors.
const vectors = [
  ['length','feet','meters',1,0.3048], ['area','acres','square-meters',1,4046.8564224],
  ['volume','gallons-us','liters',1,3.785411784], ['mass','pounds','kilograms',1,0.45359237],
  ['time','hours','seconds',1,3600], ['speed','miles-per-hour','meters-per-second',1,0.44704],
  ['pressure','atmospheres','pascals',1,101325], ['energy','kilowatt-hours','joules',1,3600000],
  ['power','kilowatts','watts',1,1000], ['angle','degrees','radians',180,Math.PI],
  ['digital-storage','kibibytes','bytes',1,1024], ['frequency','revolutions-per-minute','hertz',60,1],
  ['force','kilogram-force','newtons',1,9.80665], ['torque','newton-centimeters','newton-meters',100,1],
  ['density','grams-per-cubic-centimeter','kilograms-per-cubic-meter',1,1000],
  ['flow-rate','liters-per-minute','liters-per-second',60,1],
  ['acceleration','standard-gravity','meters-per-second-squared',1,9.80665],
  ['temperature','fahrenheit','celsius',32,0],
  ['electric-charge','ampere-hours','coulombs',1,3600],
  ['electric-current','milliamperes','amperes',1000,1], ['voltage','kilovolts','volts',1,1000],
  ['resistance','kiloohms','ohms',1,1000], ['capacitance','microfarads','farads',1,0.000001],
  ['inductance','millihenries','henries',1000,1], ['conductance','mhos','siemens',1,1],
  ['magnetic-flux','maxwells','webers',1,1e-8], ['magnetic-field','gauss','teslas',10000,1],
  ['dynamic-viscosity','poise','pascal-seconds',1,0.1],
  ['kinematic-viscosity','stokes','square-meters-per-second',1,0.0001],
  ['illuminance','phot','lux',1,10000], ['radioactivity','curies','becquerels',1,37000000000],
  ['absorbed-dose','rads','grays',100,1], ['equivalent-dose','rems','sieverts',100,1],
  ['amount','kilomoles','moles',1,1000], ['momentum','newton-seconds','kilogram-meters-per-second',1,1],
  ['mass-flow','kilograms-per-minute','kilograms-per-second',60,1],
  ['surface-tension','dynes-per-centimeter','newtons-per-meter',1,0.001],
];

function runtime(config) {
  const elements = {};
  function element() { return { value: '', textContent: '', listeners: {}, attributes: {}, appendChild(child) { if (!this.value) this.value=child.value; }, addEventListener(name, fn) { this.listeners[name]=fn; }, setAttribute(key, value) { this.attributes[key]=value; }, removeAttribute(key) { delete this.attributes[key]; } }; }
  for(const id of ['unit-config','unit-value','unit-from','unit-to','unit-result','unit-equation','unit-swap']) elements[id]=element();
  elements['unit-config'].textContent=JSON.stringify(config);
  elements['unit-value'].value='1';
  vm.runInNewContext(source,{Intl,document:{getElementById:id=>elements[id],createElement:element}}, {timeout:1000});
  return (from,to,value)=>{
    elements['unit-from'].value=from;elements['unit-to'].value=to;elements['unit-value'].value=String(value);
    elements['unit-value'].listeners.input();
    return elements['unit-result'].textContent;
  };
}

test('one independent golden conversion for every shared quantity',()=>{
  assert.equal(vectors.length,manifest.tools.length);
  for(const [quantity,from,to,value,expected] of vectors){
    const config=manifest.tools.find(tool=>tool.slug===quantity+'-unit-converter');
    assert.ok(config,quantity);
    const result=runtime(config)(from,to,value);
    const actual=Number(result.split(' ')[0].replaceAll(',',''));
    assert.ok(Math.abs(actual-expected)<=Math.max(1e-12,Math.abs(expected)*1e-10),`${quantity}: ${result} != ${expected}`);
  }
});
test('affine conversions preserve identity, reject missing values and overflow',()=>{
  const temperature=runtime(manifest.tools.find(tool=>tool.slug==='temperature-unit-converter'));
  assert.match(temperature('fahrenheit','fahrenheit',1e-10),/^1\.0000000000e-10 /);
  assert.match(temperature('kelvin','celsius',-1),/absolute zero/);
  assert.match(temperature('celsius','fahrenheit',''),/finite number/);
  const length=runtime(manifest.tools[0]);
  assert.match(length('kilometers','nanometers',1e308),/outside the supported/);
});
