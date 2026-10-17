/** Provider wrapper. Keys are loaded here, never in the parent runner or its logs. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { schemaFor } from './schemas';
import { QuotaPending, withQuotaBackoff } from './quota';
import { isBillingRejection } from './billing';

const root = fileURLToPath(new URL('../..', import.meta.url));
const base = resolve(root,'examples/ledger-verify');
const argv = process.argv.slice(2);
const value = (flag:string) => argv[argv.indexOf(flag)+1];
const model = value('--model') ?? '';
const system = value('--system-prompt') ?? '';
const chunks=[];
for await (const chunk of process.stdin) chunks.push(chunk);
const user=Buffer.concat(chunks).toString('utf8');
const id=randomUUID();
let reservation=false;
let slot=false;
let started=false;
let callFingerprint:string|undefined;
let nativeReceipt:string|undefined;
const budget = (action:string,amount=0.5) => JSON.parse(execFileSync('python3',[
  resolve(base,'budget.py'),resolve(base,'receipts/budget.json'),action,id,String(amount),model,String(process.pid),
],{encoding:'utf8'}));
try {
  const freeze=JSON.parse(await readFile(resolve(base,'evidence/runtime-freeze.json'),'utf8'));
  if (freeze.deadlineAt!==null && Date.now() >= freeze.deadlineAt) throw new Error('Last-call cutoff reached');
  if (!['haiku','gpt-6-luna','gemini-3.8-flash'].includes(model)) throw new Error('Unauthorized model');
  if (Buffer.byteLength(system+user)>500_000) throw new Error('Prompt exceeds frozen transport input bound');
  for (const [path,hash] of Object.entries(freeze.hashes)) {
    const actual=createHash('sha256').update(await readFile(resolve(root,path))).digest('hex');
    if (actual!==hash) throw new Error(`Runtime hash mismatch: ${path}`);
  }
  const schema=schemaFor(system);
  const fingerprint=(core:string)=>createHash('sha256').update(JSON.stringify({core,model,system,user,schema,reasoning:model==='haiku'?null:'medium'})).digest('hex');
  callFingerprint=fingerprint(freeze.coreSha);
  const recovery=JSON.parse(await readFile(resolve(base,'evidence/haiku-test-timeouts.json'),'utf8'));
  if(model!=='haiku'||process.env.VERIFY_PHASE!=='test'||!recovery.calls.some((r:any)=>r.fingerprint===callFingerprint))throw new Error('Outside authorized TEST timeout recovery');
  const excludedIds=new Set(recovery.calls.map((r:any)=>r.id));
  // Crash recovery uses same-phase receipts, including returned errors, before any provider call.
  {
    const prior=JSON.parse(await readFile(resolve(base,'evidence/pilot-runtime-freeze.json'),'utf8'));
    const lines=(await readFile(resolve(base,'receipts/calls.jsonl'),'utf8')).trim().split('\n');
    const allowed=[callFingerprint,...(process.env.VERIFY_PHASE==='pilot'?[fingerprint(prior.coreSha)]:[])];
    const hit=lines.filter(Boolean).map(line=>JSON.parse(line)).find(r=>!excludedIds.has(r.id)&&!['quota-pending','billing-pending'].includes(r.status)&&r.phase===process.env.VERIFY_PHASE&&allowed.includes(r.fingerprint));
    if(hit) {
      await appendFile(resolve(base,'receipts/recovered.jsonl'),JSON.stringify({originalReceipt:hit.id,at:new Date().toISOString(),model})+'\n');
      process.stdout.write(JSON.stringify(hit.status==='transport-failure'
        ?{result:`Transport missing: ${hit.error}`,total_cost_usd:0,is_error:true}
        :{result:hit.text,total_cost_usd:hit.costUsd,is_error:false}));
      process.exit(0);
    }
  }
  await mkdir(resolve(base,'receipts'),{recursive:true});
  const acquire=async()=>{
    while(!slot){
      slot=budget('try-acquire').acquired;
      if(!slot)await new Promise(resolve=>setTimeout(resolve,250));
    }
  };
  while(true){
    const gate=JSON.parse(await readFile(resolve(base,'evidence/network-admission.json'),'utf8'));
    if(gate.open&&gate.model===model&&Date.now()/1000-gate.lastProbeEpoch<75)break;
    await new Promise(r=>setTimeout(r,1000));
  }
  await writeFile(resolve(base,'cache/haiku-test-outage',callFingerprint+'.'+id+'.claim.json'),JSON.stringify({id,at:new Date().toISOString(),fingerprint:callFingerprint}),{flag:'wx'});
  await acquire();
  budget('reserve' ,model.startsWith('gemini-')?1:0.5);
  reservation=true;
  let result:any;
  let metadata:any;
  if (model==='haiku') {
    const { createDialectTransport }=await import('../../packages/judges/src/clients/transport');
    // Frozen Haiku prompts already own their output instructions, including scratchpad where applicable.
    const env:Record<string,string|undefined>={...process.env,CLAUDE_JUDGE_MODEL:'claude-haiku-5-5',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'16384'};
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GEMINI_API_KEY;
    nativeReceipt=resolve(base,'receipts/native',`${id}.json`);
    await mkdir(resolve(base,'receipts/native'),{recursive:true});
    env.VERIFY_NATIVE_RECEIPT=nativeReceipt;
    env.VERIFY_NATIVE_EXECUTABLE='<home>/.local/bin/claude';
    const transport=createDialectTransport({provider:'claude-cli',model:'claude-haiku-5-5',env,
      command:resolve(base,'capture-claude.sh'),
      timeoutMs:freeze.models[model].timeoutMs,maxBudgetUsd:0.5});
    started=true;
    const response=await transport.complete({system,user});
    if (response.costUsd===undefined) throw new Error('Provider omitted fee; reservation retained');
    result={result:response.text,total_cost_usd:response.costUsd,is_error:false};
    metadata={...response,raw:undefined,text:undefined};
  } else {
    const isGoogle=model.startsWith('gemini-');
    const keyFile=isGoogle ? process.env.VERIFY_GEMINI_KEY_FILE : process.env.VERIFY_OPENAI_KEY_FILE;
    if (!keyFile) throw new Error('Provider key file path is required');
    const allowed=resolve(process.env.HOME!,'.nexus-secrets',isGoogle?'gemini-driftbench.key':'openai.key');
    if(resolve(keyFile)!==allowed) throw new Error('Only the owner-authorized key file may be used');
    const key=(await readFile(keyFile,'utf8')).trim();
    const { createDialectTransport }=await import('../../packages/judges/src/clients/transport');
    const transport=createDialectTransport({provider:isGoogle?'google':'openai',model,
      env:isGoogle?{GEMINI_API_KEY:key}:{OPENAI_API_KEY:key}, reasoning:'medium',
      timeoutMs:freeze.models[model].timeoutMs,maxTokens:32768,maxRetries:0});
    const response=await withQuotaBackoff(async()=>{
      await acquire();started=true;
      return transport.complete({system,user,...(schema?{schema}:{})});
    },async event=>{
      await appendFile(resolve(base,'receipts/quota.jsonl'),JSON.stringify({id,at:new Date().toISOString(),model,phase:process.env.VERIFY_PHASE,fingerprint:callFingerprint,...event})+'\n');
      // A rejected quota request has no judge answer. Let another model use the slot during its wait.
      if(slot){budget('release');slot=false;}
    });
    const raw=JSON.parse(response.raw);
    const usage=isGoogle?raw.usageMetadata:raw.usage;
    if(!usage) throw new Error('Provider omitted token usage; reservation retained');
    // Frozen prices and source URLs are inherited from PR 168's verified shim price table.
    const input=isGoogle?usage.promptTokenCount:usage.prompt_tokens;
    const output=isGoogle?(usage.candidatesTokenCount??0)+(usage.thoughtsTokenCount??0):usage.completion_tokens;
    if(!Number.isFinite(input)||!Number.isFinite(output)) throw new Error('Incomplete token usage');
    const cached=isGoogle?0:Math.min(input,usage.prompt_tokens_details?.cached_tokens??0);
    const long=!isGoogle&&input>272000;
    const cost=isGoogle?(input*0.75+output*3.75)/1e6:
      ((input-cached)*0.10*(long?2:1)+cached*0.01*(long?2:1)+output*0.50*(long?1.5:1))/1e6;
    result={result:response.text,total_cost_usd:cost,is_error:false};
    metadata={...response,raw:undefined,text:undefined,usage};
  }
  const state=budget('settle',result.total_cost_usd);
  reservation=false;
  await appendFile(resolve(base,'receipts/calls.jsonl'),JSON.stringify({
    id,at:new Date().toISOString(),model,fingerprint:fingerprint(freeze.coreSha),phase:process.env.VERIFY_PHASE,
    costUsd:result.total_cost_usd,metadata,state,text:result.result,
  })+'\n');
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  const message=error instanceof Error ? error.message : String(error);
  await mkdir(resolve(base,'receipts'),{recursive:true});
  let knownCost:number|undefined;
  let native:any;
  if(nativeReceipt){
    try{native=JSON.parse(await readFile(nativeReceipt,'utf8'));}
    catch(e:any){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
    if(typeof native?.total_cost_usd==='number'&&Number.isFinite(native.total_cost_usd)&&native.total_cost_usd>=0)knownCost=native.total_cost_usd;
  }
  const billingPending=isBillingRejection(error);
  if(error instanceof QuotaPending||billingPending)knownCost=0;
  if(reservation&&knownCost!==undefined){
    const state=budget('settle',knownCost);reservation=false;
    await appendFile(resolve(base,'receipts/calls.jsonl'),JSON.stringify({id,at:new Date().toISOString(),model,
      fingerprint:callFingerprint,phase:process.env.VERIFY_PHASE,costUsd:knownCost,state,
      status:billingPending?'billing-pending':error instanceof QuotaPending?'quota-pending':'transport-failure',error:message,
      text:typeof native?.result==='string'?native.result:'',nativeReceipt})+'\n');
  }
  await appendFile(resolve(base,'receipts/errors.jsonl'),JSON.stringify({id,model,at:new Date().toISOString(),
    message,fingerprint:callFingerprint,phase:process.env.VERIFY_PHASE,reservationRetained:reservation,nativeReceipt})+'\n');
  const category=billingPending?'limit':error instanceof QuotaPending?'quota':started?'missing':'limit';
  process.stdout.write(JSON.stringify({is_error:true,total_cost_usd:0,result:`Transport ${category}: ${message}`}));
}

finally { if(slot) budget('release'); }
