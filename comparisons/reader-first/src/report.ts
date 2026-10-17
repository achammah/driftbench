import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const root = process.env.READER_FIRST_REPORT_SNAPSHOT ?? 'comparisons/reader-first';
const dev = JSON.parse(await readFile(`${root}/results/final-dev.json`, 'utf8'));
const search = JSON.parse(await readFile(`${root}/results/dev-search.json`, 'utf8'));
const freeze = JSON.parse(await readFile(`${root}/results/freeze.json`, 'utf8'));
let test: any;
try {
  test = JSON.parse(await readFile(`${root}/results/test.json`, 'utf8'));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const records = (await readFile(`${root}/recordings/haiku.jsonl`, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((x) => JSON.parse(x));
let failures: any[] = [];
try {
  failures = (await readFile(`${root}/recordings/haiku.failures.jsonl`, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const spend = records.reduce((s, r) => s + r.costUsd, 0) + failures.reduce((s, r) => s + (r.costUsd ?? 0), 0);
const reserve =
  JSON.parse(await readFile(`${root}/results/budget-reserve.json`, 'utf8')).uncertainUsd +
  failures.reduce((s, r) => s + r.reservedUsd, 0);
const receipt = JSON.parse(await readFile(`${root}/results/test-started.json`, 'utf8'));
const pct = (x: number, n: number) => `${((100 * x) / n).toFixed(2)}% (${x}/${n})`;
const cost = (x: number) => x.toFixed(5);
const variants = (r: any) =>
  [
    `| Length alone | ${pct(r.score.length.correct, r.score.length.games)} | 0 | 0 | 0 |`,
    `| Features plus length | ${pct(r.score.features.correct, r.score.features.games)} | ${2 * r.score.features.gained.length} | ${2 * r.score.features.lost.length} | 0 |`,
    `| Reader-first judge (length-aware): features plus judge plus length | ${pct(r.score.combined.correct, r.score.combined.games)} | ${2 * r.score.combined.gained.length} | ${2 * r.score.combined.lost.length} | ${cost(r.costPer100PairsUsd)} |`,
  ].join('\n');
const featureTable = (r: any) =>
  Object.entries(r.firing)
    .map(
      ([name, x]: [string, any]) =>
        `| ${name} | ${x.replies}/${2 * r.completedPairs} | ${x.pairs}/${r.completedPairs} | ${x.oneSidedPairs} | ${x.supportsOverride} |`,
    )
    .join('\n');
const deviations = (r: any, variant: 'features' | 'choice') =>
  r.rows
    .filter((x: any) => x.result[variant] !== x.result.length)
    .map(
      (x: any) =>
        `| ${x.pairKey ?? x.id} | ${x.language} | ${x.machine.A.length} / ${x.machine.B.length} | ${x.result.length} | ${x.result[variant]} | ${x.label} | ${x.result[variant] === x.label ? 'gain' : 'loss'} | ${x.result.failures.join(', ') || 'machine risk gap'} |`,
    )
    .join('\n') || '\nNo decisions differ from length alone.';
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const testSection = test?.complete
  ? `## TEST confirmation\n\nOne frozen TEST run, continued once after a session-limit interruption, covers all 173 pairs and 346 games. Successful prompts replay from cache without repeat calls. The source hashes match the committed freeze. TEST never selects a threshold. Earlier studies already evaluated this split; this is confirmation on a previously evaluated split.\n\n| Variant | Correct games | Games gained vs length | Games lost vs length | USD per 100 pairs |\n|---|---:|---:|---:|---:|\n${variants(test)}\n| Frozen holistic, historical | 58.96% (204/346) | n/a | n/a | 0.54818 |\n| promptfoo, historical | 62.72% (217/346) | n/a | n/a | 0.40649 |\n\nCombined minus holistic: ${test.score.combined.correct - 204} games. Combined minus promptfoo: ${test.score.combined.correct - 217} games. Combined minus length: ${test.score.combined.correct - test.score.length.correct} games. These are observed counts, not significance or general-superiority claims.\n\n| Feature family | Reply flags | Pairs with flag | One-sided pairs | Qualifying supported failures |\n|---|---:|---:|---:|---:|\n${featureTable(test)}\n\n### TEST changes versus longer-wins\n\n| Pair | Language | A / B length | Longer | Reader-first | Gold | Effect | Supported failures |\n|---|---|---:|---|---|---|---|---|\n${deviations(test, 'choice')}\n\nInvalid-evidence fallbacks: ${test.invalidPairs.length}/${test.completedPairs} pairs.\n`
  : `## TEST status\n\n${test ? `PARTIAL: ${test.completedPairs}/173 pairs (${2 * test.completedPairs}/346 games), ${test.stopped ?? 'still running'}. Reader-first: ${test.score.combined.correct}/${2 * test.completedPairs}; length: ${test.score.length.correct}/${2 * test.completedPairs}; features plus length: ${test.score.features.correct}/${2 * test.completedPairs}. These partial counts must not be compared directly with historical full-split holistic 204/346 or promptfoo 217/346. If incomplete at cutoff, remaining pairs resume after the outage from frozen commit ${receipt.commit}, with identical source hashes and cached calls. No full-TEST claim.\n\nPartial invalid-evidence fallbacks: ${test.invalidPairs.length}/${test.completedPairs}. Partial recipe cost: USD ${cost(test.costPer100PairsUsd)} per 100 pairs.\n\n| Feature family | Reply flags | Pairs with flag | One-sided pairs | Qualifying supported failures |\n|---|---:|---:|---:|---:|\n${featureTable(test)}\n\n| Pair | Language | A / B length | Longer | Reader-first | Gold | Effect | Supported failures |\n|---|---|---:|---|---|---|---|---|\n${deviations(test, 'choice')}` : 'Not run yet. The deadline and frozen-DEV gate govern whether TEST starts.'}\n`;
const text = `# Reader-first judge (length-aware)\n\nAn explicit opt-in configuration favors the longer reply unless machine checks and the five-criterion model rubric justify a shorter-reply exception. It remains separate from the default judge.\n\n## Frozen DEV\n\nReport timestamp: ${new Date().toISOString()}. TEST checkpoint: ${test?.at ?? 'not available'}.\n\nAll 90 DEV pairs are covered, with 180 scored games. Each pair has two model presentations; code pools their scores, so the two reported games share one decision. Both presentations retain separate quotes and scores in the raw report.\n\n| Variant | Correct games | Games gained vs length | Games lost vs length | USD per 100 pairs |\n|---|---:|---:|---:|---:|\n${variants(dev)}\n| Frozen holistic, historical | 64.44% (116/180) | n/a | n/a | 0.57181 |\n\nSelected rule: judgeMargin=${dev.thresholds.judgeMargin}, minFailures=${dev.thresholds.minFailures}, featureMargin=${dev.thresholds.featureMargin}. The final full DEV replay runs after the selection commit ${dev.commit}. Freeze record cites that DEV result and the exact source hashes. The committed frozen judge is ${receipt.commit}. Current evidence commit before this report: ${source}.\n\nThe shorter reply wins only when both ballots are valid, its pooled sum advantage reaches judgeMargin, and minFailures criteria have longer<=2, shorter>=3 and a machine flag present only in the longer reply. An invalid ballot retains the length default with an explicit invalid flag. Equal lengths tie. No holistic or competitor ballot enters this calculation.\n\n## Machine feature firing on DEV\n\n| Feature family | Reply flags | Pairs with flag | One-sided pairs | Qualifying supported failures |\n|---|---:|---:|---:|---:|\n${featureTable(dev)}\n\n- Length: English whitespace units, Chinese Han characters. It exactly reproduces the supplied 142/180 baseline.\n- Structure: length>500, no heading/list, and one paragraph or mean paragraph length>250 English / 400 Chinese.\n- Economy: filler+hedge phrases>6 per 1,000 units, duplicate sentences>0.08, or redundant four-grams>0.15.\n- Directness: litotes>1 per 1,000 units.\n- Context: undefined acronyms>3, unexplained dictionary jargon>3, or context-reference phrases>1 per 1,000 units.\n- Simplicity: mean sentence length>35 English / 60 Chinese, or estimated English reading grade>14. Chinese has no English reading-grade estimate.\n\nAll raw feature values, including headings, lists, paragraph counts, means and densities, are retained for every reply. These are heuristic flags, not semantic proof. Requested repetition and appropriate literary forms remain legitimate under the model rubric. Invalid-evidence fallbacks: ${dev.invalidPairs.length}/90 pairs.\n\n### DEV changes versus longer-wins\n\n| Pair | Language | A / B length | Longer | Reader-first | Gold | Effect | Supported failures |\n|---|---|---:|---|---|---|---|---|\n${deviations(dev, 'choice')}\n\n### Machine-only changes versus longer-wins\n\n| Pair | Language | A / B length | Longer | Features | Gold | Effect | Support |\n|---|---|---:|---|---|---|---|---|\n${deviations(dev, 'features')}\n\n## Every DEV threshold variant\n\nThe grid is declared before completion of the exploratory DEV run. Selection maximizes combined DEV accuracy, then minimizes overrides, then prefers a larger judge margin and failure count. The feature-only margin is selected independently, preferring a larger margin on ties. Final DEV replay confirms the chosen rule without new calls. This is tuning on DEV, not a fresh DEV estimate.\n\n| Judge margin | Minimum failures | DEV games correct | Override pairs | Gain pairs | Loss pairs |\n|---:|---:|---:|---:|---:|---:|\n${search.combined.map((x: any) => `| ${x.judgeMargin} | ${x.minFailures} | ${x.correct}/180 | ${x.overrides} | ${x.gained.length} | ${x.lost.length} |`).join('\n')}\n\n| Feature margin | DEV games correct | Override pairs | Gain pairs | Loss pairs |\n|---:|---:|---:|---:|---:|\n${search.features.map((x: any) => `| ${x.featureMargin} | ${x.correct}/180 | ${x.overrides} | ${x.gained.length} | ${x.lost.length} |`).join('\n')}\n\n${testSection}\n## Cost, safety and default preservation\n\nReturned spend: USD ${spend.toFixed(8)}, ${records.length} returned calls. Interrupted-call uncertainty reserve: USD ${reserve.toFixed(2)}. Total accounted exposure: USD ${(spend + reserve).toFixed(8)} of USD 20.00. The original two-worker process is stopped at the owner's concurrency update; its returned calls replay for free. Subsequent concurrency is at most six. The initial new-call cutoff is 2026-10-13 06:39 Brussels. The owner then authorizes immediate continuation after the 06:40 session reset, until the network drops, and another continuation after the outage with the same freeze. The continuation has a 07:40 Brussels safety deadline before the original 07:45 completion target. Recipe costs count both required orders of completed pairs, including replayed calls, and are quoted per 100 pairs (200 presentations). Unfinished orders are excluded from that recipe rate but included in returned spend.\n\nAll 42 pre-existing judge source files except the export index are byte-identical to base d702d90b. The index adds named exports. The full judges suite passes 602 tests with two test workers and a 60-second per-test timeout; the focused golden and configuration run passes 41 tests, including 1,028 legacy cassette entries. The new reader-first fixtures pass 20 tests. Root and research TypeScript checks pass. The package and its workspace dependencies build successfully, including type declarations; the built package export smoke check passes. A first package-only build fails because dependency declarations are not built, then the dependency-inclusive build resolves it. Two runs with the default five-second timeout time out during a dynamic import in an unchanged pairwise test; the run with a 60-second timeout passes without a code change. All nine caller cutoff and cost tests pass using fake processes, with no paid calls. After TEST completes, the single formatter correction is applied. The measured source remains at its frozen commit; format-only-proof.json verifies an identical emitted JavaScript syntax tree. All 20 reader-first fixture tests pass again, and the targeted Biome check exits successfully with warnings only.\n\nThe package API is createReaderFirstJudge(client, { configuration: 'reader-first' }). It is never selected automatically. The doc section is docs/concepts/judges.md. Default source hashes are in results/default-proof.json. Rules and source provenance are in README.md; each criterion's source quotes, scores, machine measurements and decisions are in results/final-dev.json and results/test.json when present. Raw responses are in recordings/haiku.jsonl. One approved benchmark contact is consistently replaced in loaded candidates, recordings and exports; see comparisons/reader-first/recordings/REDACTION.md. Other public benchmark contacts retain their scoped guard annotations. Model-generated punctuation in raw evidence is preserved.\n\nHistorical baselines are supplied by the prior holistic and protocol reports. Length bias is deliberately used here. A better score on these labels does not establish better writing evaluation elsewhere. No default row is merged with this configuration.\n`;
await writeFile('docs/comparison/benchmarks/reader-first.md', text);
const reportPath = process.argv[2];
if (reportPath)
  await writeFile(
    reportPath,
    text +
      '\nPR: https://github.com/achammah/driftbench/pull/157\nBranch: research/astra-reader-first. Worktree: <repo>/.worktrees/astra-reader-first.\n',
  );
console.log(
  JSON.stringify({
    dev: dev.score.combined.correct,
    test: test?.score.combined.correct,
    testComplete: test?.complete,
    spend,
    reserve,
    freezeDev: freeze.devCorrect,
  }),
);
