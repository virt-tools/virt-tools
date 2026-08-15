#!/usr/bin/env python3
"""Replace pair-specific converters with one registered tool per quantity."""
from __future__ import annotations
import html,json
from pathlib import Path
from generate_conversion_tools import GROUPS,ADDED,js_string
from validate_tools import parse_registry

PAGE='''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{title} — virt.tools</title><link rel="stylesheet" href="/assets/style.css"></head>
<body><header id="site-header"></header><main class="tool-container"><h1>{title}</h1><p class="subtitle">Convert between all supported {quantity} units in either direction. Calculations stay in your browser.</p>
<div class="input-section"><label for="unit-value">Value</label><input id="unit-value" type="number" value="1" step="any" inputmode="decimal"><label for="unit-from">From</label><select id="unit-from"></select><label for="unit-to">To</label><select id="unit-to"></select><button id="unit-swap" type="button" class="primary-btn">Swap direction</button></div>
<section class="result-section" aria-live="polite"><div class="result-row"><span>Result</span><strong id="unit-result"></strong></div><p id="unit-equation"></p></section>
<script id="unit-config" type="application/json">{config}</script></main><script src="/assets/app.js"></script><script src="/assets/unit-converter.js"></script></body></html>
'''

def block(slug,name,quantity,count):
 return "  {\n"+f'    slug: "{js_string(slug)}",\n    name: "{js_string(name)}",\n    description: "Convert between {count} supported {js_string(quantity.lower())} units in either direction.",\n    category: "Converters",\n    icon: "⇄",\n    added: "{ADDED}",\n  }},\n'

def main():
 root=Path(__file__).resolve().parents[1]; frontend=root/'frontend'; manifest_path=root/'generated-conversion-tools.json'
 old=json.loads(manifest_path.read_text(encoding='utf-8')); old_tools=old.get('tools',[])
 old_slugs={tool['slug'] for tool in old_tools}; quantity_target={}; consolidated=[]
 for group_slug,quantity,units in GROUPS:
  slug=f'{group_slug}-unit-converter'; name=f'{quantity} Unit Converter'; quantity_target[quantity]=slug
  page_dir=frontend/'tools'/slug; page_dir.mkdir(parents=True,exist_ok=True)
  config=json.dumps({'quantity':quantity,'units':units},ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
  (page_dir/'index.html').write_text(PAGE.format(title=html.escape(name),quantity=html.escape(quantity.lower()),config=config),encoding='utf-8')
  consolidated.append({'slug':slug,'quantity':quantity,'units':units})
 redirects={tool['slug']:quantity_target[tool['quantity']] for tool in old_tools}
 registry=frontend/'assets'/'tools.js'; prefix,objects,suffix=parse_registry(registry); canonical={t['slug'] for t in consolidated}
 retained=[text for slug,text in objects if slug not in old_slugs|canonical]
 additions=[block(t['slug'],f"{t['quantity']} Unit Converter",t['quantity'],len(t['units'])) for t in consolidated]
 registry.write_text(prefix+''.join(retained)+''.join(additions)+suffix,encoding='utf-8')
 manifest_path.write_text(json.dumps({'count':len(consolidated),'legacy_count':len(redirects),'tools':consolidated,'legacy_redirects':redirects},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(f'Consolidated {len(redirects)} legacy routes into {len(consolidated)} registered tools')
 return 0
if __name__=='__main__': raise SystemExit(main())
