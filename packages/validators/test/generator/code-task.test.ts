import { generateSuite } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { BANK_LEVELS, bankItems, type SeedData } from '../../src/ladders/generator/bank';
import { faultFamily } from '../../src/ladders/generator/faults';
import { createFollower, type Mutation } from '../../src/ladders/generator/follower';
import { hiddenSpec } from '../../src/ladders/generator/hidden';
import { generateFrom, runAll } from '../../src/ladders/generator/measure';
import { renderMap } from '../../src/ladders/generator/render';

describe('readable export task family', () => {
  it('plants physical file changes and does not resurrect deleted input on later turns', async () => {
    expect(bankItems()).toHaveLength(2036);
    expect(BANK_LEVELS).toHaveLength(22);
    const hidden = hiddenSpec(1);
    const world = {
      workspace: { files: { 'input.json': JSON.stringify({ records: [{ agent: 'task-input-value' }] }) } },
    };
    const play = async (mutation: Mutation = {}) => {
      const state = createFollower(hidden, mutation)();
      await state.respond([{ role: 'user', content: `Save the record as ${hidden.saveFile}.` }], world);
      return state;
    };
    const reference = await play();
    expect(JSON.parse(reference.files()[hidden.saveFile] ?? '')).toEqual({
      agent: 'task-input-value',
      saved: true,
    });
    for (const fault of faultFamily(hidden).filter(
      (fault) => fault.family === 'code' && fault.where === 'any' && fault.rate === 1,
    )) {
      const state = await play(fault.mutation);
      if (fault.class !== 'C.says-nothing') expect(state.files(), fault.class).not.toEqual(reference.files());
      if (fault.class === 'C.deletes-input') {
        expect(state.files()).not.toHaveProperty('input.json');
        await state.respond([{ role: 'user', content: 'Thank you.' }], world);
        expect(state.files()).not.toHaveProperty('input.json');
      }
      if (fault.class === 'C.no-artifact') expect(state.files()).not.toHaveProperty(hidden.saveFile);
      if (fault.class === 'C.twice')
        expect(state.files()[`${hidden.saveFile}.copy`]).toBe(reference.files()[hidden.saveFile]);
      if (fault.class === 'C.overwrite-input') {
        expect(state.files()).not.toHaveProperty(hidden.saveFile);
        expect(state.files()['input.json']).not.toBe(world.workspace.files['input.json']);
      }
    }
  });
  it('passes real artifact checks, kills all code faults, and rejects omitted file assertions', async () => {
    const hidden = hiddenSpec(1);
    const generated = await generateFrom(
      hidden,
      renderMap(hidden),
      1,
      {
        generate: (prepared, options) => generateSuite(prepared, { ...options, max: 1 }),
      },
      { once: true },
    );
    expect(generated.refused).toBeUndefined();
    const tasks = generated.complete.filter((loaded) => loaded.spec.kind === 'task');
    expect(tasks).toHaveLength(1);
    const onlyTasks = { ...generated, complete: tasks };
    const parts = {
      k: 1,
      cheaters: [] as const,
      faults: (spec: typeof hidden) =>
        faultFamily(spec).filter(
          (fault) => fault.family === 'code' && fault.where === 'any' && fault.rate === 1,
        ),
    };
    const check = async (input: typeof onlyTasks) => {
      const runs = await runAll(input, parts);
      expect(runs.errors).toEqual([]);
      expect(
        runs.blocks
          .filter((block) => block.reference.some((outcome) => outcome !== 'pass'))
          .map((block) => block.referenceFailing),
      ).toEqual([]);
      const items = bankItems().filter((item) => item.id.startsWith('fault.C.'));
      expect(items).toHaveLength(20);
      const verdicts = [];
      for (const item of items)
        verdicts.push({ id: item.id, ...(await item.check({ runs: async () => runs } as SeedData)) });
      return verdicts;
    };
    expect((await check(onlyTasks)).filter((item) => !item.pass)).toEqual([]);
    // Corrupt bytes while leaving the agent's claimed digest and diff untouched.
    const contentOnly: Mutation = { save: (result) => ({ ...result, files: { [hidden.saveFile]: '{}' } }) };
    const partial = parts.faults(hidden).find((fault) => fault.class === 'C.partial');
    if (!partial) throw new Error('missing partial-content fault');
    const contentRuns = await runAll(onlyTasks, {
      ...parts,
      faults: () => [
        {
          ...partial,
          mutation: contentOnly,
          def: { ...partial.def, agent: { kind: 'function', create: createFollower(hidden, contentOnly) } },
        },
      ],
    });
    const contentItem = bankItems().find((item) => item.id === 'fault.C.partial');
    expect((await contentItem?.check({ runs: async () => contentRuns } as SeedData))?.pass).toBe(true);
    const mutant = structuredClone(onlyTasks);
    for (const task of mutant.complete)
      for (const block of task.spec.blocks) {
        delete block.expect?.artifacts;
        delete block.expect?.workspace;
        delete block.expect?.must;
      }
    expect((await check(mutant)).filter((item) => item.pass)).toEqual([]);
    expect((await check(onlyTasks)).filter((item) => !item.pass)).toEqual([]);
  }, 300000);
});
