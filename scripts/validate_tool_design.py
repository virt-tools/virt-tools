#!/usr/bin/env python3
"""Validate baseline design and accessibility invariants for every tool page."""
from __future__ import annotations
import re,sys
from pathlib import Path

CONTROL_RE=re.compile(r'<(?:input|select|textarea)\b[^>]*>',re.I)
BUTTON_RE=re.compile(r'<button\b[^>]*>',re.I)
INLINE_SCRIPT_RE=re.compile(r'<script(?![^>]*\bsrc=)[^>]*>.*?</script>',re.I|re.S)

def main():
 frontend=Path(sys.argv[1] if len(sys.argv)>1 else 'frontend'); issues=[]; pages=list((frontend/'tools').glob('*/index.html'))
 for page in pages:
  text=page.read_text(encoding='utf-8'); low=text.lower(); label=page.relative_to(frontend)
  markup=INLINE_SCRIPT_RE.sub('',text)
  required=[('<html lang=','language'),('name="viewport"','viewport'),('/assets/style.css','shared stylesheet'),('<main','main landmark'),('<h1','page heading')]
  for needle,name in required:
   if needle not in low: issues.append(f'{label}: missing {name}')
  labels=set(re.findall(r'<label\b[^>]*\bfor=["\']([^"\']+)',markup,re.I))
  for match in CONTROL_RE.finditer(markup):
   tag=match.group()
   if re.search(r'\btype=["\']hidden["\']',tag,re.I): continue
   if re.search(r'\b(?:aria-label|aria-labelledby|title)\s*=',tag,re.I): continue
   ident=re.search(r'\bid=["\']([^"\']+)',tag,re.I)
   if ident and ident.group(1) in labels: continue
   before=markup[:match.start()]
   if before.lower().rfind('<label')>before.lower().rfind('</label>'): continue
   issues.append(f'{label}: control lacks accessible name: {tag[:100]}')
  for match in BUTTON_RE.finditer(markup):
   if not re.search(r'\btype=["\'](?:button|submit|reset)["\']',match.group(),re.I):
    issues.append(f'{label}: button lacks explicit valid type')
  if '<table' in low and 'overflow-x' not in (frontend/'assets'/'style.css').read_text(encoding='utf-8'):
   issues.append(f'{label}: tables lack responsive overflow support')
 if issues: print('\n'.join(issues)); return 1
 print(f'Validated design and accessibility baseline for {len(pages)} tool pages')
 return 0
if __name__=='__main__': raise SystemExit(main())
