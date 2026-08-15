#!/usr/bin/env python3
"""Mechanically normalize structural and accessible design basics on tool pages."""
from __future__ import annotations
import re
from pathlib import Path

CONTROL_RE=re.compile(r'<(input|select|textarea)\b[^>]*>',re.I)
BUTTON_RE=re.compile(r'<button\b(?![^>]*\btype\s*=)[^>]*>',re.I)

def humanize(value):
 value=re.sub(r'\s+',' ',value)
 value=re.sub(r'([a-z])([A-Z])',r'\1 \2',value).replace('_',' ').replace('-',' ').strip()
 value=re.sub(r'[^\w .()/]+',' ',value).strip()
 return (value[:80].title() or 'Tool control').replace('"','&quot;')

def normalize(path):
 text=path.read_text(encoding='utf-8'); original=text
 text=re.sub(r'(<(?:input|select|textarea)\b[^>]*\baria-label="[^"]*"[^>]*>)>',r'\1',text,flags=re.I)
 scripts=[]
 def stash(match): scripts.append(match.group()); return f'___VT_INLINE_SCRIPT_{len(scripts)-1}___'
 text=re.sub(r'<script(?![^>]*\bsrc=)[^>]*>.*?</script>',stash,text,flags=re.I|re.S)
 low=text.lower()
 if '<main' not in low:
  header=re.search(r'<(?:header|div)\b[^>]*id=["\']site-header["\'][^>]*>.*?</(?:header|div)>',text,re.I|re.S)
  pos=header.end() if header else re.search(r'<body[^>]*>',text,re.I).end()
  text=text[:pos]+'\n<main class="tool-container">'+text[pos:]
  app=list(re.finditer(r'<script\b[^>]*src=["\']/assets/app\.js["\'][^>]*>',text,re.I))
  close=app[-1].start() if app else text.lower().rfind('</body>')
  text=text[:close]+'</main>\n'+text[close:]
 if '<h1' not in text.lower():
  title=re.search(r'<title>(.*?)</title>',text,re.I|re.S)
  name=re.sub(r'\s*[—|-]\s*(?:virt(?:ual)?\.tools|virtual tools).*$', '', title.group(1).strip(), flags=re.I) if title else path.parent.name.replace('-',' ').title()
  text=re.sub(r'(<main\b[^>]*>)',r'\1\n<h1>'+name+'</h1>',text,count=1,flags=re.I)
 labels=set(re.findall(r'<label\b[^>]*\bfor=["\']([^"\']+)',text,re.I))
 def control(match):
  tag=match.group(0)
  if re.search(r'\b(?:aria-label|aria-labelledby|title)\s*=',tag,re.I): return tag
  if re.search(r'\btype=["\']hidden["\']',tag,re.I): return tag
  ident=re.search(r'\bid=["\']([^"\']+)',tag,re.I)
  if ident and ident.group(1) in labels: return tag
  before=text[:match.start()]; open_label=before.lower().rfind('<label'); close_label=before.lower().rfind('</label>')
  if open_label>close_label: return tag
  source=None
  for attr in ('placeholder','name','id'):
   found=re.search(rf'\b{attr}=["\']([^"\']+)',tag,re.I)
   if found: source=found.group(1); break
  return tag[:-1]+f' aria-label="{humanize(source or match.group(1))}">'+tag[-1]
 text=CONTROL_RE.sub(control,text)
 form_ranges=[(m.start(),m.end()) for m in re.finditer(r'<form\b.*?</form>',text,re.I|re.S)]
 def button(match):
  in_form=any(start<match.start()<end for start,end in form_ranges)
  kind='submit' if in_form and not re.search(r'\bonclick\s*=',match.group(0),re.I) else 'button'
  return match.group(0)[:-1]+f' type="{kind}">'
 text=BUTTON_RE.sub(button,text)
 for index,script in enumerate(scripts): text=text.replace(f'___VT_INLINE_SCRIPT_{index}___',script)
 if text!=original: path.write_text(text,encoding='utf-8'); return True
 return False

def main():
 root=Path(__file__).resolve().parents[1]/'frontend'/'tools'; changed=sum(normalize(p) for p in root.glob('*/index.html'))
 print(f'Normalized design structure in {changed} tool pages')
 return 0
if __name__=='__main__': raise SystemExit(main())
