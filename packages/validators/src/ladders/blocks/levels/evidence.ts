import { canonical, observed, type Rng, rngFor } from '../harness';
import { token } from '../kinds';
import { type BlocksProduct, need } from '../product';
import { type BankItem, fail, PASS, type Tier } from '../types';

/**
 * Level 5, the evidence names blame reads (docs/reference/block-contracts.md, "Evidence names"). Each name is
 * computed by its own provider, so each name is its own cause: an item hands `evidence.computeEvidence` one
 * failing verdict of a stored block, with a fixture estate map (atoms, edges, pointers), links, plan rows,
 * value facts and stored readings, and compares the one name it asks for with the value the documented rule
 * gives by construction. A value the rule leaves unknown must be absent from the answer. The cases of a name
 * are its twins: the same input with the one fact that flips the value.
 */

type Obj = Record<string, unknown>;

/** The seeded names of one item: tools, skills, files, atoms; letters and digits only. */
type Names = {
  rng: Rng;
  tool: string;
  tool2: string;
  skill: string;
  skill2: string;
  /** `.claude/skills/<skill>/SKILL.md`, a reference and a script of the skill, a helper, a hook, the core file. */
  body: string;
  ref: string;
  ref2: string;
  script: string;
  helper: string;
  hook: string;
  core: string;
  atom: (tag: string) => string;
  word: (tag: string) => string;
};

function names(seed: number, id: string): Names {
  const t = (tag: string, n = 6) => token(seed, `${id}#${tag}`, n);
  const skill = `s${t('skill')}`;
  const skill2 = `s${t('skill2')}`;
  return {
    rng: rngFor(seed, id),
    tool: `t${t('tool')}`,
    tool2: `t${t('tool2')}`,
    skill,
    skill2,
    body: `.claude/skills/${skill}/SKILL.md`,
    ref: `.claude/skills/${skill}/references/${t('ref')}.md`,
    ref2: `.claude/skills/${skill}/references/${t('ref2')}.md`,
    script: `.claude/skills/${skill}/scripts/${t('script')}.py`,
    helper: `.claude/agents/${t('helper')}.md`,
    hook: `.claude/hooks/${t('hook')}.py`,
    core: `${t('core').toUpperCase()}.md`,
    atom: (tag) => `a.${t(`atom:${tag}`, 8)}`,
    // Letters only: a value's digits decide `agent_derived`, so no seeded word may carry one by chance.
    word: (tag) => t(`word:${tag}`, 8).replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] as string),
  };
}

type Call = { label: string; input?: Obj; output?: unknown; error?: string };

/** A machine verdict of the stored block. */
function verdict(id: string, extra: Obj = {}): Obj {
  return {
    id,
    name: id.split('.')[0],
    kind: 'machine',
    gating: true,
    outcome: 'fail',
    evidence: `${id} failed`,
    ...extra,
  };
}

/** The stored block: the observation (text, tool calls, and any extra fields of the run record) and its verdicts. */
function block(text: string, calls: Call[], verdicts: Obj[], extra: Obj = {}): Obj {
  return { observed: { ...observed(text, calls), ...extra }, verdicts };
}

/** An estate atom: its id, kind and file, with optional evidence, situation and fields. */
function atom(id: string, kind: string, file: string, extra: Obj = {}): Obj {
  return { id, kind, provenance: { file, startLine: 3 }, ...extra };
}

/** One input for one failing verdict: the root verdict is the block's first verdict unless named. */
function input(stored: Obj, extra: Obj = {}, root?: Obj): Obj {
  const verdicts = stored.verdicts as Obj[];
  return { block: stored, verdict: root ?? verdicts[0], ...extra };
}

/** A case: a name's input and the value its documented rule gives; `undefined` when the rule leaves it unknown. */
type Case = { id: string; tier: Tier; build(n: Names): { input: Obj; want: unknown } };

type Name = { name: string; family: string; file: string; cases: Case[] };

const countId = (tool: string) => `tools.${tool}.count`;
const inputId = (tool: string, field: string) => `tools.${tool}.input.${field}`;

/** A failing verdict on the subject tool's count, its block holding one call of the tool. */
const onTool = (n: Names, calls: Call[] = [{ label: n.tool, input: {} }], text = 'Done.') =>
  block(text, calls, [verdict(countId(n.tool))]);

/** A failing verdict with one value fact on the tool's field. */
const withFact = (n: Names, fact: Obj, calls: Call[] = [], text = 'Let me check.') =>
  ({
    stored: block(text, calls, [verdict(inputId(n.tool, 'email'))]),
    values: [{ tool: n.tool, field: 'email', ...fact }],
  }) as const;

const NAMES: Name[] = [
  {
    name: 'verdict_check',
    family: 'evidence-verdict',
    file: 'trace',
    cases: [
      {
        id: 'tools',
        tier: 1,
        build: (n) => ({ input: input(onTool(n)), want: 'tools' }),
      },
      {
        id: 'named-check',
        tier: 1,
        build: (n) => {
          const name = n.word('check');
          return {
            input: input(block('Done.', [], [verdict(`${name}.0`, { name })])),
            want: name,
          };
        },
      },
      {
        id: 'root-not-first',
        tier: 2,
        build: (n) => {
          const second = verdict(`must.0`, { name: 'must' });
          return {
            input: input(block('Done.', [], [verdict(countId(n.tool)), second]), {}, second),
            want: 'must',
          };
        },
      },
    ],
  },
  {
    name: 'verdict_kind',
    family: 'evidence-verdict',
    file: 'trace',
    cases: [
      { id: 'machine', tier: 1, build: (n) => ({ input: input(onTool(n)), want: 'machine' }) },
      {
        id: 'judge',
        tier: 1,
        build: () => ({
          input: input(block('Done.', [], [verdict('judge.tone', { name: 'judge', kind: 'judge' })])),
          want: 'judge',
        }),
      },
    ],
  },
  {
    name: 'rule_mechanical',
    family: 'evidence-verdict',
    file: 'rule',
    cases: [
      { id: 'machine', tier: 1, build: (n) => ({ input: input(onTool(n)), want: true }) },
      {
        id: 'judge',
        tier: 1,
        build: () => ({
          input: input(block('Done.', [], [verdict('judge.tone', { name: 'judge', kind: 'judge' })])),
          want: false,
        }),
      },
    ],
  },
  {
    name: 'first_violation',
    family: 'evidence-verdict',
    file: 'trace',
    cases: [
      {
        id: 'by-place-in-trace',
        tier: 3,
        build: (n) => {
          // The second tool runs first, so its verdict is the earliest act although it is listed second.
          const stored = block(
            'Done.',
            [
              { label: n.tool2, input: {} },
              { label: n.tool, input: {} },
            ],
            [verdict(countId(n.tool)), verdict(countId(n.tool2))],
          );
          return { input: input(stored), want: countId(n.tool2) };
        },
      },
      {
        id: 'uncalled-tool-last',
        tier: 3,
        build: (n) => {
          const stored = block(
            'Done.',
            [{ label: n.tool2, input: {} }],
            [verdict(countId(n.tool)), verdict(countId(n.tool2))],
          );
          return { input: input(stored), want: countId(n.tool2) };
        },
      },
      {
        id: 'inconclusive-skipped',
        tier: 3,
        build: (n) => {
          const stored = block(
            'Done.',
            [
              { label: n.tool, input: {} },
              { label: n.tool2, input: {} },
            ],
            [verdict(countId(n.tool), { outcome: 'inconclusive' }), verdict(countId(n.tool2))],
          );
          return { input: input(stored), want: countId(n.tool2) };
        },
      },
      {
        id: 'non-gating-skipped',
        tier: 3,
        build: (n) => {
          const stored = block(
            'Done.',
            [
              { label: n.tool, input: {} },
              { label: n.tool2, input: {} },
            ],
            [verdict(countId(n.tool), { gating: false }), verdict(countId(n.tool2))],
          );
          return { input: input(stored), want: countId(n.tool2) };
        },
      },
      {
        id: 'tie-keeps-listed-order',
        tier: 2,
        build: (n) => {
          const stored = block(
            'Done.',
            [{ label: n.tool, input: {} }],
            [verdict('must.0', { name: 'must' }), verdict('lang', { name: 'lang' })],
          );
          return { input: input(stored), want: 'must.0' };
        },
      },
      {
        id: 'none-failing',
        tier: 2,
        build: (n) => {
          const stored = block('Done.', [], [verdict(countId(n.tool), { outcome: 'pass' })]);
          return { input: input(stored), want: undefined };
        },
      },
    ],
  },
  {
    name: 'rule_atom',
    family: 'evidence-rule',
    file: 'rule',
    cases: [
      {
        id: 'atoms-in-order',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          const b = n.atom('b');
          return {
            input: input(onTool(n), {
              ruleAtoms: [b, a],
              atoms: [atom(a, 'rule', n.body), atom(b, 'rule', n.core)],
            }),
            want: [b, a],
          };
        },
      },
      {
        id: 'atom-not-in-map',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          const b = n.atom('b');
          return {
            input: input(onTool(n), { ruleAtoms: [a, b], atoms: [atom(b, 'rule', n.body)] }),
            want: [b],
          };
        },
      },
      {
        id: 'links-file-line',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n), {
            links: [
              { verdict: `tools.${n.tool}.*`, home: 'core', act: 'step', file: n.core, line: 12 },
              { verdict: 'must.0', home: 'core', act: 'step', file: n.helper, line: 4 },
            ],
          }),
          want: [`${n.core}:12`],
        }),
      },
      {
        id: 'link-no-file',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n), {
            links: [{ verdict: countId(n.tool), home: 'tool_schema', act: 'tool_contract' }],
          }),
          want: ['tool_schema:0'],
        }),
      },
      { id: 'none', tier: 1, build: (n) => ({ input: input(onTool(n)), want: 'none' }) },
    ],
  },
  {
    name: 'rule_home',
    family: 'evidence-rule',
    file: 'rule',
    cases: [
      ...(
        [
          ['reference-kind', 'reference', 'core', 'skill_reference'],
          ['script-kind', 'script', 'core', 'skill_script'],
          ['subagent-kind', 'subagent', 'core', 'helper'],
          ['guard-kind', 'guard', 'core', 'guard'],
          ['tool-kind', 'tool', 'core', 'tool_schema'],
          ['skill-body', 'rule', 'body', 'skill_body'],
          ['skill-script-file', 'rule', 'script', 'skill_script'],
          ['skill-other-file', 'rule', 'ref', 'skill_reference'],
          ['helper-file', 'rule', 'helper', 'helper'],
          ['hook-file', 'rule', 'hook', 'guard'],
          ['core-file', 'rule', 'core', 'core'],
        ] as const
      ).map(
        ([id, kind, where, want]): Case => ({
          id,
          tier: (kind === 'rule' ? 2 : 1) as Tier,
          build: (n) => {
            const a = n.atom('a');
            return { input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, kind, n[where])] }), want };
          },
        }),
      ),
      {
        id: 'link-home',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n), {
            links: [{ verdict: countId(n.tool), home: 'instruction', act: 'step' }],
          }),
          want: 'instruction',
        }),
      },
      { id: 'none', tier: 1, build: (n) => ({ input: input(onTool(n)), want: 'none' }) },
    ],
  },
  {
    name: 'rule_skill',
    family: 'evidence-rule',
    file: 'rule',
    cases: [
      {
        id: 'from-atom-file',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.ref)] }),
            want: n.skill,
          };
        },
      },
      {
        id: 'core-atom',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.core)] }),
            want: undefined,
          };
        },
      },
      {
        id: 'link-skill',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n), {
            links: [
              { verdict: countId(n.tool), home: 'skill_body', act: 'step', skill: n.skill2, file: n.body },
            ],
          }),
          want: n.skill2,
        }),
      },
      {
        id: 'link-file',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n), {
            links: [{ verdict: countId(n.tool), home: 'skill_body', act: 'step', file: n.body }],
          }),
          want: n.skill,
        }),
      },
    ],
  },
  {
    name: 'rule_act',
    family: 'evidence-rule',
    file: 'rule',
    cases: [
      ...(
        [
          ['skill-loaded', [{ type: 'skill_loaded', name: 'x' }], 'rule', 'load_skill'],
          ['skill-not-loaded', [{ type: 'skill_not_loaded', name: 'x' }], 'rule', 'load_skill'],
          ['read', [{ type: 'tool_called', label: 'Read' }], 'rule', 'read_reference'],
          ['ordered', [{ type: 'ordered', before: 'Read', after: 'Edit' }], 'rule', 'ordered'],
          ['stage', [{ type: 'stage_reached', name: 'verify' }], 'rule', 'stage'],
          [
            'custom-ordered',
            [{ type: 'custom', name: 'ordered', options: { before: 'A', after: 'B' } }],
            'rule',
            'ordered',
          ],
          [
            'custom-stage',
            [{ type: 'custom', name: 'stage_seen', options: { name: 'plan' } }],
            'rule',
            'stage',
          ],
          ['gate-kind', [], 'gate', 'gate'],
          [
            'first-predicate',
            [
              { type: 'stage_reached', name: 'a' },
              { type: 'skill_loaded', name: 'y' },
            ],
            'rule',
            'stage',
          ],
        ] as const
      ).map(
        ([id, evidence, kind, want]): Case => ({
          id,
          tier: (id === 'first-predicate' || id.startsWith('custom') ? 3 : 2) as Tier,
          build: (n) => {
            const a = n.atom('a');
            return {
              input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, kind, n.body, { evidence })] }),
              want,
            };
          },
        }),
      ),
      {
        id: 'link-act',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n), { links: [{ verdict: countId(n.tool), home: 'core', act: 'recovery' }] }),
          want: 'recovery',
        }),
      },
    ],
  },
  {
    name: 'act_signature',
    family: 'evidence-rule',
    file: 'rule',
    cases: [
      ...(
        [
          ['ordered', [{ type: 'ordered', before: 'Read', after: 'Edit' }], 'ordered:Read>Edit'],
          ['stage', [{ type: 'stage_reached', name: 'verify' }], 'stage:verify'],
          ['tool', [{ type: 'tool_called', label: 'TOOL' }], 'tool_called:TOOL'],
          ['read', [{ type: 'tool_called', label: 'Read' }], 'read_reference'],
          ['load', [{ type: 'skill_loaded', name: 'x' }], 'load_skill'],
        ] as const
      ).map(
        ([id, evidence, want]): Case => ({
          id,
          tier: 3,
          build: (n) => {
            const a = n.atom('a');
            const label = n.tool2;
            const swap = (value: unknown) =>
              JSON.parse(JSON.stringify(value).replace(/TOOL/g, label)) as unknown;
            return {
              input: input(onTool(n), {
                ruleAtoms: [a],
                atoms: [atom(a, 'rule', n.body, { evidence: swap(evidence) })],
              }),
              want: swap(want),
            };
          },
        }),
      ),
    ],
  },
  {
    name: 'rule_situational',
    family: 'evidence-rule',
    file: 'rule',
    cases: [
      {
        id: 'situated-rule',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.body, { situation: n.word('s') })],
            }),
            want: true,
          };
        },
      },
      {
        id: 'unsituated-rule',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.body)] }),
            want: false,
          };
        },
      },
      {
        id: 'situated-pointer',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'reference', n.body, { situation: n.word('s'), fields: { path: n.ref } })],
            }),
            want: false,
          };
        },
      },
      {
        id: 'situated-route',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'route', n.body, { situation: n.word('s') })],
            }),
            want: false,
          };
        },
      },
      {
        id: 'link-only',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n), {
            links: [{ verdict: countId(n.tool), home: 'core', act: 'step' }],
            expect: { situation: n.word('s') },
          }),
          want: false,
        }),
      },
      {
        id: 'block-situation',
        tier: 3,
        build: (n) => ({ input: input(onTool(n), { expect: { situation: n.word('s') } }), want: true }),
      },
      { id: 'unknown', tier: 2, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'routed_skills',
    family: 'evidence-skill',
    file: 'rule',
    cases: [
      {
        id: 'expect-skills',
        tier: 1,
        build: (n) => ({
          input: input(onTool(n), { expect: { skills: [n.skill, n.skill2] } }),
          want: [n.skill, n.skill2],
        }),
      },
      {
        id: 'route-atom-name',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              expect: { skills: [n.skill] },
              ruleAtoms: [a],
              atoms: [atom(a, 'route', n.core, { fields: { name: n.skill2 } })],
            }),
            want: [n.skill, n.skill2],
          };
        },
      },
      {
        id: 'skill-atom-file-once',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              expect: { skills: [n.skill] },
              ruleAtoms: [a],
              atoms: [atom(a, 'skill', n.body)],
            }),
            want: [n.skill],
          };
        },
      },
      {
        id: 'rule-atom-not-routed',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return { input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.body)] }), want: [] };
        },
      },
    ],
  },
  {
    name: 'skill_loaded',
    family: 'evidence-skill',
    file: 'rule',
    cases: [
      {
        id: 'runtime-list',
        tier: 1,
        build: (n) => ({
          input: input(
            block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })], {
              runtime: { skills: [{ name: n.skill }] },
            }),
          ),
          want: true,
        }),
      },
      {
        id: 'runtime-other-skill',
        tier: 2,
        build: (n) => ({
          input: input(
            block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })], {
              runtime: { skills: [{ name: n.skill2 }] },
            }),
          ),
          want: false,
        }),
      },
      {
        id: 'skill-call',
        tier: 2,
        build: (n) => ({
          input: input(
            block(
              'Done.',
              [{ label: 'Skill', input: { skill: n.skill }, output: 'loaded' }],
              [verdict(`skills.${n.skill}`, { name: 'skills' })],
            ),
          ),
          want: true,
        }),
      },
      {
        id: 'failed-skill-call-beats-runtime',
        tier: 4,
        build: (n) => ({
          input: input(
            block(
              'Done.',
              [{ label: 'Skill', input: { skill: n.skill }, error: 'refused' }],
              [verdict(`skills.${n.skill}`, { name: 'skills' })],
              { runtime: { skills: [{ name: n.skill }] } },
            ),
          ),
          want: false,
        }),
      },
      {
        id: 'full-read-of-body',
        tier: 3,
        build: (n) => ({
          input: input(
            block(
              'Done.',
              [{ label: 'Read', input: { file_path: n.body }, output: 'body' }],
              [verdict(`skills.${n.skill}`, { name: 'skills' })],
            ),
          ),
          want: true,
        }),
      },
      {
        id: 'partial-read-of-body',
        tier: 3,
        build: (n) => ({
          input: input(
            block(
              'Done.',
              [{ label: 'Read', input: { file_path: n.body, limit: 20 }, output: 'body' }],
              [verdict(`skills.${n.skill}`, { name: 'skills' })],
            ),
          ),
          want: false,
        }),
      },
      {
        id: 'subject-from-rule-skill',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n, [{ label: n.tool, input: {} }]), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.body)],
            }),
            want: false,
          };
        },
      },
      { id: 'no-subject', tier: 2, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'skill_covers',
    family: 'evidence-skill',
    file: 'rule',
    cases: [
      {
        id: 'route-positive',
        tier: 2,
        build: (n) => ({
          input: input(block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })]), {
            planRows: [{ atomIds: [], testType: 'route_positive', skill: n.skill }],
          }),
          want: 'covered',
        }),
      },
      {
        id: 'route-near-miss',
        tier: 2,
        build: (n) => ({
          input: input(block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })]), {
            planRows: [{ atomIds: [], testType: 'route_near_miss', skill: n.skill }],
          }),
          want: 'not_covered',
        }),
      },
      {
        id: 'row-by-atom-id',
        tier: 3,
        build: (n) => ({
          input: input(block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })]), {
            planRows: [
              { atomIds: [`x.${n.skill2}.y`], testType: 'route_near_miss' },
              { atomIds: [`x.${n.skill}.y`], testType: 'route_positive' },
            ],
          }),
          want: 'covered',
        }),
      },
      {
        id: 'reference-loads-at-bar',
        tier: 3,
        build: (n) => ({
          input: input(block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })]), {
            confirm: { runs: 3, reference_loads: 2 },
          }),
          want: 'covered',
        }),
      },
      {
        id: 'reference-loads-under-bar',
        tier: 3,
        build: (n) => ({
          input: input(block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })]), {
            confirm: { runs: 3, reference_loads: 2 },
            bar: 3,
          }),
          want: 'not_covered',
        }),
      },
      {
        id: 'unknown',
        tier: 1,
        build: (n) => ({
          input: input(block('Done.', [], [verdict(`skills.${n.skill}`, { name: 'skills' })])),
          want: 'unknown',
        }),
      },
    ],
  },
  {
    name: 'rule_skill_routed',
    family: 'evidence-skill',
    file: 'rule',
    cases: [
      {
        id: 'routed',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              expect: { skills: [n.skill] },
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref)],
            }),
            want: true,
          };
        },
      },
      {
        id: 'not-routed',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              expect: { skills: [n.skill2] },
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref)],
            }),
            want: false,
          };
        },
      },
      {
        id: 'no-rule-skill',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), {
              expect: { skills: [n.skill] },
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.core)],
            }),
            want: undefined,
          };
        },
      },
    ],
  },
  {
    name: 'rule_in_context',
    family: 'evidence-skill',
    file: 'reference',
    cases: [
      {
        id: 'core-rule',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.core)] }),
            want: true,
          };
        },
      },
      {
        id: 'body-loaded',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(
              block('Done.', [{ label: n.tool, input: {} }], [verdict(countId(n.tool))], {
                runtime: { skills: [{ name: n.skill }] },
              }),
              { ruleAtoms: [a], atoms: [atom(a, 'rule', n.body)] },
            ),
            want: true,
          };
        },
      },
      {
        id: 'body-not-loaded',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.body)] }),
            want: false,
          };
        },
      },
      {
        id: 'reference-read-full',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(
              onTool(n, [
                { label: 'Read', input: { file_path: n.ref }, output: 'text' },
                { label: n.tool, input: {} },
              ]),
              { ruleAtoms: [a], atoms: [atom(a, 'rule', n.ref)] },
            ),
            want: true,
          };
        },
      },
      {
        id: 'reference-read-partial',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(
              onTool(n, [
                { label: 'Read', input: { file_path: n.ref, offset: 10 }, output: 'text' },
                { label: n.tool, input: {} },
              ]),
              { ruleAtoms: [a], atoms: [atom(a, 'rule', n.ref)] },
            ),
            want: false,
          };
        },
      },
      {
        id: 'helper-unknown',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.helper)] }),
            want: undefined,
          };
        },
      },
    ],
  },
  {
    name: 'rule_needed_by',
    family: 'evidence-rule',
    file: 'rule',
    cases: [
      {
        id: 'own-skill-only',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return { input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.ref)] }), want: 1 };
        },
      },
      {
        id: 'plan-row-and-routed',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          const third = `s${n.word('third')}`;
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref)],
              expect: { skills: [n.skill2] },
              planRows: [{ atomIds: [a], skill: third }],
            }),
            want: 3,
          };
        },
      },
      {
        id: 'core-cites',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const c = n.atom('c');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref), atom(c, 'rule', n.core)],
              edges: [{ from: c, to: a, kind: 'cites' }],
            }),
            want: 2,
          };
        },
      },
      {
        id: 'other-edge-kind',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const c = n.atom('c');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref), atom(c, 'rule', n.core)],
              edges: [{ from: c, to: a, kind: 'contains' }],
            }),
            want: 1,
          };
        },
      },
      { id: 'no-atom', tier: 2, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'ref_exists',
    family: 'evidence-reference',
    file: 'reference',
    cases: [
      ...([true, false] as const).map(
        (exists): Case => ({
          id: exists ? 'reference-atom-true' : 'reference-atom-false',
          tier: 2,
          build: (n) => {
            const a = n.atom('a');
            return {
              input: input(onTool(n), {
                ruleAtoms: [a],
                atoms: [atom(a, 'reference', n.body, { fields: { path: n.ref, exists } })],
              }),
              want: exists,
            };
          },
        }),
      ),
      {
        id: 'from-pointer',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.ref),
                atom(p, 'gate', n.body, { fields: { path: n.ref, exists: false } }),
              ],
            }),
            want: false,
          };
        },
      },
      {
        id: 'no-reference',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.core)] }),
            want: undefined,
          };
        },
      },
    ],
  },
  {
    name: 'ref_forced',
    family: 'evidence-reference',
    file: 'reference',
    cases: [
      {
        id: 'from-body',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref), atom(p, 'reference', n.body, { fields: { path: n.ref } })],
            }),
            want: true,
          };
        },
      },
      {
        id: 'from-another-reference',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref), atom(p, 'reference', n.ref2, { fields: { path: n.ref } })],
            }),
            want: false,
          };
        },
      },
      {
        id: 'other-situation',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.ref),
                atom(p, 'reference', n.body, { fields: { path: n.ref }, situation: n.word('s') }),
              ],
              expect: { situation: n.word('t') },
            }),
            want: false,
          };
        },
      },
      {
        id: 'same-situation',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.ref),
                atom(p, 'reference', n.body, { fields: { path: n.ref }, situation: n.word('s') }),
              ],
              expect: { situation: n.word('s') },
            }),
            want: true,
          };
        },
      },
      {
        id: 'situation-atoms',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.ref),
                atom(p, 'gate', n.core, { fields: { path: n.ref }, situation: n.word('s') }),
              ],
              expect: { situation: n.word('t'), situationAtoms: [p] },
            }),
            want: true,
          };
        },
      },
      {
        id: 'pointer-from-field',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.ref),
                atom(p, 'reference', n.ref2, { fields: { path: n.ref, from: n.body } }),
              ],
            }),
            want: true,
          };
        },
      },
      {
        id: 'no-reference',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.core)] }),
            want: undefined,
          };
        },
      },
    ],
  },
  {
    name: 'ref_depth',
    family: 'evidence-reference',
    file: 'reference',
    cases: [
      {
        id: 'one',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [atom(a, 'rule', n.ref), atom(p, 'reference', n.body, { fields: { path: n.ref } })],
            }),
            want: 1,
          };
        },
      },
      {
        id: 'two',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          const q = n.atom('q');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.ref),
                atom(p, 'reference', n.ref2, { fields: { path: n.ref } }),
                atom(q, 'reference', n.body, { fields: { path: n.ref2 } }),
              ],
            }),
            want: 2,
          };
        },
      },
      {
        id: 'shortest',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const p = n.atom('p');
          const q = n.atom('q');
          const r = n.atom('r');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.ref),
                atom(p, 'reference', n.ref2, { fields: { path: n.ref } }),
                atom(q, 'reference', n.body, { fields: { path: n.ref2 } }),
                atom(r, 'gate', n.core, { fields: { path: n.ref } }),
              ],
            }),
            want: 1,
          };
        },
      },
      {
        id: 'unreached',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.ref)] }),
            want: undefined,
          };
        },
      },
    ],
  },
  {
    name: 'ref_read',
    family: 'evidence-reference',
    file: 'reference',
    cases: [
      ...(
        [
          ['read-whole', [{ label: 'Read', input: { file_path: 'REF' }, output: 'x' }], 'full', 1],
          [
            'read-offset',
            [{ label: 'Read', input: { file_path: 'REF', offset: 40 }, output: 'x' }],
            'partial',
            2,
          ],
          [
            'read-limit',
            [{ label: 'Read', input: { file_path: 'REF', limit: 40 }, output: 'x' }],
            'partial',
            2,
          ],
          ['read-failed', [{ label: 'Read', input: { file_path: 'REF' }, error: 'no such file' }], 'none', 3],
          ['head', [{ label: 'Bash', input: { command: 'head -n 20 REF' }, output: 'x' }], 'partial', 3],
          ['sed', [{ label: 'Bash', input: { command: "sed -n '1,40p' REF" }, output: 'x' }], 'partial', 3],
          ['cat', [{ label: 'Bash', input: { command: 'cat REF' }, output: 'x' }], 'full', 3],
          [
            'partial-then-full',
            [
              { label: 'Read', input: { file_path: 'REF', limit: 5 }, output: 'x' },
              { label: 'Read', input: { file_path: 'REF' }, output: 'x' },
            ],
            'full',
            3,
          ],
          ['dot-slash', [{ label: 'Read', input: { file_path: './REF' }, output: 'x' }], 'full', 3],
          ['other-file', [{ label: 'Read', input: { file_path: 'OTHER' }, output: 'x' }], 'none', 2],
        ] as const
      ).map(
        ([id, calls, want, tier]): Case => ({
          id,
          tier: tier as Tier,
          build: (n) => {
            const a = n.atom('a');
            const swap = (value: unknown) =>
              JSON.parse(JSON.stringify(value).replace(/OTHER/g, n.ref2).replace(/REF/g, n.ref)) as Call[];
            return {
              input: input(onTool(n, [...swap(calls), { label: n.tool, input: {} }]), {
                ruleAtoms: [a],
                atoms: [atom(a, 'rule', n.ref)],
              }),
              want,
            };
          },
        }),
      ),
      {
        id: 'runtime-references',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(
              block('Done.', [{ label: n.tool, input: {} }], [verdict(countId(n.tool))], {
                runtime: { references: [{ path: n.ref }] },
              }),
              { ruleAtoms: [a], atoms: [atom(a, 'rule', n.ref)] },
            ),
            want: 'full',
          };
        },
      },
      {
        id: 'no-reference',
        tier: 2,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.core)] }),
            want: undefined,
          };
        },
      },
    ],
  },
  {
    name: 'guard_caught',
    family: 'evidence-trace',
    file: 'trace',
    cases: [
      {
        id: 'deny-then-allow',
        tier: 2,
        build: (n) => {
          const g = n.word('g');
          return {
            input: input(onTool(n), {
              decisions: [
                { check: g, verdict: 'deny' },
                { check: g, verdict: 'allow' },
              ],
            }),
            want: true,
          };
        },
      },
      {
        id: 'deny-only',
        tier: 2,
        build: (n) => {
          const g = n.word('g');
          return { input: input(onTool(n), { decisions: [{ check: g, verdict: 'deny' }] }), want: false };
        },
      },
      {
        id: 'allow-of-another-guard',
        tier: 3,
        build: (n) => {
          return {
            input: input(onTool(n), {
              decisions: [
                { check: n.word('g'), verdict: 'block' },
                { check: n.word('h'), verdict: 'pass' },
              ],
            }),
            want: false,
          };
        },
      },
      {
        id: 'allow-before-deny',
        tier: 3,
        build: (n) => {
          const g = n.word('g');
          return {
            input: input(onTool(n), {
              decisions: [
                { check: g, verdict: 'ok' },
                { check: g, verdict: 'blocked' },
              ],
            }),
            want: false,
          };
        },
      },
      {
        id: 'runtime-guards',
        tier: 3,
        build: (n) => {
          const g = n.word('g');
          return {
            input: input(
              block('Done.', [{ label: n.tool, input: {} }], [verdict(countId(n.tool))], {
                runtime: {
                  guards: [
                    { name: g, verdict: 'deny' },
                    { name: g, verdict: 'pass' },
                  ],
                },
              }),
            ),
            want: true,
          };
        },
      },
      {
        id: 'not-an-enforcing-guard',
        tier: 4,
        build: (n) => {
          const a = n.atom('a');
          const e = n.atom('e');
          const g = n.word('g');
          return {
            input: input(onTool(n), {
              ruleAtoms: [a],
              atoms: [
                atom(a, 'rule', n.core, { enforcement: [e] }),
                atom(e, 'guard', n.hook, { fields: { name: n.word('enf') } }),
              ],
              decisions: [
                { check: g, verdict: 'deny' },
                { check: g, verdict: 'allow' },
              ],
            }),
            want: false,
          };
        },
      },
    ],
  },
  {
    name: 'tool_failed',
    family: 'evidence-trace',
    file: 'trace',
    cases: [
      ...(
        [
          ['error', { error: 'refused' }, true, 1],
          ['exit-code', { output: { exitCode: 2 } }, true, 2],
          ['returncode', { output: { returncode: 1 } }, true, 2],
          ['http-400', { output: { status: 404 } }, true, 2],
          ['http-302', { output: { statusCode: 302 } }, false, 3],
          ['is-error', { output: { isError: true } }, true, 2],
          ['bare-code', { output: { code: 1 } }, false, 3],
          ['clean', { output: { found: 1 } }, false, 1],
        ] as const
      ).map(
        ([id, result, want, tier]): Case => ({
          id,
          tier: tier as Tier,
          build: (n) => ({
            input: input(onTool(n, [{ label: n.tool, input: {}, ...result } as Call])),
            want,
          }),
        }),
      ),
      {
        id: 'failed-value-fact',
        tier: 3,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x', outcome: 'failed' }, [
            { label: n.tool, input: { email: 'x' }, output: { found: 1 } },
          ]);
          return { input: input(stored, { values }), want: true };
        },
      },
      {
        id: 'no-subject-execution',
        tier: 3,
        build: () => ({
          input: input(
            block('Done.', [], [verdict('must.0', { name: 'must' })], {
              executions: [{ command: 'python make.py', exitCode: 1, stdout: '', stderr: '' }],
            }),
          ),
          want: true,
        }),
      },
    ],
  },
  {
    name: 'tool_silent',
    family: 'evidence-trace',
    file: 'trace',
    cases: [
      {
        id: 'prints-nothing',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n, [{ label: n.tool, input: {}, output: '' }]), {
            promises: [{ tool: n.tool, prints: true }],
          }),
          want: true,
        }),
      },
      {
        id: 'prints-something',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n, [{ label: n.tool, input: {}, output: 'row 1' }]), {
            promises: [{ tool: n.tool, prints: true }],
          }),
          want: false,
        }),
      },
      {
        id: 'does-not-match',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n, [{ label: n.tool, input: {}, output: 'nothing here' }]), {
            promises: [{ tool: n.tool, matches: '^wrote \\d+ rows$' }],
          }),
          want: true,
        }),
      },
      {
        id: 'errored-call-is-not-silent',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n, [{ label: n.tool, input: {}, error: 'boom' }]), {
            promises: [{ tool: n.tool, prints: true }],
          }),
          want: false,
        }),
      },
      {
        id: 'script-execution',
        tier: 4,
        build: (n) => {
          const script = `${n.word('script')}.py`;
          return {
            input: input(
              block('Done.', [], [verdict('must.0', { name: 'must' })], {
                executions: [{ command: `python ${script} --all`, exitCode: 0, stdout: '' }],
              }),
              { promises: [{ tool: script, prints: true }] },
            ),
            want: true,
          };
        },
      },
      {
        id: 'no-promise',
        tier: 1,
        build: (n) => ({ input: input(onTool(n, [{ label: n.tool, input: {}, output: '' }])), want: false }),
      },
    ],
  },
  {
    name: 'protected_changed',
    family: 'evidence-trace',
    file: 'trace',
    cases: [
      ...(
        [
          ['changed', { changed: ['data/in.csv'] }, ['data/*.csv'], true, 2],
          ['deleted', { deleted: ['data/in.csv'] }, ['data/in.csv'], true, 2],
          ['created-only', { created: ['data/in.csv'] }, ['data/*.csv'], false, 3],
          ['other-folder', { changed: ['out/in.csv'] }, ['data/*.csv'], false, 3],
          ['deep-glob', { changed: ['data/a/b/in.csv'] }, ['data/**/*.csv'], true, 3],
          ['no-glob', { changed: ['data/in.csv'] }, [], false, 1],
        ] as const
      ).map(
        ([id, diff, globs, want, tier]): Case => ({
          id,
          tier: tier as Tier,
          build: () => ({
            input: input(
              block('Done.', [], [verdict('workspace.0', { name: 'workspace' })], {
                workspaceDiff: { created: [], changed: [], deleted: [], ...diff },
              }),
              { expect: { protected: [...globs] } },
            ),
            want,
          }),
        }),
      ),
    ],
  },
  {
    name: 'next_action',
    family: 'evidence-trace',
    file: 'trace',
    cases: [
      {
        id: 'looped',
        tier: 3,
        build: (n) => ({
          input: input(
            onTool(
              n,
              Array.from({ length: 3 }, () => ({ label: n.tool, input: { q: 'a' }, error: 'miss' })),
            ),
          ),
          want: 'looped',
        }),
      },
      {
        id: 'retried-under-max',
        tier: 3,
        build: (n) => ({
          input: input(
            onTool(
              n,
              Array.from({ length: 3 }, () => ({ label: n.tool, input: { q: 'a' }, error: 'miss' })),
            ),
            { maxRetries: 4 },
          ),
          want: 'retried_canonical',
        }),
      },
      {
        id: 'retried-other-input',
        tier: 3,
        build: (n) => ({
          input: input(
            onTool(n, [
              { label: n.tool, input: { q: 'a' }, error: 'miss' },
              { label: n.tool, input: { q: 'b' }, output: { ok: true } },
            ]),
          ),
          want: 'retried_canonical',
        }),
      },
      {
        id: 'stored-reading',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n), { reply: { next_action: 'wrong_fact' } }),
          want: 'wrong_fact',
        }),
      },
      {
        id: 'question',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n, [{ label: n.tool, input: {} }], 'Which one do you mean?')),
          want: 'asked_user',
        }),
      },
      {
        id: 'calls-after',
        tier: 2,
        build: (n) => ({
          input: input(
            onTool(
              n,
              [
                { label: n.tool, input: {} },
                { label: n.tool2, input: {} },
              ],
              'Booked.',
            ),
          ),
          want: 'continued',
        }),
      },
      {
        id: 'empty-reply',
        tier: 2,
        build: (n) => ({ input: input(onTool(n, [{ label: n.tool, input: {} }], '')), want: 'gave_up' }),
      },
    ],
  },
  {
    name: 'recurrence_homes',
    family: 'evidence-trace',
    file: 'recurrence',
    cases: [
      {
        id: 'two-homes-same-act',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n), {
            attributed: { item: 'R1', act: 'step', home: n.skill },
            history: [
              { item: 'R1', act: 'step', home: n.skill2 },
              { item: 'R1', act: 'other', home: `s${n.word('c')}` },
              { item: 'R2', act: 'step', home: `s${n.word('d')}` },
            ],
          }),
          want: 2,
        }),
      },
      {
        id: 'min-runs',
        tier: 4,
        build: (n) => ({
          input: input(onTool(n), {
            attributed: { item: 'R1', act: 'step', home: n.skill },
            history: [
              { item: 'R1', act: 'step', home: n.skill },
              { item: 'R1', act: 'step', home: n.skill2 },
            ],
            minRunsPerHome: 2,
          }),
          want: 1,
        }),
      },
      {
        id: 'no-skill-home-off',
        tier: 4,
        build: (n) => ({
          input: input(onTool(n), {
            attributed: { item: 'R1', act: 'step', home: 'none' },
            history: [{ item: 'R1', act: 'step', home: 'none' }],
            countNoSkillHome: false,
          }),
          want: 0,
        }),
      },
      { id: 'no-current', tier: 2, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'recurrence_class_homes',
    family: 'evidence-trace',
    file: 'recurrence',
    cases: [
      {
        id: 'any-act',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n), {
            attributed: { item: 'R1', act: 'step', home: n.skill },
            history: [
              { item: 'R1', act: 'other', home: n.skill2 },
              { item: 'R2', act: 'step', home: `s${n.word('d')}` },
            ],
          }),
          want: 2,
        }),
      },
      {
        id: 'own-home-only',
        tier: 2,
        build: (n) => ({
          input: input(onTool(n), { attributed: { item: 'R1', act: 'step', home: n.skill }, history: [] }),
          want: 1,
        }),
      },
    ],
  },
  ...(['reference_pass', 'reference_loads', 'forced_load_pass', 'hint_pass'] as const).map(
    (name): Name => ({
      name,
      family: 'evidence-verdict',
      file: 'recurrence',
      cases: [
        {
          id: 'stored',
          tier: 1,
          build: (n) => ({ input: input(onTool(n), { confirm: { runs: 3, [name]: 2 } }), want: 2 }),
        },
        {
          id: 'stored-zero',
          tier: 2,
          build: (n) => ({ input: input(onTool(n), { confirm: { runs: 3, [name]: 0 } }), want: 0 }),
        },
        { id: 'none-stored', tier: 1, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
      ],
    }),
  ),
  {
    name: 'tests_fail_reverted',
    family: 'evidence-verdict',
    file: 'trace',
    cases: [
      {
        id: 'true',
        tier: 1,
        build: (n) => ({ input: input(onTool(n), { testsFailReverted: true }), want: true }),
      },
      {
        id: 'false',
        tier: 1,
        build: (n) => ({ input: input(onTool(n), { testsFailReverted: false }), want: false }),
      },
      { id: 'unknown', tier: 2, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'changed_inputs_fail',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'one-true',
        tier: 2,
        build: (n) => {
          const { stored } = withFact(n, {});
          return {
            input: input(stored, {
              values: [
                { value: 1, changedInputsFail: false },
                { value: 2, changedInputsFail: true },
              ],
            }),
            want: true,
          };
        },
      },
      {
        id: 'false',
        tier: 2,
        build: (n) => {
          const { stored } = withFact(n, {});
          return { input: input(stored, { values: [{ value: 1, changedInputsFail: false }] }), want: false };
        },
      },
      {
        id: 'unknown',
        tier: 1,
        build: (n) => {
          const { stored } = withFact(n, {});
          return { input: input(stored, { values: [{ value: 1 }] }), want: undefined };
        },
      },
    ],
  },
  {
    name: 'task_impossible',
    family: 'evidence-verdict',
    file: 'trace',
    cases: [
      {
        id: 'declared',
        tier: 1,
        build: (n) => ({ input: input(onTool(n), { expect: { taskImpossible: true } }), want: true }),
      },
      {
        id: 'not-declared',
        tier: 1,
        build: (n) => ({ input: input(onTool(n), { expect: {} }), want: false }),
      },
    ],
  },
  {
    name: 'task_flagged',
    family: 'evidence-verdict',
    file: 'trace',
    cases: [
      {
        id: 'flagged',
        tier: 1,
        build: (n) => ({ input: input(onTool(n), { reply: { task_flagged: true } }), want: true }),
      },
      {
        id: 'not-flagged',
        tier: 1,
        build: (n) => ({ input: input(onTool(n), { reply: { task_flagged: false } }), want: false }),
      },
      { id: 'no-reading', tier: 2, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'downstream_need',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'declared',
        tier: 1,
        build: (n) => ({ input: input(onTool(n), { expect: { downstream: true } }), want: 'declared' }),
      },
      { id: 'none', tier: 1, build: (n) => ({ input: input(onTool(n)), want: 'none' }) },
    ],
  },
  {
    name: 'declared_format',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'demanded',
        tier: 2,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x', demanded: '^[A-Z]{3}$' });
          return { input: input(stored, { values }), want: '^[A-Z]{3}$' };
        },
      },
      {
        id: 'none',
        tier: 2,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x' });
          return { input: input(stored, { values }), want: 'none' };
        },
      },
      { id: 'no-fact', tier: 1, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'outcome',
    family: 'evidence-value',
    file: 'value',
    cases: [
      ...(
        [
          [
            'stated',
            { outcome: 'resolved_differently', rung: 'rung1', settles: 'fail' },
            'resolved_differently',
            2,
          ],
          ['settled-pass', { rung: 'rung1', settles: 'pass' }, 'accepted_as_gold', 2],
          ['rung3-fail', { rung: 'rung3', settles: 'fail' }, 'resolved_differently', 3],
          ['rung1-fail', { rung: 'rung1', settles: 'fail' }, 'failed', 2],
          ['rung2', { rung: 'rung2', settles: 'fail' }, undefined, 3],
          ['inconclusive', { rung: 'rung1', settles: 'inconclusive' }, undefined, 3],
          ['nothing-settled', { rung: 'rung4' }, undefined, 3],
        ] as const
      ).map(
        ([id, fact, want, tier]): Case => ({
          id,
          tier: tier as Tier,
          build: (n) => {
            const { stored, values } = withFact(n, { value: 'x', ...fact });
            return { input: input(stored, { values }), want };
          },
        }),
      ),
      { id: 'no-fact', tier: 1, build: (n) => ({ input: input(onTool(n)), want: undefined }) },
    ],
  },
  {
    name: 'source',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'tag',
        tier: 1,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'abc', source: 'prompt' });
          return { input: input(stored, { values, user: 'abc' }), want: 'prompt' };
        },
      },
      {
        id: 'user-verbatim',
        tier: 1,
        build: (n) => {
          const v = `${n.word('v')}@larkspur.example`;
          const { stored, values } = withFact(n, { value: v });
          return { input: input(stored, { values, user: `My email is ${v}.` }), want: 'user' };
        },
      },
      {
        id: 'user-case-only',
        tier: 2,
        build: (n) => {
          const v = `${n.word('v')}@larkspur.example`;
          const { stored, values } = withFact(n, { value: v.toUpperCase() });
          return { input: input(stored, { values, user: `My email is ${v}.` }), want: 'user' };
        },
      },
      {
        id: 'workspace-file',
        tier: 3,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v }, [
            { label: 'Read', input: { file_path: 'data/customers.csv' }, output: `name,code\nFern,${v}\n` },
          ]);
          return {
            input: input(stored, { values, user: 'Use the code from the file.' }),
            want: 'workspace_file',
          };
        },
      },
      {
        id: 'skill-file',
        tier: 3,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v }, [
            { label: 'Read', input: { file_path: n.ref }, output: `Always send ${v}.` },
          ]);
          return { input: input(stored, { values, user: 'Send the usual one.' }), want: 'skill_file' };
        },
      },
      {
        id: 'failed-read-gives-nothing',
        tier: 4,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v }, [
            { label: 'Read', input: { file_path: 'data/customers.csv' }, output: { text: v, exitCode: 1 } },
          ]);
          return { input: input(stored, { values, user: 'Use the code from the file.' }), want: 'user' };
        },
      },
      {
        id: 'tool-output',
        tier: 3,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v }, [
            { label: n.tool2, input: {}, output: { code: v } },
          ]);
          return { input: input(stored, { values, user: 'Find my code, please.' }), want: 'tool_output' };
        },
      },
      {
        id: 'agent-derived',
        tier: 4,
        build: (n) => {
          const digitsOf = String(Math.floor(n.rng() * 9e9) + 1e9);
          const { stored, values } = withFact(n, { value: `+32${digitsOf}` });
          return {
            input: input(stored, { values, user: `Call me on 0${digitsOf}.` }),
            want: 'agent_derived',
          };
        },
      },
      {
        id: 'altered',
        tier: 2,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: `${v}x` });
          return { input: input(stored, { values, user: `It is ${n.word('w')}.` }), want: 'user' };
        },
      },
      {
        id: 'no-user-turn',
        tier: 2,
        build: (n) => {
          const { stored, values } = withFact(n, { value: n.word('v') });
          return { input: input(stored, { values }), want: undefined };
        },
      },
    ],
  },
  {
    name: 'change',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'as-given-rung',
        tier: 1,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'X', change: 'unit_converted' });
          return { input: input(stored, { values, user: 'X' }), want: 'unit_converted' };
        },
      },
      {
        id: 'verbatim-spaces-folded',
        tier: 3,
        build: (n) => {
          const v = `${n.word('a')} ${n.word('b')}`;
          const { stored, values } = withFact(n, { value: v });
          return {
            input: input(stored, { values, user: `It is ${v.replace(' ', '   ')} today.` }),
            want: 'verbatim',
          };
        },
      },
      {
        id: 'case-only',
        tier: 2,
        build: (n) => {
          const v = n.word('a');
          const { stored, values } = withFact(n, { value: v.toUpperCase() });
          return { input: input(stored, { values, user: `It is ${v}.` }), want: 'case_only' };
        },
      },
      {
        id: 'altered',
        tier: 2,
        build: (n) => {
          const { stored, values } = withFact(n, { value: n.word('a') });
          return { input: input(stored, { values, user: `It is ${n.word('b')}.` }), want: 'altered' };
        },
      },
      {
        id: 'agent-derived-none',
        tier: 4,
        build: (n) => {
          const digitsOf = String(Math.floor(n.rng() * 9e9) + 1e9);
          const { stored, values } = withFact(n, { value: `+32${digitsOf}` });
          return { input: input(stored, { values, user: `Call me on 0${digitsOf}.` }), want: undefined };
        },
      },
    ],
  },
  {
    name: 'contract',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'rung-record',
        tier: 1,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x', contract: 'downstream' });
          return { input: input(stored, { values }), want: 'downstream' };
        },
      },
      {
        id: 'schema-enum',
        tier: 2,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x' });
          return {
            input: input(stored, {
              values,
              toolSchemas: {
                [n.tool]: { type: 'object', properties: { email: { type: 'string', enum: ['a', 'b'] } } },
              },
            }),
            want: 'tool',
          };
        },
      },
      {
        id: 'schema-pattern',
        tier: 2,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x' });
          return {
            input: input(stored, {
              values,
              toolSchemas: {
                [n.tool]: { type: 'object', properties: { email: { type: 'string', pattern: '^a' } } },
              },
            }),
            want: 'tool',
          };
        },
      },
      {
        id: 'stated-format',
        tier: 3,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x' });
          return {
            input: input(stored, {
              values,
              stated: [{ tool: n.tool, field: 'email', where: 'skill', format: '[a-z]+' }],
            }),
            want: 'skill',
          };
        },
      },
      {
        id: 'stated-rule-without-format',
        tier: 3,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'x' });
          return {
            input: input(stored, {
              values,
              stated: [{ tool: n.tool, field: 'email', where: 'skill', asks: ['town'] }],
            }),
            want: 'none',
          };
        },
      },
      {
        id: 'rule-verdict-link',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n), { links: [{ verdict: countId(n.tool), home: 'core', act: 'step' }] }),
          want: 'prompt',
        }),
      },
      {
        id: 'rule-verdict-atom',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.script)] }),
            want: 'skill',
          };
        },
      },
      {
        id: 'rule-verdict-guard',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.hook)] }),
            want: 'none',
          };
        },
      },
    ],
  },
  {
    name: 'contract_broken',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'rung-record',
        tier: 1,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'a', contractBroken: true });
          return { input: input(stored, { values }), want: true };
        },
      },
      ...(
        [
          ['a', false],
          ['c', true],
        ] as const
      ).map(
        ([value, want]): Case => ({
          id: `enum-${want ? 'outside' : 'inside'}`,
          tier: 2,
          build: (n) => {
            const { stored, values } = withFact(n, { value });
            return {
              input: input(stored, {
                values,
                toolSchemas: {
                  [n.tool]: { type: 'object', properties: { email: { type: 'string', enum: ['a', 'b'] } } },
                },
              }),
              want,
            };
          },
        }),
      ),
      ...(
        [
          ['ab-12', false],
          ['ab12', true],
        ] as const
      ).map(
        ([value, want]): Case => ({
          id: `stated-format-${want ? 'broken' : 'held'}`,
          tier: 3,
          build: (n) => {
            const { stored, values } = withFact(n, { value });
            return {
              input: input(stored, {
                values,
                stated: [{ tool: n.tool, field: 'email', where: 'skill', format: '[a-z]+-\\d+' }],
              }),
              want,
            };
          },
        }),
      ),
      {
        id: 'stated-format-whole-value',
        tier: 4,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'xx ab-12 yy' });
          return {
            input: input(stored, {
              values,
              stated: [{ tool: n.tool, field: 'email', where: 'skill', format: '[a-z]+-\\d+' }],
            }),
            want: true,
          };
        },
      },
      {
        id: 'nothing-stated',
        tier: 2,
        build: (n) => {
          const { stored, values } = withFact(n, { value: 'a' });
          return { input: input(stored, { values }), want: false };
        },
      },
      {
        id: 'failing-rule-verdict',
        tier: 3,
        build: (n) => {
          const a = n.atom('a');
          return {
            input: input(onTool(n), { ruleAtoms: [a], atoms: [atom(a, 'rule', n.core)] }),
            want: true,
          };
        },
      },
      {
        id: 'rule-verdict-without-rule',
        tier: 2,
        build: (n) => ({ input: input(onTool(n)), want: false }),
      },
    ],
  },
  {
    name: 'tool_output_wrong',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'failed-from-tool',
        tier: 3,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v, outcome: 'failed' }, [
            { label: n.tool2, input: {}, output: { code: v } },
          ]);
          return { input: input(stored, { values, user: 'Find my code.' }), want: true };
        },
      },
      {
        id: 'differs-from-gold',
        tier: 3,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v, gold: `${v}9` }, [
            { label: n.tool2, input: {}, output: { code: v } },
          ]);
          return { input: input(stored, { values, user: 'Find my code.' }), want: true };
        },
      },
      {
        id: 'from-user',
        tier: 3,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v, outcome: 'failed' }, [
            { label: n.tool2, input: {}, output: { code: v } },
          ]);
          return { input: input(stored, { values, user: `My code is ${v}.` }), want: false };
        },
      },
      {
        id: 'equal-to-gold',
        tier: 2,
        build: (n) => {
          const v = n.word('v');
          const { stored, values } = withFact(n, { value: v, gold: v }, [
            { label: n.tool2, input: {}, output: { code: v } },
          ]);
          return { input: input(stored, { values, user: 'Find my code.' }), want: false };
        },
      },
    ],
  },
  {
    name: 'stricter_rule_obeyed',
    family: 'evidence-value',
    file: 'value',
    cases: [
      {
        id: 'asked-extra-part',
        tier: 3,
        build: (n) => ({
          input: input(block('Which town do you live in?', [], [verdict(countId(n.tool))]), {
            stated: [{ tool: n.tool, where: 'skill', asks: ['street', 'town'], toolNeeds: ['street'] }],
            reply: { asked_for: ['town'] },
          }),
          want: true,
        }),
      },
      {
        id: 'asked-needed-part',
        tier: 3,
        build: (n) => ({
          input: input(block('Which street?', [], [verdict(countId(n.tool))]), {
            stated: [{ tool: n.tool, where: 'skill', asks: ['street', 'town'], toolNeeds: ['street'] }],
            reply: { asked_for: ['street'] },
          }),
          want: false,
        }),
      },
      {
        id: 'tool-called',
        tier: 3,
        build: (n) => ({
          input: input(onTool(n), {
            stated: [{ tool: n.tool, where: 'skill', asks: ['street', 'town'], toolNeeds: ['street'] }],
            reply: { asked_for: ['town'] },
          }),
          want: false,
        }),
      },
      {
        id: 'value-settled-fail',
        tier: 4,
        build: (n) => ({
          input: input(block('Which town do you live in?', [], [verdict(countId(n.tool))]), {
            stated: [{ tool: n.tool, where: 'skill', asks: ['street', 'town'], toolNeeds: ['street'] }],
            reply: { asked_for: ['town'] },
            values: [{ tool: n.tool, value: 'x', settles: 'fail' }],
          }),
          want: false,
        }),
      },
      {
        id: 'needs-unknown',
        tier: 3,
        build: (n) => ({
          input: input(block('Which town do you live in?', [], [verdict(countId(n.tool))]), {
            stated: [{ tool: n.tool, where: 'skill', asks: ['street', 'town'] }],
            reply: { asked_for: ['town'] },
          }),
          want: false,
        }),
      },
    ],
  },
];

const COMPONENT = 'packages/core/src/evidence';

type Evidence = { computeEvidence(input: unknown, names?: readonly string[]): Record<string, unknown> };

function check(name: string, build: Case['build'], id: string) {
  return async ({ seed, product }: { seed: number; product: BlocksProduct }) => {
    const evidence = need<Evidence>(product.core, 'core', 'evidence');
    if (typeof evidence.computeEvidence !== 'function')
      return fail('the core package exports evidence, with no computeEvidence');
    const { input: given, want } = build(names(seed, id));
    let got: Record<string, unknown>;
    try {
      got = evidence.computeEvidence(structuredClone(given), [name]);
    } catch (error) {
      return fail(
        `computeEvidence threw on ${name}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`,
      );
    }
    const has = Object.hasOwn(got, name);
    if (want === undefined)
      return has
        ? fail(`${name} should be unknown, so absent from the answer; it is ${canonical(got[name])}`)
        : PASS;
    if (!has) return fail(`${name} should be ${canonical(want)}; the answer leaves it out`);
    return canonical(got[name]) === canonical(want)
      ? PASS
      : fail(`${name} should be ${canonical(want)}; it is ${canonical(got[name])}`);
  };
}

/** The evidence items, one cause per name. */
export function evidenceItems(): BankItem[] {
  return NAMES.flatMap((entry) =>
    entry.cases.map((each) => {
      const id = `evidence/${entry.name}/${each.id}`;
      return {
        id,
        family: entry.family,
        tier: each.tier,
        level: 5,
        component: `${COMPONENT}/${entry.file}.ts`,
        title: `the evidence name ${entry.name} on ${each.id.replace(/-/g, ' ')} takes the value its documented rule gives`,
        cause: `The evidence name ${entry.name} follows its documented rules.`,
        check: check(entry.name, each.build, id),
      };
    }),
  );
}

/** The doc heading of each name's rules, for the contract map. */
export const EVIDENCE_CONTRACTS: Record<string, string> = Object.fromEntries(
  NAMES.map((entry) => [
    `The evidence name ${entry.name} follows its documented rules.`,
    `docs/reference/block-contracts.md#${
      ['reference_pass', 'reference_loads', 'forced_load_pass', 'hint_pass'].includes(entry.name)
        ? 'Evidence: confirm counts'
        : `Evidence: ${entry.name}`
    }`,
  ]),
);

export const EVIDENCE_NAMES = (): string[] => NAMES.map((entry) => entry.name);
