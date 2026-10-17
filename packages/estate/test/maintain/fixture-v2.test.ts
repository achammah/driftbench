import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  diffEstateMaps,
  diffGuardStates,
  type EstateDiff,
  estateImpact,
  estateRecordingPort,
  loadEstateMap,
  loadEstateRecording,
  loadEstateTests,
  loadGuardState,
  parseEstateDiff,
  scanEstate,
} from '../../src/index';
import type { EstateMap } from '../../src/schema';
import { FIXTURE, NOW } from '../support';

const V2 = fileURLToPath(new URL('../../../../examples/estates/fixture-v2/', import.meta.url));
const OLD_PATH = 'examples/estates/fixture/approved.yaml';
const NEW_PATH = 'examples/estates/fixture-v2/map.yaml';

const R2 = 'instruction.standing.never-send-a-supplier-email-without';
const R7 = 'instruction.standing.tell-the-user-about-a-late';
const ROUTE = 'route.standing.an-ask-to-plan-the-delivery';
const R12 = 'instruction.standing.keep-an-unconfirmed-draft-unsent';
const R18 = 'instruction.standing.name-the-finance-lead-on-a';
const R19 = 'instruction.standing.keep-a-credit-note-as-a';
const LEDGER = 'guard.settings.posttooluse-bash-guard-ledger-guard-py';

async function map(path: string): Promise<EstateMap> {
  const loaded = await loadEstateMap(path);
  if (!loaded.ok) throw new Error(`${path}: ${loaded.errors.map((error) => error.message).join('; ')}`);
  return loaded.map;
}

async function fresh(): Promise<EstateDiff> {
  const before = await map(join(FIXTURE, 'approved.yaml'));
  const after = await map(join(V2, 'map.yaml'));
  const oldState = await loadGuardState(join(V2, 'maintain', 'guard-state.v1.yaml'), before, true);
  const newState = await loadGuardState(join(V2, 'guard-state.yaml'), after, true);
  if (!oldState.ok || !newState.ok) throw new Error('the guard states do not fit their maps');
  return diffEstateMaps(before, after, {
    oldPath: OLD_PATH,
    newPath: NEW_PATH,
    guards: diffGuardStates(oldState.state, newState.state),
  });
}

describe('the fixture-v2 estate', () => {
  it('has a committed map equal to a fresh scan with its recorded answers', async () => {
    const recording = await loadEstateRecording(join(V2, 'answers.yaml'));
    if (!recording.ok) throw new Error(recording.message);
    const scanned = await scanEstate({
      root: V2,
      reader: new ClaudeCodeReader(),
      port: estateRecordingPort(recording.recording),
      now: NOW,
    });
    const committed = await map(join(V2, 'map.yaml'));
    expect(scanned.refusals).toEqual([]);
    expect(scanned.map.hash).toBe(committed.hash);
    expect(scanned.map.atoms.map((atom) => atom.id)).toEqual(committed.atoms.map((atom) => atom.id));
    expect(scanned.map.edges).toEqual(committed.edges);
  });

  it('diffs against the first version with every planted case and nothing else', async () => {
    const diff = await fresh();
    expect(diff.atoms.changed.map((entry) => [entry.id, entry.change])).toEqual([
      [ROUTE, 'semantic'],
      [R2, 'whitespace'],
      [R7, 'semantic'],
    ]);
    expect(diff.atoms.removed.map((entry) => entry.id)).toEqual([R12]);
    expect(diff.atoms.added.map((entry) => entry.id)).toEqual([R18, R19]);
    expect(diff.edges.added).toEqual([{ from: R19, to: R18, kind: 'cites' }]);
    expect(diff.edges.removed).toEqual([{ from: R12, to: R2, kind: 'cites' }]);
    expect(diff.guards?.filter((entry) => entry.move !== 'unchanged')).toEqual([
      {
        guard: LEDGER,
        from: 'warn',
        to: 'enforce',
        move: 'promoted',
        evidence: {
          log: 'logs/ledger-guard.decisions.jsonl',
          decisions: 47,
          wrong: 0,
          note: 'Four weeks of warnings; every flagged delete under ledger/ was a real one.',
        },
      },
    ]);
    expect(diff.guards).toHaveLength(6);
    expect(diff.atoms.restated.map((entry) => [entry.id, entry.fields])).toEqual([
      ['invariant.standing.the-standing-instructions-stay-under-40000', ['fields']],
    ]);
    expect(diff.summary).toEqual({
      added: 2,
      removed: 1,
      whitespace: 1,
      semantic: 2,
      moved: 24,
      restated: 1,
      unchanged: 97,
      edgesAdded: 1,
      edgesRemoved: 1,
    });
  });

  it('has a committed diff equal to a fresh one', async () => {
    const committed = parseEstateDiff(await readFile(join(V2, 'maintain', 'diff.json'), 'utf8'));
    if (!committed.ok) throw new Error(committed.message);
    expect(committed.diff).toEqual(await fresh());
  });

  it('has a committed impact equal to a fresh one, with each list as planted', async () => {
    const diff = await fresh();
    const tests = await loadEstateTests(join(V2, 'tests'));
    if (!tests.ok) throw new Error(tests.errors.join('\n'));
    const report = estateImpact(diff, tests.tests, { others: tests.others });
    const committed = JSON.parse(await readFile(join(V2, 'maintain', 'impact.json'), 'utf8'));
    expect(report).toEqual(committed);

    expect(report.regenerate.map((entry) => [entry.test, entry.atoms.map((item) => item.why)])).toEqual([
      ['northwind-draft-pair', ['removed']],
      ['northwind-late-shipment', ['semantic']],
      ['northwind-ledger-archive', ['guard_state']],
      ['northwind-route-planner', ['semantic']],
    ]);
    expect(report.reapprove.map((entry) => [entry.atom, entry.tests])).toEqual([
      [ROUTE, ['northwind-route-planner']],
      [R7, ['northwind-late-shipment']],
    ]);
    expect(report.retire).toEqual([
      {
        test: 'northwind-unsent-draft',
        file: 'unsent-draft.yaml',
        atoms: [R12],
        reason: `atom ${R12} removed`,
        state: 'to_write',
      },
    ]);
    expect(report.new.map((entry) => entry.atom)).toEqual([R18, R19]);
    expect(report.guards.map((entry) => [entry.guard, entry.move, entry.tests, entry.need])).toEqual([
      [LEDGER, 'promoted', ['northwind-ledger-archive'], null],
    ]);
    // northwind-supplier-yes names only the respaced R2: untouched.
    expect(report.unaffected).toEqual({ moved: 24, tests: 3 });
    expect(report.needsPerson).toHaveLength(4);
  });
});
