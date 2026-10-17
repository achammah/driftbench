"""Freeze the separate medium-reasoning dialect experiment after core is pushed."""
import argparse, subprocess
from common import *

def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('core_ref');args=parser.parse_args()
    dest=HERE/'dialect'
    if (dest/'seal.json').exists():raise RuntimeError('Dialect seal already exists')
    (dest/'vendor').mkdir(parents=True,exist_ok=True)
    core=subprocess.check_output(['git','rev-parse',args.core_ref],cwd=ROOT,text=True).strip()
    sources={'hash.ts':'packages/core/src/spec/hash.ts','prompt.ts':'packages/judges/src/prompt.ts',
             'http.ts':'packages/judges/src/http.ts','dialects.ts':'packages/judges/src/clients/dialects.ts',
             'transport.ts':'packages/judges/src/clients/transport.ts'}
    for name,path in sources.items():
        content=subprocess.check_output(['git','show',f'{core}:{path}'],cwd=ROOT)
        (dest/'vendor'/name).write_bytes(content)
    subprocess.run([str(ROOT/'node_modules/.bin/tsx'),str(HERE/'dialect-render.mts')],cwd=ROOT,check=True)
    for f in ('README.md',):
        (dest/f).write_text('''# Separate dialect variant

Uses the same sealed cases and frozen criterion-ledger requirements. Core buildDialectRequest runs verbatim from its committed source, with native dependencies. Candidate OpenAI output uses strict JSON schema; candidate Haiku gets scratchpad then last JSON. Peers keep their pinned template bytes and plain output. Both Luna contestants explicitly use medium reasoning. The provider-default primary remains separate.

No parsed content is retried. Unanswered transport failures have at most three attempts with 10/30-second backoff. Luna uses four calls, dropping to two if unanswered failures exceed 5% in any rolling 50 attempts. Haiku has its own queue. Primary and dialect calls share the USD 10 measured-spend cap. The default-goal and equal-evidence goal results are both retained.
''')
    paths=list((dest/'vendor').glob('*.ts'))+[dest/'prompts.json',dest/'schema.json',HERE/'dialect-render.mts',HERE/'dialect-run.py',HERE/'dialect-score.py']
    dump(dest/'seal.json',{'created':stamp(),'core_commit':core,'original_seal_sha256':digest(HERE/'seal.json'),
         'reasoning':{'gpt-6-luna':'medium, both contestants','gemini-3.8-flash':'medium, both contestants','haiku':'unset'},
         'authority':'Owner: primary stays provider default; dialect uses medium for both candidate and peer.',
         'output':'Native core payload builder, strict checks schema on OpenAI candidate, scratchpad-then-last-JSON on Haiku candidate; peer unchanged.',
         'cap_usd_shared_with_primary':10,'concurrency':12,'luna_concurrency':'4, drops to 2 when failures exceed 5% over any 50 attempts',
         'primary_reuse':'None. Variant request fingerprints are disjoint from primary. Same sealed case payloads, independently recorded experiment, not independent data replication.',
         'sha256':{str(p.relative_to(ROOT)):digest(p) for p in paths}})
    print(json.dumps({'core_commit':core,'seal_sha256':digest(dest/'seal.json')}))

if __name__=='__main__':main()
