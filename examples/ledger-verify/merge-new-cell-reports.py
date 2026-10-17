"""Join new model evidence into the verify dossier without calling or rescoring a model."""
import collections,datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
DOSSIER=Path(os.environ['LEDGER_VERIFY_DOSSIER'])
MODELS={'claude-sonnet-5-5':'sonnet','gpt-6.1-sol':'sol61'}
CONTESTANTS=['driftbench-verify-uncertainty-cascade','promptfoo']
def read(p):return json.loads(p.read_text())
def rows(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
def closed_audit_report(text,audit):
 # The closed rows and files remain intact. Each changed score gets a second labelled row.
 haiku=next(c for c in audit['cells'] if c['model']=='haiku');out=[];label=None;strict=False
 pct=lambda x:f'{100*x:.2f}%'
 for line in text.splitlines():
  if line.startswith('### Strict headline,'):strict=True;label='auditedLabels' if 'audited' in line else 'officialLabels'
  elif line.startswith('### Product-final sensitivity,'):strict=False;label=None
  out.append(line)
  if strict and line.startswith('| haiku |'):
   s=haiku['scores'][label]['auditCorrection'];accuracy=[]
   for i in range(2):accuracy.append(f"{s['correct'][i]}/221, {pct(s['accuracy'][i])} [{pct(s['wilson95'][i][0])}, {pct(s['wilson95'][i][1])}]")
   ci=s['deltaRequestClusterBootstrap95'];limits=' / '.join(str(haiku['counts'][c]['test']['answerEnvelopes']) for c in CONTESTANTS)
   out.append(f"| haiku (labelled audit correction) | {accuracy[0]} | {accuracy[1]} | {limits} | {pct(s['delta'])} [{pct(ci[0])}, {pct(ci[1])}] | {s['wins']} / {s['losses']} | {s['twoSidedExactMcNemarP']:.8g} | pending | {s['verdict']} |")
 text='\n'.join(out)+'\n'
 section=['\n## Labelled closed-cell output-limit audit correction\n',
 '- The accepted audit correction changes Haiku strict accuracy to 163/221 versus 159/221 on official labels, and 184/221 versus 180/221 on audited labels.',
 '- Exact paired p is 0.6075913612730801 for both label sets. The result remains TIE. Closed result files and their original rows remain unchanged.',
 '- Native receipt 81cd575a-8bb0-46f7-abca-b399594ea621 reports stop_reason=max_tokens despite subtype=success and empty text: 16387 output tokens, including 16384 thinking tokens.',
 '- That additional limit belongs to our cascade. Strict loses one correct item. Product-final remains 168/221 versus 159/221 officially, and 189/221 versus 180/221 under audited labels.',
 '- The identical detector audits both contestants on all three closed cells. No further score changes occur. Luna recovery receipts are included; its closed TEST remains unchanged.',
 '- The new detector is frozen at 17:42:49 UTC on 13 October, before Sonnet TEST starts at 17:47:11 UTC and before Sol TEST. No model request is made for this audit.',
 '- Haiku native bodies and API finish metadata are inspected. Two historical Haiku error bodies remain unavailable; API raw bodies were not retained. No missing evidence is inferred as an output limit.\n',
 '| Model | Contestant | TEST limit answers | TEST affected items | All-phase limit answers | All-phase affected items | New limit answers |',
 '|---|---|---|---|---|---|---|']
 for cell in audit['cells']:
  for c,v in cell['counts'].items():section.append(f"| {cell['model']} | {c} | {v['test']['answerEnvelopes']} | {v['test']['affectedItems']} | {v['all']['answerEnvelopes']} | {v['all']['affectedItems']} | {v['all']['newEnvelopes']} |")
 section+=['','Evidence and unchanged-file hashes: evidence/closed-output-limit-audit.json. The original scores remain in evidence/cells.json cells; the separate correction is linked by closedOutputLimitAudit.','']
 return text+'\n'.join(section)
def main():
 original=read(BASE/'evidence/cells.json')
 assert read(BASE/'evidence/finalizer-state.json')['status']=='offline evidence ready for review'
 text=(BASE/'REPORT.md').read_text();marker='## Execution recovery and validity disclosure'
 supplement='\n'+marker+text.split(marker,1)[1] if marker in text else ''
 supplement=supplement.split('\n## Additional Sonnet and Sol cells',1)[0]
 supplement=supplement.split('\n## Labelled closed-cell output-limit audit correction',1)[0]
 closed_audit=read(BASE/'evidence/closed-output-limit-audit.json')
 for path,h in closed_audit['closedFileHashes'].items():assert hashlib.sha256((BASE/path).read_bytes()).hexdigest()==h,path
 original['closedOutputLimitAudit']=dict(path='evidence/closed-output-limit-audit.json',sha256=hashlib.sha256((BASE/'evidence/closed-output-limit-audit.json').read_bytes()).hexdigest(),officialFilesUnchanged=True)
 original['freeze']['hashes']['evidence/closed-output-limit-audit.json']=original['closedOutputLimitAudit']['sha256']
 drop_path=BASE/'evidence/gemini-owner-drop.json'
 drop=read(drop_path) if drop_path.exists() else None
 if drop:
  for cell in original['cells']:
   if cell['model']=='gemini-3.8-flash':
    cell.update(status=drop['status'],reason='Owner decision; no resumption and no score',official=None,audited=None,dropped=True)
    cell.pop('pendingTestItemsPerContestant',None);cell.pop('pendingNoise2PerContestant',None)
  original['freeze']['hashes']['evidence/gemini-owner-drop.json']=hashlib.sha256(drop_path.read_bytes()).hexdigest()
  original['droppedModels']=['gemini-3.8-flash']
 sections=['\n## Additional Sonnet and Sol cells\n',
 '- Separate model cells use the same sealed 221 items, unchanged audit map, frozen contestants, 20-item pilot, 48 mutations and 30-by-3 noise checks.',
 '- Sol has an owner-authorized 40 USD cap including holds. Sonnet has an owner-authorized 45 USD cap only if its five cache-disabled DEV calls project at most 45 USD, including calibration fees and holds.',
 '- Sonnet preserves its first five cached answers and their 57.413792 USD projection. Five next unanswered DEV requests remeasure cost with DISABLE_PROMPT_CACHING=1 for both contestants.',
 '- Both contestants use medium reasoning. Sonnet uses alias sonnet in the lean empty-directory CLI route; Sol uses the Responses API without temperature.',
 '- Sonnet caps total output including thinking at 16384 tokens. Sol caps total output including reasoning at 32768 tokens. Output-limit items remain errors under the strict headline.',
 '- Sol Standard published prices per million tokens: input 2 USD, cached input 0.10 USD, cache write 2.50 USD, output 10 USD. Source: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), read 13 October 2026.',
 '- Sonnet costs come from native total_cost_usd. Sol costs come from recorded usage and its published price. Raw usage envelopes are retained.',
 '- Every returned answer remains cached. Transport failures keep uncertain-charge holds. No model or setting is tuned on sealed data.',
 '- These additional cells remain outside the original 18-cell multiplicity family until the collator declares the combined adjustment.\n',
 '| Model | Status | Five-call cost USD | Projected 379-unit cost USD | Settled USD | Reserved or unknown holds USD | Evidence folder |',
 '|---|---|---|---|---|---|---|']
 evidence=[];projection_sections=[];original.setdefault('newModelFees',{})
 for model,folder in MODELS.items():
  base=BASE/folder;progress=read(base/f'{model}.progress.json');gate=read(base/'evidence/cost-sample.json') if (base/'evidence/cost-sample.json').exists() else None
  remeasure=read(base/'evidence/cache-off-cost-sample.json') if (base/'evidence/cache-off-cost-sample.json').exists() else None
  if remeasure:gate=remeasure
  cap=read(base/'evidence/runtime-freeze.json')['capUsd']
  final=read(base/'evidence/finalizer-state.json') if (base/'evidence/finalizer-state.json').exists() else None
  budget=read(base/'receipts/budget.json') if (base/'receipts/budget.json').exists() and (base/'receipts/budget.json').stat().st_size else {'spentUsd':0,'reservations':{}}
  settled=budget['spentUsd'];held=sum(r['usd'] for r in budget['reservations'].values());assert settled+held<=cap+1e-8
  status=final['status'] if final else progress['status']
  admission_path=BASE/'evidence/network-admission.json'
  if not final and admission_path.exists():
   admission=read(admission_path)
   if admission.get('model')==model and not admission.get('open'):status='waiting: '+admission['status']
  sections.append(f"| {model} | {status} | {gate['costUsd']:.8f} | {gate['projected379UnitsUsd']:.8f} | {settled:.8f} | {held:.8f} | {folder}/ |" if gate else f'| {model} | {status} | pending | pending | {settled:.8f} | {held:.8f} | {folder}/ |')
  original['newModelFees'][model]=dict(settledUsd=settled,unresolvedMaximumUsd=held,maximumAccountedUsd=settled+held,capUsd=cap)
  for name in ['model-amendment.json','runtime-freeze.json','reporting-freeze.json','cost-sample.json','pilot-projection.json','cache-off-amendment.json','cache-off-cost-selection.json','cache-off-cost-sample.json','cap45-activation.json','cap40-amendment.json','refusal-amendment.json','native-quota-amendment.json','native-quota-recovery.json','native-quota-continuation.json','native-quota-recovery-state.json','native-quota-continuation-state.json']:
   p=base/'evidence'/name
   if p.exists():original['freeze']['hashes'][f'{folder}/evidence/{name}']=hashlib.sha256(p.read_bytes()).hexdigest()
  if gate:
   projection_sections+=['',f"{model} cost projection breakdown:",'','| Contestant | Stage | Reference requests | Measured unit USD | Projected USD |','|---|---|---|---|---|']
   for r in gate['components']:projection_sections.append(f"| {r['contestant']} | {r['order']} | {r['referenceRequests']} | {r['unitCostUsd']:.8f} | {r['referenceRequests']*r['unitCostUsd']:.8f} |")
   measured=collections.Counter()
   for r in gate['outcomes']:measured[r['labels']['contestant']]+=r['costUsd']
   projection_sections.append(f"\nFive-call measured cost by contestant: cascade {measured[CONTESTANTS[0]]:.8f} USD; promptfoo {measured['promptfoo']:.8f} USD.")
   if remeasure:projection_sections.append(f"Additional conservative allowance: all calibration fees {gate['priorAndCalibrationSettledUsd']:.8f} USD plus holds {gate['holdsUsd']:.8f} USD. Cache writes observed in the five new calls: {gate['cacheCreationTokens']} tokens.")
   projection_sections.append('Projection uses the original full Luna request counts, with the highest sampled cascade fee assigned to unsampled stages. It is an estimate, not a measured full-cell cost.\n')
  pilot_gate=base/'evidence/pilot-projection.json'
  if pilot_gate.exists():projection_sections.append(f"Completed 20-item pilot projection for {model}: {read(pilot_gate)['projected379UnitsUsd']:.8f} USD. Calibration fees and holds remain in the hard-cap ledger.\n")
  incident_path=base/'evidence/overnight-network-pause.json'
  if incident_path.exists():
   incident=read(incident_path)
   projection_sections.append(f"The {incident['at']} network-pause record contains {len(incident['noAnswerReceipts'])} TEST transport timeouts without answers. Their {incident['retainedHoldUsd']:.8f} USD uncertain-charge holds remain. The standing rule requires the cooldown and ten healthy probes before missing-only recovery at two calls. No returned answer is eligible for resubmission. Source: {folder}/evidence/overnight-network-pause.json.\n")
   recovery_path=base/'evidence/overnight-network-recovery.json'
   if recovery_path.exists():
    recovery=read(recovery_path)
    assert recovery['status']=='complete' and recovery['originalAnswerPrefixPreserved']
    projection_sections.append(f"Both overnight transport-missing requests recover after the health gate, for {sum(r['costUsd'] for r in recovery['recoveries']):.8f} USD. All {recovery['preservedAnsweredReceipts']} earlier answered receipt records remain byte-for-byte unchanged. The original timeout holds remain reserved. Source: {folder}/evidence/overnight-network-recovery.json.\n")
  quota=base/'evidence/native-quota-recovery.json'
  if quota.exists():
   q=read(quota);qs=base/'evidence/native-quota-recovery-state.json'
   if qs.exists() and read(qs).get('status')=='complete':
    recovered=read(qs);projection_sections.append(f"Native session quota initially left {q['quotaRequests']} exact requests unanswered at zero recorded fee. All {recovered['terminalRequests']} requests recover after the reset probe and provider health gate. No terminal answer is submitted again. Original final prompts retain their earlier inputs; supplemental intermediate answers remain archived.")
   else:projection_sections.append(f"Native session quota leaves {q['quotaRequests']} exact requests unanswered, at zero recorded fee. Reset claim: {q['nativeResetClaim']}. Recovery requires a fresh provider health gate and one answered probe; no terminal answer is submitted again.")
  if not final:continue
  assert final['status']=='offline evidence ready for review' and final['complete']
  for path,h in read(base/'evidence/reporting-freeze.json')['sourceHashes'].items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==h,path
  extra=read(base/'evidence/cells.json');assert len(extra['cells'])==1
  original['cells']=[c for c in original['cells'] if c['model']!=model]+extra['cells']
  original['noiseFloor'].update(extra['noiseFloor']);original['outputLimitErrors']['counts'].update(extra['outputLimitErrors']['counts'])
  for key in ['limits','unmappedLimits','unclassifiedHistoricalNativeErrors']:
   original['outputLimitErrors'][key]=[x for x in original['outputLimitErrors'][key] if x.get('model')!=model]+extra['outputLimitErrors'][key]
  cell=extra['cells'][0];cell['refusalErrors']=extra['outputLimitErrors'].get('refusalCounts',{}).get(model,{});mapping=collections.defaultdict(set)
  for r in read(base/'evidence/request-attribution.json')['rows']:mapping[(r['phase'],r['fingerprint'])].add(r['contestant'])
  calls=rows(base/'receipts/calls.jsonl');sample=read(BASE/'evidence/new-model-cost-sample.json')['requests']
  by_id={r['id']:r for r in calls}
  for i,sample_row in enumerate(sample):
   cached=base/'cache'/f'cost-sample-{i}.json'
   if cached.exists():
    r=by_id.get(read(cached).get('verify_receipt_id'))
    if r:mapping[(r['phase'],r['fingerprint'])].add(sample_row['labels']['contestant'])
  if remeasure:
   for sample_row in remeasure['outcomes']:
    r=by_id[sample_row['receipt']];mapping[(r['phase'],r['fingerprint'])].add(sample_row['labels']['contestant'])
  costs=collections.Counter();tokens=collections.Counter();unassigned=0
  for r in calls:
   owners=mapping[(r['phase'],r['fingerprint'])]
   if len(owners)!=1:unassigned+=r['costUsd'];continue
   c=next(iter(owners));costs[c]+=r['costUsd']
   metadata=r.get('metadata') or {};usage=metadata.get('usage') or metadata.get('nativeUsage') or {}
   if not usage and r.get('nativeReceipt'):
    native=Path(r['nativeReceipt'])
    if native.exists() and native.stat().st_size:usage=read(native).get('usage') or {}
   tokens[(c,'input')]+=usage.get('input_tokens',0)+(usage.get('cache_creation_input_tokens',0)+usage.get('cache_read_input_tokens',0) if model=='claude-sonnet-5-5' else 0);tokens[(c,'output')]+=usage.get('output_tokens',0)
   tokens[(c,'cacheWrite')]+=usage.get('cache_creation_input_tokens',(usage.get('input_tokens_details') or {}).get('cache_write_tokens',0))
   tokens[(c,'reasoning')]+=(usage.get('output_tokens_details') or {}).get('reasoning_tokens',(usage.get('output_tokens_details') or {}).get('thinking_tokens',0))
  evidence.append(dict(model=model,folder=folder,cell=cell,costs=dict(costs),unassignedUsd=unassigned,tokens=[dict(contestant=c,input=tokens[(c,'input')],output=tokens[(c,'output')],reasoning=tokens[(c,'reasoning')],cacheWrite=tokens[(c,'cacheWrite')]) for c in CONTESTANTS]))
 original['newModelCostAttribution']=[{k:v for k,v in x.items() if k!='cell'} for x in evidence]
 original['at']=datetime.datetime.now(datetime.timezone.utc).isoformat();(BASE/'evidence/cells.json').write_text(json.dumps(original,indent=2)+'\n')
 sections+=projection_sections
 sections+=['','| Model | Contestant | Constant-fail official / audited | TEST unique-key cost USD | All-phase attributed settled USD | TEST strict missing / product-final missing | TEST output-limit answers | TEST refusal responses | TEST refused items |','|---|---|---|---|---|---|---|---|---|']
 for entry in evidence:
  cell=entry['cell'];ch=original['cheaters'];baseline=f"{round(ch['alwaysFailOfficial']*221)}/221 / {round(ch['alwaysFailAudited']*221)}/221"
  for i,c in enumerate(CONTESTANTS):
   strict=read(BASE/entry['folder']/f"results/{entry['model']}.strict.json")['contestants'][i]['decisions'];product=read(BASE/entry['folder']/f"results/{entry['model']}.json")['contestants'][i]['decisions']
   missing=lambda ds:sum(d.get('missing',0)>0 or type(d.get('pass')) is not bool for d in ds)
   cost=cell['costPer100UniqueKeys'][c]*221/100;limits=cell['outputLimitErrors'][c]['test']['answerEnvelopes']
   sections.append(f"| {entry['model']} | {c} | {baseline} | {cost:.8f} | {entry['costs'].get(c,0):.8f} | {missing(strict)} / {missing(product)} | {limits} | {cell.get('refusalErrors',{}).get(c,{}).get('test',{}).get('answerEnvelopes',0)} | {cell.get('refusalErrors',{}).get(c,{}).get('test',{}).get('affectedItems',0)} |")
  sections.append(f"\n{entry['model']}: unattributed settled cost {entry['unassignedUsd']:.8f} USD. Exact tokens and receipt attribution: evidence/cells.json newModelCostAttribution.\n")
 sections+=['','Native-refusal rule fixed after the Sonnet pilot and before TEST. No pilot verdict changed. Original product verdicts remain unchanged. A native refusal is terminal at any token count and is never recovered as a transport no-answer. Strict scoring counts every consuming contestant/item as an error; product-final retains the frozen product fallback. The rule applies identically to both contestants.','','| Model | Contestant | TEST refusal responses | TEST refused items | All-phase refusal responses | All-phase refused items |','|---|---|---|---|---|---|']
 for model,folder in MODELS.items():
  p=BASE/folder/'evidence/output-limit-errors.json'
  if not p.exists():continue
  counts=read(p).get('refusalCounts',{}).get(model,{})
  for contestant,v in counts.items():
   complete=(BASE/folder/f'results/{model}.json').exists()
   test_answers=str(v['test']['answerEnvelopes']) if complete else 'pending'
   test_items=str(v['test']['affectedItems']) if complete else 'pending'
   suffix='' if complete else ' (partial audit)'
   sections.append(f"| {model} | {contestant} | {test_answers} | {test_items} | {v['all']['answerEnvelopes']}{suffix} | {v['all']['affectedItems']}{suffix} |")
 sections+=['','Sources per model folder: evidence/model-amendment.json, evidence/cost-sample.json, evidence/cells.json, evidence/output-limit-errors.json and receipts/native/.','Scores, paired exact p values and strict/product-final endpoints appear in the tables above for every completed cell. Pending cells have no sealed TEST score.','']
 subprocess.run([sys.executable,str(BASE/'render_report.py'),str(DOSSIER)],cwd=ROOT,check=True)
 result=closed_audit_report((BASE/'REPORT.md').read_text()+supplement,closed_audit)+'\n'.join(sections)
 result=result.replace('Holm correction belongs to the prespecified 18-cell family and remains pending at this handoff. No local WIN or overall superiority claim is made.','The original three models belong to the prespecified 18-cell family. Flash Lite, Sonnet and Sol are additional cells. Multiplicity adjustment remains pending with the collator. No overall superiority claim is made.')
 result=result.replace('Settled fees:', 'Original three-model budget, settled fees:')
 result=result.replace('Strict is the headline: any output-limit hit makes the affected contestant/item an error, even if a later fallback returns a verdict.', 'Strict is the headline: any output-limit hit makes the affected contestant/item an error, even if a later fallback returns a verdict. For the additional Sonnet and Sol cells, any native refusal is also an error, at any token count.')
 result=result.replace('- The pacing amendment replaces the earlier global four-call limit: gpt-6-luna permits eight HTTP calls, Gemini two, and native Haiku two.', '- Current admission: two calls and one model cell at a time, after ten healthy provider probes spaced 30 seconds apart. Gemini 3.8 remains parked.')
 result=result.replace('| gemini-3.8-flash | pending | pending | pending | pending | pending | pending | pending | TEST pending |', '| gemini-3.8-flash | not run: daily quota (0/221) | not run: daily quota (0/221) | 0 / 0 (not run) | pending | pending | pending | pending | owner-only restart |')
 result=result.replace('| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/10; stopped | pending |', '| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | 30 cascade, 20 peer; 10 quota pending | not run: daily quota, 0/221 each |')
 # Add the requested separate refusal column without changing the frozen renderer or old scores.
 table=False;out=[];lookup={c['model']:c for c in original['cells']}
 for line in result.splitlines():
  if line.startswith('| Model | Cascade accuracy'):
   table=True;line=line.replace('| Paired difference', '| Native refusals: cascade / promptfoo | Paired difference')
  elif table and line.startswith('|---'):
   line=line+'---|'
  elif table and line.startswith('| '):
   columns=line.split('|');model=columns[1].strip();counts=lookup.get(model,{}).get('refusalErrors')
   counts_text=' / '.join(str(counts[c]['test']['answerEnvelopes']) for c in CONTESTANTS) if counts else 'not audited'
   columns.insert(5,' '+counts_text+' ');line='|'.join(columns)
  elif table:table=False
  out.append(line)
 result='\n'.join(out)+'\n'
 if drop:
  # Keep archived partial files; the current report has no pending Gemini work or scores.
  revised=[]
  for line in result.splitlines():
   if line.startswith('| gemini-3.8-flash |'):
    columns=line.split('|');columns[2]=' '+drop['status']+' '
    for i in range(3,len(columns)-1):columns[i]=' not reported '
    line='|'.join(columns)
   if line.startswith('- Gemini TEST:') or line.startswith('- Pending quota requests count') or line.startswith('- The reset driver is disarmed.') or line.startswith('- Gemini 3.8 stays parked.'):
    continue
   line=line.replace('Gemini 3.8 remains parked.', 'Gemini 3.8 is dropped by the owner; no resumption is authorized.')
   line=line.replace('## Daily quota runtime amendment','## Historical daily quota amendment, superseded by owner drop')
   line=line.replace('- The owner identifies the Gemini daily request quota and permits missing-only completion after the reset near 14 October 00:00 UTC, through 12:00 UTC.', '- The earlier daily-quota completion permission is superseded by the owner drop. Partial receipts, recordings and fees remain retained.')
   line=line.replace('- HTTP 402 stops Gemini pending prepaid credit replenishment. Proven billing rejection holds are released; unknown network-error holds remain.', '- Historical Gemini billing rejections release only proven rejection holds; unknown network-error holds remain. The owner drop authorizes no further Gemini 3.8 calls.')
   revised.append(line)
  revised.insert(3,'\nGemini 3.8 Flash: '+drop['status']+'. It is removed from pending work. Flash Lite remains the Gemini result.\n')
  result='\n'.join(revised)+'\n'
 assert '\u2014' not in result and '\u2013' not in result
 for p in [BASE/'REPORT.md',DOSSIER]:p.write_text(result)
 print(json.dumps(dict(completedNewModels=[e['model'] for e in evidence],newModelFees=original['newModelFees'],providerCalls=0)))
if __name__=='__main__':main()
