(function () {
  "use strict";

  function formatNumber(value) {
    if (!Number.isFinite(value)) return "Not a finite result";
    const magnitude = Math.abs(value);
    if ((magnitude !== 0 && magnitude < 1e-6) || magnitude >= 1e12) {
      return value.toExponential(10).replace(/\.0+(?=e)/, "");
    }
    return new Intl.NumberFormat(undefined, {
      maximumSignificantDigits: 12,
      useGrouping: true,
    }).format(value);
  }

  function initialize() {
    const configNode = document.getElementById("conversion-config");
    const input = document.getElementById("conversion-value");
    const fromLabel = document.getElementById("conversion-from-label");
    const toLabel = document.getElementById("conversion-to-label");
    const output = document.getElementById("conversion-result");
    const equation = document.getElementById("conversion-equation");
    const swap = document.getElementById("conversion-swap");
    const copy = document.getElementById("conversion-copy");
    if (!configNode || !input || !fromLabel || !toLabel || !output || !equation || !swap || !copy) return;

    const config = JSON.parse(configNode.textContent);
    let from = config.from;
    let to = config.to;
    let lastResult = "";

    function convert(value, source, target) {
      const base = value * source.scale + source.offset;
      return (base - target.offset) / target.scale;
    }

    function render() {
      fromLabel.textContent = `${from.name} (${from.symbol})`;
      toLabel.textContent = `${to.name} (${to.symbol})`;
      const value = Number(input.value);
      if (input.value.trim() === "" || !Number.isFinite(value)) {
        output.textContent = "Enter a finite number";
        equation.textContent = "";
        lastResult = "";
        return;
      }
      const result = convert(value, from, to);
      lastResult = `${formatNumber(result)} ${to.symbol}`;
      output.textContent = lastResult;
      equation.textContent = `${formatNumber(value)} ${from.symbol} = ${lastResult}`;
    }

    swap.addEventListener("click", function () {
      const previousResult = convert(Number(input.value) || 0, from, to);
      [from, to] = [to, from];
      if (Number.isFinite(previousResult)) input.value = String(previousResult);
      render();
    });
    copy.addEventListener("click", async function () {
      if (!lastResult) return;
      try {
        await navigator.clipboard.writeText(lastResult);
        copy.textContent = "Copied";
      } catch (_) {
        const area = document.createElement("textarea");
        area.value = lastResult;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        copy.textContent = "Copied";
      }
      window.setTimeout(function () { copy.textContent = "Copy result"; }, 1200);
    });
    input.addEventListener("input", render);
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
