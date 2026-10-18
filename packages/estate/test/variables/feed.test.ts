import { createHash } from 'node:crypto';
import { verifyVariableQuotes } from '@agent-nexus/driftbench-generate';
import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { cut, nextLedger } from '../../src/pointer';
import {
  estateToVariables,
  ledgerResolver,
  provenanceResolver,
  renderVariableStore,
} from '../../src/variables';
import { atom, HALL, hallFolder, mapOf } from './support';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const KEEPER = 'Name the keeper of every boat before it leaves the hall.';
const resolver = () => provenanceResolver(new Map(Object.entries(HALL)));
const valuesOf = (store: ReturnType<typeof estateToVariables>['store']) =>
  store.variables.flatMap((v) => v.values);

/** The id the pointer ledger gives the unit that holds `quote` in CLAUDE.md. */
function ledgerIdOf(quote: string): string | undefined {
  const { ledger } = nextLedger(
    [{ path: 'CLAUDE.md', cut: cut(HALL['CLAUDE.md'] as string) }],
    undefined,
    'estate',
  );
  return ledger.entries.find((entry) => entry.path === 'CLAUDE.md' && entry.quote.includes(quote))?.id;
}

describe('the estate feed refuses a value that has no quote', () => {
  it('refuses an atom whose quote is empty or blank, and says why', () => {
    const result = estateToVariables(
      mapOf([
        atom({ quote: KEEPER }),
        atom({ quote: '   ', title: 'Blank', span: { startLine: 3, endLine: 3 } }),
      ]),
      resolver(),
    );
    expect(result.refused).toEqual([
      {
        atom: expect.stringContaining('instruction.hall.atom-'),
        variable: 'atoms.instruction',
        reason: 'the quote is empty',
      },
    ]);
    expect(valuesOf(result.store).map((value) => value.title)).not.toContain('Blank');
    expect(valuesOf(result.store)).toHaveLength(1);
  });

  it('refuses a prose atom whose quote no ledger unit holds', () => {
    const result = estateToVariables(
      mapOf([atom({ quote: 'Feed the gulls at noon.', span: { startLine: 3, endLine: 3 } })]),
      resolver(),
    );
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      'no ledger unit of CLAUDE.md holds the quote',
    ]);
    expect(result.store.variables).toEqual([]);
  });

  it('refuses a prose quote longer than the store takes (1,000 characters)', () => {
    const long = `${'Count the boats twice and write the number down. '.repeat(30)}`.trim();
    const files = { 'LONG.md': `# Long\n\n${long}\n` };
    const result = estateToVariables(
      mapOf([atom({ file: 'LONG.md', quote: long, files })]),
      provenanceResolver(new Map(Object.entries(files))),
    );
    expect(result.refused.map((entry) => entry.reason)).toEqual(['the quote is longer than 1000 characters']);
  });
});

describe('an atom read from a JSON or YAML file stands on a pointer, not on a ledger id', () => {
  it('gives a permission the pointer of the item and the hash of its value', () => {
    const result = estateToVariables(
      mapOf([atom({ kind: 'tool', file: '.claude/settings.json', quote: '"Bash(rm *)"' })]),
      resolver(),
    );
    expect(result.refused).toEqual([]);
    expect(valuesOf(result.store)[0]?.provenance).toEqual([
      {
        kind: 'structure',
        path: '.claude/settings.json',
        pointer: '/permissions/deny/0',
        hash: sha('"Bash(rm *)"'),
      },
    ]);
  });

  it('gives a key and its value the pointer of the key, and an object on one line the pointer of the object', () => {
    const key = estateToVariables(
      mapOf([atom({ kind: 'setting', file: '.claude/settings.json', quote: '"model": "boat-1"' })]),
      resolver(),
    );
    expect(valuesOf(key.store)[0]?.provenance).toMatchObject([{ pointer: '/model', hash: sha('"boat-1"') }]);
    const hook = estateToVariables(
      mapOf([
        atom({
          kind: 'guard',
          file: '.claude/settings.json',
          quote: '{ "type": "command", "command": "sh .claude/guards/lock.sh", "timeout": 5 }',
        }),
      ]),
      resolver(),
    );
    expect(valuesOf(hook.store)[0]?.provenance).toMatchObject([
      {
        kind: 'structure',
        pointer: '/hooks/PreToolUse/0/hooks/0',
        hash: sha('{"command":"sh .claude/guards/lock.sh","timeout":5,"type":"command"}'),
      },
    ]);
  });

  it('reads a YAML file the same way', () => {
    const result = estateToVariables(
      mapOf([atom({ kind: 'stage', file: '.claude/steps.yaml', quote: '- verify' })]),
      resolver(),
    );
    expect(valuesOf(result.store)[0]?.provenance).toEqual([
      { kind: 'structure', path: '.claude/steps.yaml', pointer: '/steps/2', hash: sha('"verify"') },
    ]);
  });
});

describe('an atom read from a script stands on a line range and the hash of its lines', () => {
  it('gives the guard the lines it quotes and their hash', () => {
    const quote = '# Lock the hall when the last boat is out.';
    const result = estateToVariables(
      mapOf([atom({ kind: 'guard', file: '.claude/guards/lock.sh', quote })]),
      resolver(),
    );
    expect(result.refused).toEqual([]);
    expect(valuesOf(result.store)[0]?.provenance).toEqual([
      { kind: 'structure', path: '.claude/guards/lock.sh', lines: { start: 2, end: 2 }, hash: sha(quote) },
    ]);
  });

  it('hashes every line of a range', () => {
    const quote = 'if [ "$LAST_BOAT" = "out" ]; then\n  echo locked\nfi';
    const result = estateToVariables(
      mapOf([atom({ kind: 'guard', file: '.claude/guards/lock.sh', quote })]),
      resolver(),
    );
    expect(valuesOf(result.store)[0]?.provenance).toEqual([
      { kind: 'structure', path: '.claude/guards/lock.sh', lines: { start: 3, end: 5 }, hash: sha(quote) },
    ]);
  });
});

describe('an atom is refused only when its place does not resolve', () => {
  const settings = '.claude/settings.json';
  const reasonOf = (a: ReturnType<typeof atom>, texts: Record<string, string> = HALL) =>
    estateToVariables(mapOf([a]), provenanceResolver(new Map(Object.entries(texts)))).refused.map(
      (r) => r.reason,
    );

  it('refuses lines past the end of the file', () => {
    expect(
      reasonOf(atom({ kind: 'tool', file: settings, quote: '"Read"', span: { startLine: 90, endLine: 90 } })),
    ).toEqual([`lines 90 to 90 are not in ${settings}`]);
  });

  it('refuses a quote that is not at the lines the atom names', () => {
    expect(
      reasonOf(
        atom({ kind: 'tool', file: settings, quote: '"Bash(rm *)"', span: { startLine: 2, endLine: 2 } }),
      ),
    ).toEqual([`the quote is not at lines 2 to 2 of ${settings}`]);
  });

  it('refuses a JSON file that does not parse, and a file the feed was not given', () => {
    const broken = { ...HALL, [settings]: '{"model": "boat-1",\n  "deny": [' };
    expect(
      reasonOf(atom({ kind: 'setting', file: settings, quote: '"model": "boat-1"', files: broken }), broken),
    ).toEqual([`${settings} is not valid JSON or YAML: no pointer`]);
    expect(
      reasonOf(atom({ kind: 'tool', file: 'other.json', quote: '"x"', span: { startLine: 1, endLine: 1 } })),
    ).toEqual(['other.json was not read: no pointer or lines to give']);
  });

  it('refuses a script quote that is not at its lines, and an empty quote of a script', () => {
    expect(
      reasonOf(
        atom({
          kind: 'guard',
          file: '.claude/guards/lock.sh',
          quote: 'echo unlocked',
          span: { startLine: 4, endLine: 4 },
        }),
      ),
    ).toEqual(['the quote is not at lines 4 to 4 of .claude/guards/lock.sh']);
    expect(
      reasonOf(
        atom({
          kind: 'guard',
          file: '.claude/guards/lock.sh',
          quote: ' ',
          span: { startLine: 2, endLine: 2 },
        }),
      ),
    ).toEqual(['the quote is empty']);
  });
});

describe('the estate feed keeps where each prose value comes from', () => {
  it('gives each value the file, the exact quote and the ledger id of the unit that holds it', () => {
    const result = estateToVariables(mapOf([atom({ quote: KEEPER })]), resolver());
    const [variable] = result.store.variables;
    expect(variable?.id).toBe('atoms.instruction');
    expect(variable?.values[0]?.provenance).toEqual([
      { kind: 'quote', path: 'CLAUDE.md', quote: KEEPER, ledger: ledgerIdOf(KEEPER) },
    ]);
    expect(ledgerIdOf(KEEPER)).toMatch(/^[a-z2-7]{10}$/);
  });

  it('uses the id of a committed ledger when one is given, not a fresh one', () => {
    const { ledger } = nextLedger(
      [{ path: 'CLAUDE.md', cut: cut(HALL['CLAUDE.md'] as string) }],
      undefined,
      'estate',
    );
    const entry = ledger.entries.find((e) => e.quote.includes(KEEPER));
    if (!entry) throw new Error('no entry');
    entry.id = 'aaaaaaaaaa';
    const result = estateToVariables(
      mapOf([atom({ quote: KEEPER })]),
      provenanceResolver(new Map(Object.entries(HALL)), { ledger }),
    );
    expect(result.store.variables[0]?.values[0]?.provenance?.[0]).toMatchObject({ ledger: 'aaaaaaaaaa' });
  });

  it('gives no id from a committed ledger that no longer matches the text: the unit changed since it was written', () => {
    const { ledger } = nextLedger(
      [{ path: 'CLAUDE.md', cut: cut(HALL['CLAUDE.md'] as string) }],
      undefined,
      'estate',
    );
    for (const entry of ledger.entries) entry.fp = 'stale';
    const result = estateToVariables(
      mapOf([atom({ quote: KEEPER })]),
      provenanceResolver(new Map(Object.entries(HALL)), { ledger }),
    );
    expect(result.refused.map((entry) => entry.reason)).toEqual([
      'no ledger unit of CLAUDE.md holds the quote',
    ]);
  });

  it('keeps ledgerResolver as the prose half: the same id for the same quote', () => {
    const found = ledgerResolver(new Map(Object.entries(HALL)))('CLAUDE.md', KEEPER);
    expect(found).toEqual({ ok: true, id: ledgerIdOf(KEEPER) });
  });
});

describe('the store the feed makes', () => {
  const MAP = () =>
    mapOf([
      atom({ quote: KEEPER, approved: true, fields: { polarity: 'obligation' } }),
      atom({
        quote: 'Never hand out a key without a signature.',
        approved: false,
        fields: { polarity: 'prohibition' },
      }),
      atom({ quote: 'Lock the hall when the last boat is out.', role: 'detail' }),
      atom({ kind: 'tool', file: '.claude/settings.json', quote: '"Bash(rm *)"' }),
      atom({
        kind: 'guard',
        file: '.claude/guards/lock.sh',
        quote: '# Lock the hall when the last boat is out.',
      }),
    ]);

  it('carries the flags of the atom: approval, who proposed it, the role, the rule polarity', () => {
    const variables = estateToVariables(MAP(), resolver()).store.variables;
    const axis = variables.find((v) => v.id === 'atoms.instruction');
    const detail = variables.find((v) => v.id === 'details.instruction');
    expect(axis).toMatchObject({ id: 'atoms.instruction', kind: 'behaviour', role: 'axis', approved: false });
    expect(axis?.values.map((v) => [v.approved, v.produced_by, v.polarity])).toEqual([
      [true, 'model', 'must'],
      [false, 'model', 'must_not'],
    ]);
    expect(detail).toMatchObject({ id: 'details.instruction', kind: 'data', role: 'detail' });
  });

  it('keeps only approved atoms when asked, and every atom with its own flag otherwise', () => {
    const map = mapOf([
      atom({ quote: KEEPER, approved: true }),
      atom({ quote: 'Never hand out a key without a signature.', approved: false }),
    ]);
    expect(valuesOf(estateToVariables(map, resolver()).store).map((v) => v.approved)).toEqual([true, false]);
    expect(
      valuesOf(estateToVariables(map, resolver(), { approvedOnly: true }).store).map((v) => v.approved),
    ).toEqual([true]);
  });

  it('validates, and every provenance of every kind resolves in the files', async () => {
    const root = await hallFolder();
    const result = estateToVariables(MAP(), resolver());
    expect(result.refused).toEqual([]);
    const loaded = validateVariableStore(result.store);
    expect(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.errors)).toBe(true);
    expect(await verifyVariableQuotes(result.store, root)).toEqual([]);
  });

  it('is found out when a file changed after the store was written', async () => {
    const root = await hallFolder({
      ...HALL,
      '.claude/settings.json': (HALL['.claude/settings.json'] as string).replace('rm *', 'rm -rf *'),
    });
    const issues = await verifyVariableQuotes(estateToVariables(MAP(), resolver()).store, root);
    expect(issues.map((issue) => issue.code)).toEqual(['VARIABLES_HASH_MISMATCH']);
  });

  it('renders the same bytes for the same estate', () => {
    const map = MAP();
    const first = renderVariableStore(estateToVariables(map, resolver()).store);
    expect(renderVariableStore(estateToVariables(map, resolver()).store)).toBe(first);
    expect(first.startsWith('# driftbench variable store')).toBe(true);
  });
});
