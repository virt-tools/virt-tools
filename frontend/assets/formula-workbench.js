(function () {
  "use strict";

  var NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  var SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var configElement = document.getElementById("formula-workbench-config");
  var functions = window.VT_FORMULA_FUNCTIONS;
  if (!configElement || !functions) return;

  var config;
  try {
    config = JSON.parse(configElement.textContent);
  } catch (_error) {
    return;
  }
  if (!config || !Array.isArray(config.formulas) || !config.formulas.length) return;

  var search = document.getElementById("formula-search");
  var select = document.getElementById("formula-select");
  var filterStatus = document.getElementById("formula-filter-status");
  var title = document.getElementById("selected-formula-title");
  var description = document.getElementById("selected-formula-description");
  var form = document.getElementById("formula-form");
  var fieldsContainer = document.getElementById("formula-fields");
  var note = document.getElementById("formula-note");
  var error = document.getElementById("formula-error");
  var results = document.getElementById("formula-results");
  var exampleButton = document.getElementById("formula-example");
  var resetButton = document.getElementById("formula-reset");
  var copyButton = document.getElementById("formula-copy");
  var currentFormula = null;
  var lastCopyText = "";

  function bySlug(slug) {
    return config.formulas.find(function (formula) {
      return formula.slug === slug;
    });
  }

  function setError(message) {
    error.textContent = message || "";
  }

  function clearResults() {
    results.replaceChildren();
    results.hidden = true;
    copyButton.disabled = true;
    lastCopyText = "";
  }

  function formatBound(value) {
    if (value === 0) return "0";
    if (Math.abs(value) >= 1e9 || Math.abs(value) < 1e-6) {
      return value.toExponential(4).replace(/\.0+(?=e)/, "");
    }
    return String(value);
  }

  function formatResult(value) {
    if (value === 0) return "0";
    var absolute = Math.abs(value);
    if (absolute >= 1e12 || absolute < 1e-7) {
      return value.toExponential(10).replace(/\.?0+(?=e)/, "");
    }
    return new Intl.NumberFormat(undefined, {
      maximumSignificantDigits: 12,
      useGrouping: true,
    }).format(value);
  }

  function fieldInput(fieldId) {
    return document.getElementById("formula-field-" + fieldId);
  }

  function renderFields(formula) {
    var fragment = document.createDocumentFragment();
    formula.fields.forEach(function (field) {
      var wrapper = document.createElement("div");
      wrapper.className = "formula-field";

      var label = document.createElement("label");
      label.htmlFor = "formula-field-" + field.id;
      label.textContent = field.label + (field.unit ? " (" + field.unit + ")" : "");

      var input = document.createElement("input");
      input.id = "formula-field-" + field.id;
      input.name = field.id;
      input.type = "text";
      input.inputMode = "decimal";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = field.placeholder;
      input.setAttribute("aria-describedby", input.id + "-hint");

      var hint = document.createElement("span");
      hint.id = input.id + "-hint";
      hint.className = "formula-field-hint";
      hint.textContent = (field.integer ? "Whole number" : "Number") +
        " from " + formatBound(field.min) + " to " + formatBound(field.max) + ".";

      wrapper.append(label, input, hint);
      fragment.append(wrapper);
    });
    fieldsContainer.replaceChildren(fragment);
  }

  function updateAddress(slug) {
    if (!SLUG_PATTERN.test(slug)) return;
    var params = new URLSearchParams();
    params.set("formula", slug);
    window.history.replaceState(null, "", window.location.pathname + "?" + params.toString());
  }

  function renderFormula(formula, changeAddress) {
    currentFormula = formula;
    setError("");
    clearResults();
    if (!formula) {
      title.textContent = "No matching formula";
      description.textContent = "Clear or broaden the filter to continue.";
      note.textContent = "";
      fieldsContainer.replaceChildren();
      form.hidden = true;
      return;
    }
    form.hidden = false;
    title.textContent = formula.name;
    description.textContent = formula.description;
    note.textContent = formula.note;
    renderFields(formula);
    if (changeAddress) updateAddress(formula.slug);
  }

  function populateSelect(formulas, desiredSlug, changeAddress) {
    var fragment = document.createDocumentFragment();
    formulas.forEach(function (formula) {
      var option = document.createElement("option");
      option.value = formula.slug;
      option.textContent = formula.name;
      fragment.append(option);
    });
    select.replaceChildren(fragment);
    select.disabled = formulas.length === 0;
    if (!formulas.length) {
      renderFormula(null, false);
      return;
    }
    var selected = formulas.find(function (formula) {
      return formula.slug === desiredSlug;
    }) || formulas[0];
    select.value = selected.slug;
    renderFormula(selected, changeAddress && selected.slug !== desiredSlug);
  }

  function filterFormulas() {
    var query = search.value.trim().toLocaleLowerCase();
    var visible = config.formulas.filter(function (formula) {
      if (!query) return true;
      return (formula.name + " " + formula.slug + " " + formula.description)
        .toLocaleLowerCase()
        .includes(query);
    });
    var previousSlug = currentFormula ? currentFormula.slug : "";
    populateSelect(visible, previousSlug, true);
    filterStatus.textContent = visible.length === 1
      ? "1 formula shown."
      : visible.length + " formulas shown.";
  }

  function parseField(field) {
    var input = fieldInput(field.id);
    var raw = input.value;
    input.removeAttribute("aria-invalid");
    if (raw.length > config.limits.maxInputCharacters) {
      throw { input: input, message: field.label + " is too long." };
    }
    var normalized = raw.trim();
    if (!normalized) {
      throw { input: input, message: "Enter " + field.label.toLocaleLowerCase() + "." };
    }
    if (!NUMBER_PATTERN.test(normalized)) {
      throw { input: input, message: field.label + " must be a plain decimal number." };
    }
    var value = Number(normalized);
    if (!Number.isFinite(value) || Math.abs(value) > config.limits.maxAbsoluteInput) {
      throw { input: input, message: field.label + " is outside the supported numeric range." };
    }
    if (value < field.min || value > field.max) {
      throw {
        input: input,
        message: field.label + " must be from " + formatBound(field.min) + " to " + formatBound(field.max) + ".",
      };
    }
    if (field.integer && !Number.isInteger(value)) {
      throw { input: input, message: field.label + " must be a whole number." };
    }
    return value;
  }

  function renderResults(values) {
    var heading = document.createElement("h3");
    heading.textContent = "Results";
    var list = document.createElement("dl");
    list.className = "formula-result-list";
    var copyLines = [currentFormula.name];
    currentFormula.outputs.forEach(function (output, index) {
      var formatted = formatResult(values[index]);
      var display = formatted + (output.unit ? " " + output.unit : "");
      var term = document.createElement("dt");
      term.textContent = output.label;
      var detail = document.createElement("dd");
      detail.textContent = display;
      list.append(term, detail);
      copyLines.push(output.label + ": " + display);
    });
    results.replaceChildren(heading, list);
    results.hidden = false;
    copyButton.disabled = false;
    lastCopyText = copyLines.join("\n");
  }

  function calculate() {
    if (!currentFormula) return;
    setError("");
    clearResults();
    var values = Object.create(null);
    try {
      currentFormula.fields.forEach(function (field) {
        values[field.id] = parseField(field);
      });
      var calculateFormula = functions[currentFormula.slug];
      if (typeof calculateFormula !== "function") throw new Error("Formula function is unavailable.");
      var calculated = calculateFormula(values);
      if (!Array.isArray(calculated) || calculated.length !== currentFormula.outputs.length) {
        throw new Error("Formula returned an unexpected result.");
      }
      calculated.forEach(function (value) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new RangeError("The inputs produced a non-finite result. Check the ranges and assumptions.");
        }
      });
      renderResults(calculated);
    } catch (problem) {
      var message = problem && problem.message ? problem.message : "Unable to calculate with those inputs.";
      setError(message);
      if (problem && problem.input) {
        problem.input.setAttribute("aria-invalid", "true");
        problem.input.focus();
      }
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    calculate();
  });
  fieldsContainer.addEventListener("input", function (event) {
    if (event.target instanceof HTMLInputElement) {
      event.target.removeAttribute("aria-invalid");
      setError("");
      clearResults();
    }
  });
  select.addEventListener("change", function () {
    var formula = bySlug(select.value);
    if (formula) renderFormula(formula, true);
  });
  search.addEventListener("input", filterFormulas);
  exampleButton.addEventListener("click", function () {
    if (!currentFormula) return;
    currentFormula.fields.forEach(function (field) {
      fieldInput(field.id).value = String(field.example);
    });
    calculate();
  });
  resetButton.addEventListener("click", function () {
    if (!currentFormula) return;
    currentFormula.fields.forEach(function (field) {
      var input = fieldInput(field.id);
      input.value = "";
      input.removeAttribute("aria-invalid");
    });
    setError("");
    clearResults();
    fieldInput(currentFormula.fields[0].id).focus();
  });
  copyButton.addEventListener("click", function () {
    if (!lastCopyText || !navigator.clipboard) {
      setError("Clipboard access is unavailable in this browser.");
      return;
    }
    navigator.clipboard.writeText(lastCopyText).then(function () {
      copyButton.textContent = "Copied";
      window.setTimeout(function () {
        copyButton.textContent = "Copy results";
      }, 1200);
    }).catch(function () {
      setError("Could not copy the results. Select and copy them manually.");
    });
  });

  var requestedSlug = new URLSearchParams(window.location.search).get("formula") || "";
  var requestedFormula = bySlug(requestedSlug);
  var initial = requestedFormula || config.formulas[0];
  populateSelect(config.formulas, initial.slug, false);
  filterStatus.textContent = config.formulas.length + " formulas shown.";
  if (requestedSlug && !requestedFormula) {
    setError("That formula is not available in this workbench. The first formula is shown instead.");
  }
}());
