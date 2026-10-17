/** Isolated provider process for new cells. No key reaches the runner or any recording. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDialectTransport} from '../../packages/judges/src/clients/transport';
import {schemaFor} from './schemas';
import {QuotaPending,withQuotaBackoff} from './quota';
import {responsesCost,responsesFetch} from './responses-adapter';
import {nativeRefusal,nativeSessionQuota} from './terminal-response';
const root=fileURLToPath(new URL('../..',import.meta.url)),parent=resolve(root,'examples/ledger-verify');
const args=process.argv.slice(2),value=(flag:string)=>args[args.indexOf(flag)+1];
const model=value('--model'),system=value('--system-prompt');
assert(['claude-sonnet-5-5','gpt-6.1-sol'].includes(model));
const base=resolve(parent,model==='gpt-6.1-sol'?'sol61':'sonnet'),id=randomUUID();
const chunks=[];for await(const c of process.stdin)chunks.push(c);const user=Buffer.concat(chunks).toString('utf8');
const phase=process.env.VERIFY_PHASE;assert(phase);
const schema=schemaFor(system);
let slot=false,reservation=false,started=false,nativeReceipt:string|undefined,raw:any,fingerprint:string|undefined;
const budget=(action:string,amount=0)=>JSON.parse(execFileSync('python3',[resolve(parent,'new-cell-budget.py'),base,action,id,String(amount),model,String(process.pid)],{encoding:'utf8'}));
const log=async(file:string,r:any)=>appendFile(resolve(base,'receipts',file),JSON.stringify(r)+'\n');
try{
 const freeze=JSON.parse(await readFile(resolve(base,'evidence/runtime-freeze.json'),'utf8'));
 assert(Buffer.byteLength(system+user)<500000);
 for(const [p,h] of Object.entries(freeze.hashes))assert.equal(createHash('sha256').update(await readFile(resolve(root,p))).digest('hex'),h,p);
 for(const p of ['evidence/finalizer-state.json','lite/evidence/finalizer-state.json'])assert.equal(JSON.parse(await readFile(resolve(parent,p),'utf8')).status,'offline evidence ready for review','Existing cells finish first');
 assert.equal(JSON.parse(await readFile(resolve(parent,'evidence/haiku-test-timeout-recovery.json'),'utf8')).status,'complete');
 fingerprint=createHash('sha256').update(JSON.stringify({core:freeze.coreSha,model,system,user,schema,reasoning:'medium',transport:freeze.transportIdentity})).digest('hex');
 await mkdir(resolve(base,'receipts/native'),{recursive:true});
 let calls:any[]=[];try{calls=(await readFile(resolve(base,'receipts/calls.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch(e:any){if(e.code!=='ENOENT')throw e;}
 const terminal=async(r:any)=>{if(r.output?.verify_answered===true)return true;if(!r.nativeReceipt)return false;try{return nativeRefusal(JSON.parse(await readFile(r.nativeReceipt,'utf8')));}catch(e:any){if(e.code==='ENOENT'||e instanceof SyntaxError)return false;throw e;}};
 let hit:any;for(const r of calls.filter(r=>r.phase===phase&&r.fingerprint===fingerprint))if(await terminal(r)){hit=r;break;}
 if(hit){process.stdout.write(JSON.stringify({...hit.output,verify_answered:true}));process.exit(0);}
 while(!slot){slot=budget('try-acquire').acquired;if(!slot)await new Promise(r=>setTimeout(r,250));}
 // A same-key answer can arrive while this request waits for the network gate.
 try{
  const after=(await readFile(resolve(base,'receipts/calls.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
  let cached:any;for(const r of after.filter(r=>r.phase===phase&&r.fingerprint===fingerprint))if(await terminal(r)){cached=r;break;}
  if(cached){budget('release');slot=false;process.stdout.write(JSON.stringify({...cached.output,verify_answered:true}));process.exit(0);}
 }catch(e:any){if(e.code!=='ENOENT')throw e;}
 const inputBound=Buffer.byteLength(system+user)+4096;
 const reserve=model==='claude-sonnet-5-5'?.5:(inputBound*2.5*(inputBound>272000?2:1)+32768*10*(inputBound>272000?1.5:1))/1e6;
 budget('reserve',reserve);reservation=true;
 let output:any,metadata:any;
 if(model==='claude-sonnet-5-5'){
  const env:any={...process.env,CLAUDE_JUDGE_MODEL:'sonnet',CLAUDE_CODE_MAX_OUTPUT_TOKENS:'16384',CLAUDE_CODE_EFFORT_LEVEL:'medium',DISABLE_PROMPT_CACHING:'1'};
  for(const name of ['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY','MAX_THINKING_TOKENS','CLAUDE_CODE_DISABLE_THINKING','CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING'])delete env[name];
  nativeReceipt=resolve(base,'receipts/native',id+'.json');env.VERIFY_NATIVE_RECEIPT=nativeReceipt;env.VERIFY_NATIVE_EXECUTABLE='<home>/.local/bin/claude';
  const transport=createDialectTransport({provider:'claude-cli',model:'sonnet',env,command:resolve(parent,'capture-claude.sh'),timeoutMs:300000,maxBudgetUsd:.5});
  started=true;const response=await transport.complete({system,user});
  assert(response.costUsd!==undefined);raw=JSON.parse(response.raw);
  output={result:response.text,total_cost_usd:response.costUsd,is_error:false,verify_receipt_id:id,verify_answered:true};
  metadata={...response,raw:undefined,text:undefined,nativeModelUsage:raw.modelUsage,nativeUsage:raw.usage};
 }else{
  const key=(await readFile(resolve(process.env.HOME!,'.nexus-secrets/openai.key'),'utf8')).trim();
  const transport=createDialectTransport({provider:'openai',model,env:{OPENAI_API_KEY:key},reasoning:'medium',maxTokens:32768,timeoutMs:300000,maxRetries:0,
   fetch:responsesFetch(async v=>{raw=v;nativeReceipt=resolve(base,'receipts/native',id+'.json');await writeFile(nativeReceipt,JSON.stringify(v)+'\n');})});
  started=true;const response=await withQuotaBackoff(async()=>{while(true){const gate=JSON.parse(await readFile(resolve(parent,'evidence/network-admission.json'),'utf8'));if(gate.open&&gate.model===model&&Date.now()/1000-gate.lastProbeEpoch<75)break;await new Promise(r=>setTimeout(r,1000));}return transport.complete({system,user,...(schema?{schema}:{})});},async event=>{await log('quota.jsonl',{id,at:new Date().toISOString(),model,phase,fingerprint,...event});});
  output={result:response.text,total_cost_usd:responsesCost(raw),is_error:false,verify_receipt_id:id,verify_answered:true};metadata={...response,raw:undefined,text:undefined,responsesStatus:raw.status,incompleteDetails:raw.incomplete_details,usage:raw.usage};
 }
 const state=budget('settle',output.total_cost_usd);reservation=false;
 await log('calls.jsonl',{id,at:new Date().toISOString(),model,phase,fingerprint,costUsd:output.total_cost_usd,text:output.result,metadata,nativeReceipt,state,output});
 process.stdout.write(JSON.stringify(output));
}catch(error:any){
 await mkdir(resolve(base,'receipts'),{recursive:true});
 if(nativeReceipt&&!raw){try{raw=JSON.parse(await readFile(nativeReceipt,'utf8'));}catch(e:any){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}}
 const message=[error instanceof Error?error.message:String(error),typeof raw?.result==='string'?raw.result:''].filter(Boolean).join(': '),billing=error?.status===402,nativeQuota=nativeSessionQuota(raw),quota=error instanceof QuotaPending||nativeQuota;
 if(nativeQuota)budget('native-quota-stop');
 const cost=typeof raw?.total_cost_usd==='number'?raw.total_cost_usd:raw?.usage&&model==='gpt-6.1-sol'?responsesCost(raw):billing||quota?0:undefined;
 const returned=!!raw&&(nativeRefusal(raw)||Number(raw.usage?.output_tokens??0)>0||Object.values(raw.modelUsage??{}).some((v:any)=>v.outputTokens>0)||(!raw.is_error&&typeof raw.result==='string'&&raw.result.length>0)||(raw.output??[]).some((v:any)=>v.type==='message'&&(v.content??[]).some((c:any)=>c.type==='output_text'&&c.text?.length))); 
 if(billing)budget('billing-stop');
 const output={is_error:true,total_cost_usd:cost??0,verify_receipt_id:id,verify_answered:returned,result:`Transport ${billing||!started?'limit':quota?'quota':'missing'}: ${message}`};
 if(reservation&&cost!==undefined){const state=budget('settle',cost);reservation=false;await log('calls.jsonl',{id,at:new Date().toISOString(),model,phase,fingerprint,costUsd:cost,status:billing?'billing-pending':quota?'quota-pending':'transport-failure',text:raw?.result??'',error:message,nativeReceipt,state,output});}
 await log('errors.jsonl',{id,at:new Date().toISOString(),model,phase,fingerprint,message,reservationRetained:reservation,nativeReceipt,noAnswer:!returned,returnedEnvelope:returned});
 process.stdout.write(JSON.stringify(output));
}finally{if(slot)budget('release');}
