import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { FIXTURE, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { actOfAtom } from '../../src/ladders/estate/bank/task-act';
import { checkAsk, checkTrace, envOf } from '../../src/ladders/estate/bank/task-check';
import { observeOnFake } from '../../src/ladders/estate/bank/task-trace';

it('uses actual fake traces for an unlisted helper verb, a wrong act, and the retained guard recording gap', async () => {
  const map = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
  if (!map.ok) throw new Error('fixture map does not load');
  const guard = map.map.atoms.find(
    (atom) => atom.id === 'guard.settings.userpromptsubmit-guard-stop-word-sh',
  );
  const helper = map.map.atoms.find((atom) => atom.id === 'subagent.inbox-triager.helper-inbox-triager');
  const report = map.map.atoms.find((atom) => atom.id === 'stage.steps.stage-plan-restate-the-ask-and');
  const clarify = map.map.atoms.find(
    (atom) => atom.id === 'instruction.standing.never-invent-order-numbers-prices-or',
  );
  if (!guard || !helper || !report || !clarify) throw new Error('fixture acts missing');
  const cases = [
    { id: 'unlisted', ask: 'Delegate `inbox-triager`.', unit: helper, pass: true },
    { id: 'wrong', ask: 'Please report the inventory.', unit: helper, pass: false },
    { id: 'guard-recording-gap', ask: 'stop', unit: guard, pass: false },
    { id: 'unlisted-reply', ask: 'Berthify the vessel.', unit: report, pass: true },
    { id: 'wrong-reply', ask: 'Please report the inventory.', unit: clarify, pass: false },
  ];
  const env = envOf(
    map.map.atoms,
    {
      situations: cases.map((entry) => ({
        id: entry.id,
        atoms: [entry.unit.id],
        phrases: [{ text: entry.ask, approved: true }],
      })),
    },
    { sessions: [] },
  );
  const scratch = await mkdtemp(join(tmpdir(), 'astra-askwords-fake-'));
  try {
    const specs: SuiteSpec[] = [];
    for (const entry of cases) {
      const unit = entry.unit;
      const path = join(scratch, `${entry.id}.yaml`);
      const id = `astra-askwords.${entry.id}`;
      const spec = {
        id,
        version: '1',
        kind: 'task',
        title: 'Fictional guard trace',
        lang: 'EN',
        tier: 'generated',
        target: { adapter: 'claude-code' },
        blocks: [
          {
            id: 'ask',
            when: { user: entry.ask },
            expect:
              unit.kind === 'guard'
                ? { guards: [{ name: 'stop-word.sh', verdict: 'nudge', count: { min: 1 } }] }
                : unit.kind === 'subagent'
                  ? { subagents: [{ name: 'inbox-triager', count: { min: 1 } }] }
                  : {},
          },
        ],
        metadata: {
          estate: {
            atoms: [unit.id],
            link: { span: unit.id, fp: unit.provenance.hash, relation: 'exercises', createdBy: 'generator' },
            act: actOfAtom(unit, map.map.atoms),
            from: { bank: entry.id, phrase: 0 },
          },
        },
      };
      await writeFile(path, stringify(spec));
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) throw new Error(JSON.stringify(loaded));
      specs.push({
        path,
        id,
        atoms: [unit.id],
        testType: 'guard_positive',
        mode: 'live',
        complete: true,
        spec: loaded.spec,
      });
    }
    const traces = await observeOnFake(specs.map((spec) => spec.path));
    for (const [index, spec] of specs.entries()) {
      const verdict = checkAsk(spec, env);
      expect(verdict.reasons, spec.id).toEqual([]);
      expect(verdict.trace).toBeDefined();
      expect(traces.get(spec.id), spec.id).toBeDefined();
      if (cases[index]?.id === 'unlisted-reply' || cases[index]?.id === 'wrong-reply') {
        const trace = traces.get(spec.id);
        expect(trace?.replyAct?.id).toBe('report');
        const segment = trace?.segments[trace?.replyAct?.evidence.index ?? -1];
        expect(segment?.type).toBe('text');
      }
      if (cases[index]?.id === 'guard-recording-gap') {
        expect(traces.get(spec.id)?.runtime?.guards).toContainEqual(
          expect.objectContaining({ name: 'stop-word.sh', verdict: 'allow' }),
        );
      }
      if (verdict.trace)
        expect(
          checkTrace(verdict.trace, traces.get(spec.id)) === undefined,
          JSON.stringify({ id: spec.id, runtime: traces.get(spec.id)?.runtime, need: verdict.trace }),
        ).toBe(cases[index]?.pass);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 300_000);
