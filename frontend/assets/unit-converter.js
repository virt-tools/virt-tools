(function(){
"use strict";
const config=JSON.parse(document.getElementById("unit-config").textContent);
const value=document.getElementById("unit-value"),from=document.getElementById("unit-from"),to=document.getElementById("unit-to"),result=document.getElementById("unit-result"),equation=document.getElementById("unit-equation");
function option(unit){const el=document.createElement("option");el.value=unit.slug;el.textContent=`${unit.name} (${unit.symbol})`;return el;}
config.units.forEach((unit,index)=>{from.appendChild(option(unit));to.appendChild(option(unit));if(index===1)to.value=unit.slug;});
function unit(slug){return config.units.find(item=>item.slug===slug);}
function format(number){const magnitude=Math.abs(number);if((magnitude&&magnitude<1e-6)||magnitude>=1e12)return number.toExponential(10);return new Intl.NumberFormat(undefined,{maximumSignificantDigits:12}).format(number);}
function render(){
  const number=Number(value.value);
  function invalid(message){result.textContent=message;equation.textContent="";value.setAttribute("aria-invalid","true");}
  if(value.value.trim()===""||!Number.isFinite(number)){invalid("Enter a finite number");return;}
  const source=unit(from.value),target=unit(to.value);
  const base=number*source.scale+source.offset;
  if(config.quantity.toLowerCase()==="temperature"&&base < -1e-10){invalid("Temperature cannot be below absolute zero");return;}
  // Preserve identity conversions, including tiny values beside large offsets.
  const converted=source===target?number:(base-target.offset)/target.scale;
  if(!Number.isFinite(converted)){invalid("Result is outside the supported numeric range");return;}
  value.removeAttribute("aria-invalid");
  result.textContent=`${format(converted)} ${target.symbol}`;
  equation.textContent=`${format(number)} ${source.symbol} = ${format(converted)} ${target.symbol}`;
}
document.getElementById("unit-swap").addEventListener("click",()=>{[from.value,to.value]=[to.value,from.value];render();});
[value,from,to].forEach(el=>el.addEventListener(el===value?"input":"change",render));render();
})();
