#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.argv[2];
if (!root) {
  console.error("usage: validate_javascript.mjs <frontend_root>");
  process.exit(2);
}

const failures = [];
let checked = 0;

function compile(source, filename) {
  try {
    new vm.Script(source, {filename});
    checked += 1;
  } catch (error) {
    failures.push(`${filename}: ${error.message}`);
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") walk(target);
    } else if (entry.isFile() && target.endsWith(".html")) {
      const html = fs.readFileSync(target, "utf8");
      const scripts = html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi);
      let index = 0;
      for (const match of scripts) {
        index += 1;
        if (/\bsrc\s*=|\btype\s*=\s*["'](?:application\/ld\+json|application\/json|importmap)["']/i.test(match[1])) continue;
        compile(match[2], `${target}#inline-${index}`);
      }
    } else if (entry.isFile() && target.endsWith(".js")) {
      compile(fs.readFileSync(target, "utf8"), target);
    }
  }
}

walk(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Validated JavaScript syntax in ${checked} scripts`);
