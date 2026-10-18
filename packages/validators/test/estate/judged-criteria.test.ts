import { afterEach, describe, expect, it, vi } from 'vitest';
import { genAsksFamily } from '../../src/ladders/estate/bank/loop';
import * as pipeline from '../../src/ladders/estate/pipeline';

vi.mock('../../src/ladders/estate/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ladders/estate/pipeline')>();
  return { ...actual, estateRun: vi.fn(actual.estateRun) };
});

const ID = 'gen.asks.judged-only-registers';
type Run = pipeline.EstateRun;
type Spec = Run['specs'][number];
type Criterion = { name: string; gating?: boolean };
type Body = { criteria?: Criterion[]; tags?: string[]; metadata?: { estate?: { judged?: string[] } } };

/** Runs gen.asks on a seed with the generated suite changed by `fault`. */
async function withSpecs(seed: number, fault?: (specs: Spec[], run: Run) => Spec[]) {
  const actual = await vi.importActual<typeof pipeline>('../../src/ladders/estate/pipeline');
  vi.mocked(pipeline.estateRun).mockImplementation(async (s, profile) => {
    const run = await actual.estateRun(s, profile);
    return fault ? { ...run, specs: fault([...run.specs], run) } : run;
  });
  return (await genAsksFamily().evaluate(seed)).get(ID);
}

/** Changes the body of the first loaded spec that `pick` accepts. */
function change(specs: Spec[], pick: (body: Body) => boolean, edit: (body: Body) => void): Spec[] {
  const index = specs.findIndex((spec) => spec.loaded && pick(spec.loaded.spec as Body));
  if (index < 0) throw new Error('no spec to plant the fault in');
  const spec = specs[index] as Spec;
  const body = structuredClone(spec.loaded?.spec) as Body;
  edit(body);
  specs[index] = { ...spec, loaded: { ...spec.loaded, spec: body } } as Spec;
  return specs;
}
const judges = (kind: 'register' | 'other') => (body: Body) =>
  (body.criteria ?? []).some(
    (c) => (kind === 'register') === c.name.startsWith('register.') && !c.name.endsWith('.control'),
  );

describe(`${ID} follows the Then table of docs/estate.md section 5`, { timeout: 300_000 }, () => {
  afterEach(() => vi.mocked(pipeline.estateRun).mockReset());

  it.each([1, 2, 3])(
    'passes output-rule criteria, domain-rule criteria and judged controls, on seed %i',
    async (seed) => {
      let domain = 0;
      const result = await withSpecs(seed, (specs) => {
        domain = specs.filter((spec) => spec.loaded && judges('other')(spec.loaded.spec as Body)).length;
        return specs;
      });
      // The suite holds gating criteria on domain rules: the old item failed on each of them.
      expect(domain).toBeGreaterThan(0);
      expect(result).toMatchObject({ pass: true });
    },
  );

  it('fails a judged criterion on a skill atom', async () => {
    const result = await withSpecs(1, (specs, run) => {
      const skill = run.scanned.map.atoms.find((atom) => atom.kind === 'skill');
      return change(specs, judges('other'), (body) => {
        body.criteria = [...(body.criteria ?? []), { name: skill?.id as string, gating: true }];
        body.metadata = {
          ...body.metadata,
          estate: { ...body.metadata?.estate, judged: [skill?.id as string] },
        };
      });
    });
    expect(result).toMatchObject({ pass: false });
    expect(result?.detail).toBe(
      '1 specs judge an atom that is neither an output rule (not gating) nor a listed domain rule or control (gating)',
    );
  });

  it('fails a gating criterion on an output rule', async () => {
    const result = await withSpecs(1, (specs) =>
      change(specs, judges('register'), (body) => {
        for (const criterion of body.criteria ?? [])
          if (criterion.name.startsWith('register.')) criterion.gating = true;
      }),
    );
    expect(result).toMatchObject({ pass: false });
  });

  it('fails a domain-rule criterion that is not gating, not listed, or on a spec not tagged judged', async () => {
    const soft = await withSpecs(1, (specs) =>
      change(specs, judges('other'), (body) => {
        for (const criterion of body.criteria ?? []) criterion.gating = false;
      }),
    );
    expect(soft).toMatchObject({ pass: false });
    const unlisted = await withSpecs(1, (specs) =>
      change(specs, judges('other'), (body) => {
        body.metadata = { ...body.metadata, estate: { ...body.metadata?.estate, judged: [] } };
      }),
    );
    expect(unlisted).toMatchObject({ pass: false });
    const untagged = await withSpecs(1, (specs) =>
      change(specs, judges('other'), (body) => {
        body.tags = (body.tags ?? []).filter((tag) => tag !== 'judged');
      }),
    );
    expect(untagged).toMatchObject({ pass: false });
  });

  // Review of PR 241: judged criteria section 5 does not give (each passed the first version of the item).
  const addJudged = (id: string, name: string) => (body: Body) => {
    body.criteria = [...(body.criteria ?? []), { name, gating: true }];
    body.tags = [...new Set([...(body.tags ?? []), 'judged'])];
    body.metadata = {
      ...body.metadata,
      estate: { ...body.metadata?.estate, judged: [...(body.metadata?.estate?.judged ?? []), id] },
    };
  };
  function plantIn(specs: Spec[], testTypes: readonly string[], edit: (body: Body) => void): Spec[] {
    const index = specs.findIndex((spec) => spec.loaded && testTypes.includes(spec.record.testType));
    if (index < 0) throw new Error(`no spec of ${testTypes.join(' or ')}`);
    const spec = specs[index] as Spec;
    const body = structuredClone(spec.loaded?.spec) as Body;
    edit(body);
    specs[index] = { ...spec, loaded: { ...spec.loaded, spec: body } } as Spec;
    return specs;
  }

  it('fails a judged control on a skill atom, whose skill_loaded predicate has a machine inverse', async () => {
    const result = await withSpecs(1, (specs, run) => {
      const skill = run.scanned.map.atoms.find(
        (atom) =>
          atom.kind === 'skill' && atom.evidence.every((evidence) => evidence.type === 'skill_loaded'),
      );
      if (!skill) throw new Error('no skill atom with only skill_loaded');
      return plantIn(
        specs,
        ['outside_trigger', 'route_near_miss'],
        addJudged(skill.id, `${skill.id}.control`),
      );
    });
    expect(result).toMatchObject({ pass: false });
  });

  it('fails a judged control in a positive test (an obligation), which is no control', async () => {
    const result = await withSpecs(1, (specs, run) => {
      const control = run.specs
        .flatMap((spec) => ((spec.loaded?.spec as Body | undefined)?.criteria ?? []).map((c) => c.name))
        .find((name) => name.endsWith('.control'));
      if (!control) throw new Error('the suite holds no judged control');
      return plantIn(specs, ['obligation'], addJudged(control.replace(/\.control$/, ''), control));
    });
    expect(result).toMatchObject({ pass: false });
  });

  it('fails a judged criterion on a rule whose custom predicate a registered check runs (permission)', async () => {
    const result = await withSpecs(1, (specs, run) => {
      const tool = run.scanned.map.atoms.find(
        (atom) =>
          atom.kind === 'tool' &&
          atom.evidence.length > 0 &&
          atom.evidence.every((evidence) => evidence.type === 'custom' && evidence.name === 'permission'),
      );
      if (!tool) throw new Error('no tool atom judged by permission');
      return change(specs, judges('other'), addJudged(tool.id, tool.id));
    });
    expect(result).toMatchObject({ pass: false });
  });

  it('fails a criterion that names no atom of the map', async () => {
    const result = await withSpecs(1, (specs) =>
      change(specs, judges('other'), (body) => {
        body.criteria = [
          ...(body.criteria ?? []),
          { name: 'instruction.standing.no-such-rule', gating: true },
        ];
      }),
    );
    expect(result).toMatchObject({ pass: false });
  });
});
