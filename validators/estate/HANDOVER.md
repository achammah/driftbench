# Handover: validator estate

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 2 |
| 2 | 2 |
| 3 | 2 |
| hidden | 2 |
<!-- level-table:end -->

Iteration 46, source c1ac480c04ed2c7c44cb957a283d631be379ef0f plus the change recorded in this journal row. Hidden seed 250293324, derived from that head.
| Seed | Reader passing / items |
|---|---|
| 1 | 636/641 |
| 2 | 636/641 |
| 3 | 636/641 |
| hidden (250293324) | 636/641 |

Each fraction counts reader items passing on that seed, out of 641 reader items. Journal `passing` counts distinct evaluated item IDs passing every seed; it is not a sum of seed counts. The journal's per-level `metrics` use seed 1; its `perSeed` records achieved levels separately.

## Floor

Estate currently has no configured floor. The owner authorizes raising it in this PR at each level reached on seeds 1, 2, 3 and hidden, following the documented floor procedure. Never lower a floor or change validator items.

## Independent review and generalization evidence

PR 509 remains work in progress. An independent overfitting review marked source `9d9db907d` SUSPECT: the gate scanner split bare filenames at periods and dropped polite and modal directives that main accepts. Iteration 28 replaces the anchored gate patterns with a clause grammar (docs/estate.md, "Gates are read as clauses"). Code spans, links and quotations are single tokens; clauses end only at a sentence end, a semicolon or a coordinated directive; the lead-in before read must be a directive, not a negated, optional or conditional one. Both audit regressions pass in `packages/estate/test/scan/gate-natural-language.test.ts`. A 76-line hand-written corpus run against main `5354503af` loses no gate main finds correctly; every difference is a correct gain. The stage-container patch is still unapplied.

The same-source comparison on seeds 4 through 8 and fresh hidden 645359431 (derived from `9d9db907d`) reproduces the first four groups' gains on every seed: registry values +4, stage successors +4, reference notation +8, prerequisite forms +11. Candidate reader counts are 601/641 on all six seeds; levels stay 0. Main product counts are 574 on seeds 4, 7 and hidden, and 573 on 5, 6 and 8 because the wide-folder timer fails. No item regresses in that comparison. Timing recoveries are not credited to the product changes. These bank gains do not discharge the independent gate regressions.

Owner rule: "make sure all the fixes are fixes that are TO THE FRAMEWORK in general and not just fixes that are overfitting to the problem to make the test pass". Each fix must state its general behavior with a product-doc line, avoid bank identifiers/seeds/fixture strings in product code, have independent non-bank product tests, and report seeds 4 through 8 plus a fresh hidden seed in PR 509. The owner controls merge after independent review and green CI.

## Open items

- scan.decoys.changelog-reference: [scan.decoys, tier 4] code is not fooled: a file named in a change note is no reference: found reference reference.ticket-price-14oprfr.read-references-legacy-md at .claude/skills/ticket-price-14oprfr/SKILL.md:12, never planted
- scan.decoys.form-number-label: [scan.decoys, tier 4] code is not fooled: a form number that reads like a rule label cites no rule: a form number cited a rule
- scan.decoys.guard-message-overlap: [scan.decoys, tier 4] code is not fooled: a guard message that quotes part of a rule's words is no enforcement: the guard enforces a rule it only quotes in passing
- scan.decoys.script-name-in-prose: [scan.decoys, tier 3] code is not fooled: a script's name mentioned in passing anchors no script on that line: missed script .claude/skills/recipe-pack-18xh08m/scripts/tally.py at .claude/skills/recipe-pack-18xh08m/SKILL.md:10; found script script.recipe-pack-18xh08m.script-scripts-tally-py at .claude/skills/recipe-pack-18xh08m/SKILL.md:9, never planted
- scan.decoys.hazard-in-example-quote: [scan.decoys, tier 4] code is not fooled: a hazard word inside a quoted example is no hazard: found hazard hazard.menu-review-6c2zvj.recover-from-a-wave-of-rate at .claude/skills/menu-review-6c2zvj/SKILL.md:10, never planted

## Hypotheses tried

Iteration 46: plain-name helper dispatch. +1 on every seed: blind.edges.dispatch-plain-name.
Iteration 45: reference chains owned by the reading skill. +1 on every seed: scan.reference-prose.chained.
Iteration 44: routing read by role (tables of any header, links, slash commands, outer-pipe-less tables, standing directive lines, per-skill headings, owner tables rejected). +8 on every seed.
Iteration 43: standing @imports. +1 on every seed: scan.standing.imported-standing.
Iteration 42: explicit document references followed transitively. +2 on every seed: scan.reference-prose.text-file, outside-skill. Chained still misses its graph edge (separate cause).
Iteration 41: case-insensitive rule labels. +1 on every seed: scan.registry.md-label-lowercase.
Iteration 40: standing size in code points. +1 on every seed: blind.lint.emoji-count-as-characters.
Iteration 39: nudge as a verb on domain objects is no hazard. +1 on every seed: scan.hazards.decoy-price.
Iteration 38: hazard synonyms (reboot, 429, too many requests, resumed session). +3 on every seed: scan.hazards.status-429, reboot, resumed. Wide-folder lost on seed 3 and hidden on timing only.
Iteration 37: CRLF and tab-indented frontmatter in the tolerant pass. +3 on every seed: scan.combination.colon+crlf, prefixguard+crlf, scan.hostile.tabs-in-frontmatter. Seed 1 lost blind.gates.plain-comma on timing only.
Iteration 36: nested CLAUDE.md discovery. +1 on every seed: scan.standing.nested-standing.
Iteration 35: helpers in agent subfolders. +1 on every seed: scan.hostile.helper-subfolder.
Iteration 34: shell context for hook commands (cd &&, sh -c wrappers). +2 on every seed: scan.dispatcher.change-folder, shell-wrapper. Seed 1 lost wide-folder on timing only.
Iteration 33: registry rows that name a guard by its command. +1 on every seed: scan.catalogue.guard-command-key.
Iteration 32: duplicate skill names noted. +1 on every seed: scan.hostile.duplicate-names.
Iteration 31: prompt hooks and malformed hook containers. +2 on every seed: scan.hostile.prompt-hook, hooks-wrong-shape.
Iteration 30: JSON with comments and trailing commas in step files. +2 on every seed: scan.steps.comments, trailing-commas.
Iteration 29: step containers at any depth (process arrays, keyed steps, wrapper keys). +3 items on every seed: scan.steps.process-array, keyed-by-id, nested-workflow.
Iteration 28: gate clause grammar. No bank change (601 on every seed); it repairs the two audit regressions. A first version read "read it before anything else" as a gate (pronoun target, "anything" taken for an -ing verb) and lost scan.hazards.notification; bounded targets now must be a token or a path, and -thing words are no act.
Parse prerequisite clauses with directive anchoring, all supported read-order forms and act labels. Eleven gate items improve; scan.hostile.wide-folder times out at 9106ms on seed3 only, retained for investigation.
Fixed this round: blind.gates.decoy-never-read-before, scan.gates.act-rename, scan.gates.act-update, scan.gates.decoy-example, scan.gates.markdown-link, scan.gates.only-after-form, scan.gates.prior-to-form, scan.gates.question-form, scan.gates.then-form, scan.gates.two-on-one-line, scan.gates.without-form. Regressions: scan.hostile.wide-folder.
Earlier rounds remain in journal.jsonl. Initial macOS baseline on 14034c6ca is 574/641, level 0 on seeds 1, 2, 3 and hidden 336760492.
Linux CI reports 551/641 because all 23 symlink items fail during fixture construction before product code runs.
The loop fixture passes an empty symlink target; a separate maintainer lane owns that correction.

## Next actions

1. Read the latest journal row and failure list; fix the next product root cause with a failing regression test first.
2. Run estate tests and the validator on seeds 1, 2, 3 and the commit-derived hidden seed. Keep every item and threshold unchanged.
3. Push each round and update the ready WIP PR, authorized for Linux CI. Continue upward after reader passes all four seeds; only the owner merges after independent review and green CI.

## Pitfalls

- Use exactly one worktree on feat/estate-reader-level1. Every git call uses git -C.
- Run host tests outside the outer sandbox: otherwise tsx sockets and nested sandbox-exec fail independently of the product.
- Packages/estate product changes, its tests, this handover and journal are authorized; the owner additionally authorizes an estate floor increase at each fully verified level. Report suspected oracle errors to the lead.
- No paid calls, secrets, full suite, new copies or extra worktrees. Disk is tight.
- Commit trailer: the Co-Authored-By line that names Claude Opus 5.5, as the repository convention gives it.
- PR footer: 🤖 Generated with [Claude Code](https://claude.com/claude-code).
- Keep node_modules and worktree until the final push, then remove both.

## How to run

```sh
pnpm exec vitest run packages/estate/test
pnpm -s driftbench validate estate --seeds 1..3 --hidden --json
pnpm -s driftbench validate estate --journal .cache/estate-climb/journal-row.json
```

Latest captures: .cache/estate-climb/round26-linear.json, .cache/estate-climb/round27.json. Local captures are not pushed.
The current run follows the user's four-seed milestone; no unmeasured 1..20 sweep is claimed.

## Fixtures

The fictional inputs live in packages/validators/src/ladders/estate/bank and examples/estates/fixture.
Product regressions live under packages/estate/test. No validator fixtures are edited.

### Reproduce the four-seed measurement

Run from the repository root. The hidden seed derives from the current commit; record that commit and any uncommitted product diff.

```sh
pnpm -s driftbench validate estate --brief --fresh --seeds 1..3 --hidden
pnpm -s driftbench validate estate --seeds 1..3 --hidden --json
```

A plain validation exits with its achieved level, not a conventional success/failure code. The captures named above are local evidence, not committed prerequisites. A new executor creates new before/after captures for its own change:

```sh
mkdir -p .cache/estate-climb
pnpm -s driftbench validate estate --seeds 1..3 --hidden --json > .cache/estate-climb/before.json
# Make one product fix, run its regression tests, then capture the same seed set.
pnpm -s driftbench validate estate --seeds 1..3 --hidden --json > .cache/estate-climb/after.json
```

### Produce the journal row

The following recipe needs only the committed journal and those two new captures. Replace the metadata arguments with the actual hypothesis, changed files, tests, research sources/finding and measured duration. Lists use `|`; use `none` for no added tests. Token estimate `0` means unmeasured.

```sh
python3 - 'hypothesis' 'packages/estate/src/changed.ts' 'regression tests added' 'docs/estate.md|packages/estate/src/changed.ts' 'research finding' 0 <<'PY'
import collections, datetime, json, sys
from pathlib import Path
hypothesis, files, tests, sources, finding, minutes = sys.argv[1:]
root = Path('.cache/estate-climb')
before = json.loads((root / 'before.json').read_text())
after = json.loads((root / 'after.json').read_text())
previous = [json.loads(line) for line in Path('validators/estate/journal.jsonl').read_text().splitlines()]
label = lambda seed: 'hidden' if seed['hidden'] else str(seed['seed'])
old_seeds = {label(seed): seed for seed in before['seeds']}
def failed(report):
    return {item['id']: item for seed in report['seeds'] for row in seed['rows']
            for item in row.get('bank', []) if not item['pass']}
old, failures = failed(before), failed(after)
rows = after['seeds'][0]['rows']
bank = {item['id'] for row in rows for item in row.get('bank', [])}
fixed, regressed = sorted(old.keys() - failures.keys()), sorted(failures.keys() - old.keys())
record = {
    'iteration': max(row['iteration'] for row in previous) + 1,
    'at': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
    'model': 'Codex', 'seeds': [label(seed) for seed in after['seeds']],
    'command': 'pnpm -s driftbench validate estate --seeds 1..3 --hidden --json',
    'level': {'before': before['level'], 'after': after['level']},
    'perSeed': [{'seed': label(seed), 'before': old_seeds[label(seed)]['level'], 'after': seed['level']}
                for seed in after['seeds']],
    'metrics': [{'level': row['level'], 'id': row['id'], 'metric': row['metric'],
                 'threshold': row['threshold'],
                 'before': next((r['observed'] for r in before['seeds'][0]['rows'] if r['id'] == row['id']), None),
                 'after': row['observed']} for row in rows],
    'bankSize': len(bank), 'passing': len(bank - failures.keys()),
    'failingByFamily': dict(collections.Counter(item['family'] for item in failures.values())),
    'failingBefore': sorted(old), 'hypothesis': hypothesis,
    'research': {'sources': sources.split('|'), 'finding': finding + f' Fixed: {fixed}. Regressed: {regressed}.'},
    'change': {'files': files.split('|'), 'commit': None},
    'testsAdded': [] if tests == 'none' else tests.split('|'),
    'result': 'raised' if after['level'] > before['level'] else 'lowered' if after['level'] < before['level'] else 'unchanged',
    'durationMinutes': float(minutes), 'tokenEstimate': 0,
}
(root / 'journal-row.json').write_text(json.dumps(record, indent=2) + '\n')
PY
pnpm -s driftbench validate estate --journal .cache/estate-climb/journal-row.json
```

Review the generated row before appending. The journal command appends the row and updates the handover level table; update the other handover sections from the same capture. `passing` counts item IDs that pass every requested seed, once per item. `bankSize` is the evaluated prefix; later unmeasured levels are not included. `metrics` carries seed 1's level metrics; `perSeed` carries each seed's achieved level.
