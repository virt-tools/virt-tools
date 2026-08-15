#!/usr/bin/env python3
"""Maintain the deterministic one-agent-per-tool audit ledger."""
from __future__ import annotations
import json
import argparse
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LEDGER=ROOT/'individual-tool-audit.json'

def main():
 parser=argparse.ArgumentParser(); parser.add_argument('--record'); parser.add_argument('--status',choices=('pending','auditing','clean','findings','fixed','rechecked')); parser.add_argument('--agent'); parser.add_argument('--finding',action='append',default=[]); args=parser.parse_args()
 slugs=sorted(p.parent.name for p in (ROOT/'frontend'/'tools').glob('*/index.html'))
 old={}
 if LEDGER.is_file(): old={item['slug']:item for item in json.loads(LEDGER.read_text(encoding='utf-8'))['tools']}
 tools=[]
 for slug in slugs:
  tools.append(old.get(slug,{'slug':slug,'status':'pending','agent':None,'findings':[]}))
 if args.record:
  match=next((item for item in tools if item['slug']==args.record),None)
  if not match: raise SystemExit(f'unknown tool: {args.record}')
  if args.status: match['status']=args.status
  if args.agent: match['agent']=args.agent
  if args.finding: match['findings']=args.finding
 LEDGER.write_text(json.dumps({'total':len(tools),'tools':tools},indent=2)+'\n',encoding='utf-8')
 counts={status:sum(t['status']==status for t in tools) for status in ('pending','auditing','clean','findings','fixed','rechecked')}
 print(f"Audit ledger: {len(tools)} tools; "+', '.join(f'{k}={v}' for k,v in counts.items()))
 return 0
if __name__=='__main__': raise SystemExit(main())
