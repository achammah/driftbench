"""Verify the published exclusion certificate offline, using Python standard library."""
import json
from pathlib import Path
p=Path(__file__).resolve().parent
e=json.loads((p/'evidence.json').read_text());rows=json.loads((p/'exclusions.json').read_text())
w={k:set(v) for k,v in e['witnessIdIntersections'].items()}
assert len(rows)==1767 and len({r['id'] for r in rows})==1767
for r in rows:
 assert r['witnesses'] and all(r['id'] in w[n] for n in r['witnesses'])
 assert len(r['questionSha256'])==64 and all(c in '0123456789abcdef' for c in r['questionSha256'])
for name,n,uq in [('JudgeBench',620,528),('RubricBench',1147,1140)]:
 sub=[r for r in rows if r['benchmark']==name]
 assert len(sub)==n and len({r['questionSha256'] for r in sub})==uq
jb_gpt={r['id'] for r in rows if r['benchmark']=='JudgeBench' and r['split']=='gpt'}
jb_claude={r['id'] for r in rows if r['benchmark']=='JudgeBench' and r['split']=='claude'}
assert len(jb_gpt)==350 and len(jb_claude)==270
assert jb_gpt-w['jb-prior.json']=={'b7bbea2c-8e83-50be-a385-70d16a0d507c'}
assert (jb_gpt-w['jb-prior.json'])<=w['jb-practice.json']
assert jb_claude==w['jb-test.json']
assert {r['id'] for r in rows if r['benchmark']=='RubricBench'}==w['rb-prior.json']
assert e['newPaidCalls']==0 and e['actualUsd']==0
print('PASS: 620/620 JudgeBench and 1147/1147 RubricBench excluded; zero fresh; no paid calls.')
