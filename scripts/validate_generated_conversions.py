#!/usr/bin/env python3
"""Validate consolidated unit converters and legacy compatibility routes."""
import json,math,re,sys
from pathlib import Path
CONFIG_RE=re.compile(r'<script id="unit-config" type="application/json">(.*?)</script>',re.S)
SLUG_RE=re.compile(r'^    slug: "([^"]+)",$',re.M)
def main():
 root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve(); frontend=root/'frontend'
 manifest=json.loads((root/'generated-conversion-tools.json').read_text(encoding='utf-8')); tools=manifest.get('tools',[]); redirects=manifest.get('legacy_redirects',{}); issues=[]
 registered=set(SLUG_RE.findall((frontend/'assets/tools.js').read_text(encoding='utf-8')))
 if len(tools)!=37 or manifest.get('count')!=37: issues.append(f"expected 37 consolidated tools, found {len(tools)}")
 if len(redirects)!=1047 or manifest.get('legacy_count')!=1047: issues.append(f"expected 1047 legacy redirects, found {len(redirects)}")
 if len(registered)<1209: issues.append(f"expected at least 1209 registered tools after consolidation and approved additions, found {len(registered)}")
 targets={t['slug'] for t in tools}
 if len(targets)!=37 or not targets<=registered: issues.append('consolidated targets are missing or duplicated')
 if set(redirects.values())!=targets: issues.append('legacy redirects do not cover every consolidated target')
 for source,target in redirects.items():
  if not (frontend/'tools'/source/'index.html').is_file(): issues.append(f'{source}: retained legacy page missing')
  if target not in targets: issues.append(f'{source}: invalid target {target}')
 for tool in tools:
  slug=tool['slug']; page_path=frontend/'tools'/slug/'index.html'
  if slug.startswith('css-'): issues.append(f'{slug}: CSS tool prohibited')
  if not page_path.is_file(): issues.append(f'{slug}: page missing'); continue
  page=page_path.read_text(encoding='utf-8'); match=CONFIG_RE.search(page)
  if not match: issues.append(f'{slug}: config missing'); continue
  config=json.loads(match.group(1).replace('<\\/','</'))
  if config!={'quantity':tool['quantity'],'units':tool['units']}: issues.append(f'{slug}: page/manifest mismatch')
  if len(tool['units'])<2: issues.append(f'{slug}: fewer than two units')
  for unit in tool['units']:
   scale=unit.get('scale'); offset=unit.get('offset')
   if not isinstance(scale,(int,float)) or not math.isfinite(scale) or scale==0: issues.append(f'{slug}: invalid scale')
   if not isinstance(offset,(int,float)) or not math.isfinite(offset): issues.append(f'{slug}: invalid offset')
  for a in tool['units']:
   for b in tool['units']:
    sample=123.456; converted=(sample*a['scale']+a['offset']-b['offset'])/b['scale']; back=(converted*b['scale']+b['offset']-a['offset'])/a['scale']
    if not math.isclose(sample,back,rel_tol=1e-10,abs_tol=1e-10): issues.append(f"{slug}: round trip failed"); break
  for required in ('id="unit-value"','id="unit-from"','id="unit-to"','src="/assets/unit-converter.js"','aria-live="polite"'):
   if required not in page: issues.append(f'{slug}: missing {required}')
 if issues: print('\n'.join(issues)); return 1
 print(f'Validated 37 consolidated converters, 1047 legacy redirects, and {len(registered)} registered tools')
 return 0
if __name__=='__main__': raise SystemExit(main())
