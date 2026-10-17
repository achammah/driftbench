import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type CustomCheckFunction, ESTATE_CHECKS } from '@agent-nexus/driftbench-checks';
import type { CheckSet } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { genCompleteFamily } from '../../src/ladders/estate/bank/loop';
import { completionComponents } from '../../src/ladders/estate/completion';
import { completionContract } from '../../src/ladders/estate/completion-contract';
import { follow } from '../../src/ladders/estate/follower';
import { drawEstate } from '../../src/ladders/estate/hidden';
import { estateMeta } from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { renderEstate } from '../../src/ladders/estate/render';
import { situationsOf } from '../../src/ladders/estate/situations';
import {
  messageReference,
  referenceChecks,
  referenceRun,
  required,
  SUFFIXES,
  suffix,
} from './ruling-reference';

async function measure(run: pipeline.EstateRun, checks: CheckSet = referenceChecks()) {
  const source = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
  const registry = vi.spyOn(pipeline, 'replayChecks').mockReturnValue(checks);
  try {
    return await genCompleteFamily().evaluate(run.estate.seed);
  } finally {
    source.mockRestore();
    registry.mockRestore();
  }
}

describe('the fourteen gen.complete rulings', { timeout: 600_000 }, () => {
  it('records the real product result: every one of the fourteen items holds on seed 1', async () => {
    const result = await genCompleteFamily().evaluate(1);
    // The product now writes the structure these items demand (a journey that ran a script, a hazard that rereads,
    // a permission test with a covered call, a guard message), so no item fails on the real output of seed 1.
    expect([...result].filter(([, r]) => !r.pass).map(([id]) => id)).toEqual([]);
  });

  it('enumerates components, kills structural check deletions, and restores the reference', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const green = await measure(run);
    expect(
      SUFFIXES.map((key) => ({ item: key, ...green.get(`gen.complete.${key}`) })).filter((row) => !row.pass),
    ).toEqual([]);
    const coverage = [];
    for (const key of SUFFIXES) {
      const sources = run.specs.filter((s) => suffix(run, s) === key);
      const inventories = sources.map((s) => completionComponents(completionContract(run, s)));
      const components = inventories.flatMap((i) => i.components);
      const gaps = inventories.flatMap((i) => i.gaps);
      expect(green.get(`gen.complete.${key}`), key).toEqual({ pass: true, detail: 'holds' });
      expect(gaps, key).toEqual([]);
      coverage.push({
        item: `gen.complete.${key}`,
        specs: sources.length,
        components: components.length,
        gaps,
        clauses: components.map((c) => c.id),
      });
      // Product-output deletion operators derive from check structure, not item names.
      const shapes = [...new Map(components.map((c) => [`${c.channel}.${c.check}`, c])).values()];
      for (const component of shapes) {
        const mutant = {
          ...run,
          specs: run.specs.map((s) => {
            if (!sources.includes(s) || !s.loaded) return s;
            const copy = structuredClone(s);
            const spec = required(copy.loaded).spec;
            if (component.channel === 'custom') delete spec.rules?.custom?.[component.check];
            else
              for (const block of spec.blocks)
                if (block.expect) delete (block.expect as Record<string, unknown>)[component.check];
            return copy;
          }),
        };
        expect((await measure(mutant)).get(`gen.complete.${key}`), `${key}:${component.check}`).toMatchObject(
          { pass: false },
        );
      }
    }
    writeFileSync(
      fileURLToPath(new URL('../../../../validators/estate/GEN-COMPLETE-COMPONENTS.json', import.meta.url)),
      `${JSON.stringify(coverage, null, 2)}\n`,
    );
    const restored = await measure({ ...run });
    for (const key of SUFFIXES) expect(restored.get(`gen.complete.${key}`)?.pass, key).toBe(true);
  });

  it('rejects first-run-only, missing no-call and collateral-free checker regressions', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const firstOnly: CustomCheckFunction = (ctx, options) => {
      const name = (options as { name: string }).name;
      const changed = structuredClone(ctx.observed);
      const relevant = (changed.runtime?.guards ?? []).filter(
        (g) => g.name === name && g.verdict !== 'allow',
      );
      if (changed.runtime?.guards)
        changed.runtime.guards = changed.runtime.guards.filter(
          (g) => !relevant.includes(g) || g === relevant[0],
        );
      return messageReference({ ...ctx, observed: changed }, options);
    };
    const noCollateral: CustomCheckFunction = async (ctx, options) => {
      const result = await required(ESTATE_CHECKS.hazard_recovery)(ctx, options);
      return (Array.isArray(result) ? result : [result]).filter((v) => !v.id.endsWith('collateral'));
    };
    const first = await measure({ ...run }, referenceChecks(true, { guard_message: firstOnly }));
    const collateral = await measure({ ...run }, referenceChecks(true, { hazard_recovery: noCollateral }));
    const noCall = {
      ...run,
      specs: run.specs.map((s) => {
        if (!s.loaded) return s;
        const copy = structuredClone(s);
        for (const block of required(copy.loaded).spec.blocks)
          if (block.expect?.tools_offered?.exclude)
            block.expect.tools = block.expect.tools?.filter((t) => t.count !== 0);
        return copy;
      }),
    };
    const denied = await measure(noCall);
    expect(first.get('gen.complete.guard_register-guard-read-before-edit-py')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('every.message.nonempty.middle'),
    });
    expect(denied.get('gen.complete.tool_denied-tool-deny')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('expect.tools'),
    });
    expect(collateral.get('gen.complete.hazard_recovery-hazard-after-compaction')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('collateral'),
    });
    const restored = await measure({ ...run });
    for (const key of SUFFIXES) expect(restored.get(`gen.complete.${key}`)?.pass, key).toBe(true);
  });

  it('kills narrower routing, prerequisite, command-boundary and request-only product mutants', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const mutants = [
      {
        key: 'journey-route-table',
        demand: 'expect.skills',
        change: (spec: NonNullable<pipeline.GeneratedSpec['loaded']>['spec']) => {
          for (const block of spec.blocks) delete block.expect?.skills;
        },
      },
      {
        key: 'skip_pressure-gate-fixed-gate',
        demand: 'expect.references',
        change: (spec: NonNullable<pipeline.GeneratedSpec['loaded']>['spec']) => {
          for (const block of spec.blocks) delete block.expect?.references;
          spec.rules = {
            ...spec.rules,
            custom: { ...spec.rules?.custom, ordered: { pairs: [{ before: 'Read', after: 'Edit' }] } },
          };
        },
      },
      {
        key: 'tool_boundary-tool-allow',
        demand: 'covered.pattern',
        change: (spec: NonNullable<pipeline.GeneratedSpec['loaded']>['spec']) => {
          const permission = spec.rules?.custom?.permission as { rules: Array<{ rule: string }> };
          for (const rule of permission.rules) rule.rule = rule.rule.split('(')[0] as string;
        },
      },
    ];
    for (const mutant of mutants) {
      const changed = {
        ...run,
        specs: run.specs.map((s) => {
          if (suffix(run, s) !== mutant.key || !s.loaded) return s;
          const copy = structuredClone(s);
          mutant.change(required(copy.loaded).spec);
          return copy;
        }),
      };
      expect((await measure(changed)).get(`gen.complete.${mutant.key}`), mutant.key).toMatchObject({
        pass: false,
        detail: expect.stringContaining(mutant.demand),
      });
    }
    expect(
      (await measure({ ...run }, referenceChecks(false))).get('gen.complete.tool_boundary-tool-ask'),
    ).toMatchObject({ pass: false, detail: expect.stringContaining('permission_decision') });
    const restored = await measure({ ...run });
    for (const key of [...mutants.map((m) => m.key), 'tool_boundary-tool-ask'])
      expect(restored.get(`gen.complete.${key}`)?.pass, key).toBe(true);
  });

  it('shows the real product rejecting a late prerequisite, as the corrected reference does', async () => {
    const run = await pipeline.generationRun(1);
    const source = required(run.specs.find((s) => suffix(run, s) === 'skip_pressure-gate-fixed-gate'));
    const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
    const late = required(
      completionComponents(completionContract(run, source)).components.find((c) =>
        c.id.endsWith('prior-qualified'),
      ),
    );
    const observedChange = (observed: Parameters<typeof late.change>[0]) => {
      const originalReferences = observed.runtime?.references?.map((r) => r.path);
      const originalCount = observed.toolCalls.length;
      late.change(observed);
      const edit = observed.toolCalls.findIndex((c) => c.label === 'Edit');
      const isFixedRead = (call: (typeof observed.toolCalls)[number]) =>
        call.label === 'Read' &&
        String((call.input as { file_path?: string }).file_path).endsWith(`/${atom.fields?.path}`);
      expect(observed.toolCalls.findIndex((c) => c.label === 'Read' && !isFixedRead(c))).toBeLessThan(edit);
      expect(observed.toolCalls.findIndex(isFixedRead)).toBeGreaterThan(edit);
      expect(observed.runtime?.references?.map((r) => r.path)).toEqual(originalReferences);
      const fixed = required(observed.toolCalls.find(isFixedRead));
      expect(Date.parse(required(fixed.startedAt))).toBeGreaterThan(
        Date.parse(required(observed.toolCalls[edit]?.startedAt)),
      );
      expect(observed.toolCalls).toHaveLength(originalCount);
    };
    // The product's own ordered check rejects the late prerequisite now, as the corrected reference does.
    const product = await pipeline.replayOnFollower(
      run,
      required(source.loaded),
      pipeline.replayChecks(),
      undefined,
      observedChange,
    );
    expect(product.pass).toBe(false);
    expect(product.failing.some((f) => f.includes('ordered'))).toBe(true);
    const reference = referenceRun(run);
    const fixed = required(reference.specs.find((s) => s.record.id === source.record.id));
    const red = await pipeline.replayOnFollower(
      reference,
      required(fixed.loaded),
      referenceChecks(),
      undefined,
      observedChange,
    );
    expect(red.pass).toBe(false);
    expect(red.failing.some((f) => f.includes('ordered'))).toBe(true);
    expect(
      (await measure(run, pipeline.replayChecks())).get('gen.complete.skip_pressure-gate-fixed-gate'),
    ).toEqual({ pass: true, detail: 'holds' });
  });

  it('rejects denied, mismatched and late grants in the synthetic permission contract', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const source = required(run.specs.find((s) => suffix(run, s) === 'tool_boundary-tool-ask'));
    for (const mutation of ['deny', 'wrong-id', 'late'] as const) {
      const result = await pipeline.replayOnFollower(
        run,
        required(source.loaded),
        referenceChecks(),
        undefined,
        (observed) => {
          const raw = observed.raw as { kept: Array<{ record: Record<string, unknown> }> };
          for (const { record } of raw.kept)
            if (record.subtype === 'permission_decision') {
              if (mutation === 'deny') record.decision = 'deny';
              if (mutation === 'wrong-id') record.requestId = 'unrelated-call';
              if (mutation === 'late') record.timestamp = '2099-01-01T00:00:00.000Z';
            }
        },
      );
      expect(result.pass, mutation).toBe(false);
      expect(
        result.failing.some((f) => f.includes('permission')),
        mutation,
      ).toBe(true);
    }
  });

  it('reports unsupported check structures as named gaps', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const source = required(run.specs.find((s) => s.loaded));
    const spec = structuredClone(required(source.loaded).spec);
    spec.rules = {
      custom: {
        unknown_fixture_check: { clause: true },
        guard_message: { name: 'fictional-guard', mustNot: ['[a-z]+'] },
        ordered: { pairs: [{ before: ['Read', 'Write'], after: 'Edit', key: 'file_path' }] },
      },
    };
    const gaps = completionComponents(spec).gaps;
    expect(gaps).toEqual(
      expect.arrayContaining([
        '0.custom.unknown_fixture_check.unsupported-check-structure',
        '0.custom.guard_message.mustNot.0.regex-witness',
        '0.custom.ordered.0.OR-stage-key-reset-or-history',
      ]),
    );
  });

  it('keeps the absent-reference lint plant and supplies the same reference in the generation twin', async () => {
    const estate = drawEstate(1);
    const broken = renderEstate(estate);
    expect(broken.findings.some((f) => f.code === 'MISSING_REFERENCE')).toBe(true);
    const run = await pipeline.generationRun(1);
    expect(run.rendered.findings.some((f) => f.code === 'MISSING_REFERENCE')).toBe(false);
    expect(run.rendered.atoms.map((a) => a.hid)).toEqual(broken.atoms.map((a) => a.hid));
    const absent = required(broken.findings.find((f) => f.code === 'MISSING_REFERENCE'));
    const ref = required(broken.atoms.find((a) => a.hid === absent.atom));
    expect(broken.files[ref.key]).toBeUndefined();
    expect(run.rendered.files[ref.key]).toBeTruthy();
  });

  it('derives offered tools and permission records from settings, including a changed permission', () => {
    const estate = drawEstate(1);
    const situations = situationsOf(estate);
    const situation = required(situations.find((s) => s.act.type === 'tool' && s.act.effect === 'ask'));
    const approved = follow(estate, situations, [required(situation.phrases[0])]);
    expect(approved.transcript).toContain('permission_request');
    expect(approved.transcript).toContain('permission_decision');
    const changed = structuredClone(estate);
    changed.permissions.ask = [];
    changed.permissions.deny = [];
    const bypassed = follow(changed, situations, [required(situation.phrases[0])]);
    expect(bypassed.transcript).not.toContain('permission_request');
    expect(bypassed.transcript).toContain('WebFetch');
    expect(approved.transcript).not.toContain('"WebFetch"');
  });
});

describe('hazard_recovery demands the reread its passage names', { timeout: 900_000 }, () => {
  const HAZARD = 'hazard_recovery-hazard-after-compaction';
  const SEEDS = [1, 4, 5, 6, 8, 1009];

  const hazardSpecs = (run: pipeline.EstateRun) => run.specs.filter((s) => suffix(run, s) === HAZARD);

  it('fails a generated spec that drops the reread, on every seed that has a compaction rule', async () => {
    let judged = 0;
    for (const seed of SEEDS) {
      const raw = await pipeline.generationRun(seed);
      const sources = hazardSpecs(raw);
      if (sources.length === 0) continue;
      judged += 1;
      // The product's own spec holds, and the same spec without its reread fails on the reread.
      expect((await measure(raw)).get(`gen.complete.${HAZARD}`), `seed ${seed}`).toEqual({
        pass: true,
        detail: 'holds',
      });
      const dropped = {
        ...raw,
        specs: raw.specs.map((s) => {
          if (!sources.includes(s) || !s.loaded) return s;
          const copy = structuredClone(s);
          const custom = required(copy.loaded).spec.rules?.custom?.hazard_recovery as { reread?: string[] };
          delete custom.reread;
          return copy;
        }),
      };
      expect((await measure(dropped)).get(`gen.complete.${HAZARD}`), `seed ${seed}`).toMatchObject({
        pass: false,
        detail: expect.stringContaining('reread'),
      });
    }
    expect(judged).toBeGreaterThanOrEqual(4);
  });

  it('passes the reference compile that rereads what the passage names, and rejects an agent that does not', async () => {
    for (const seed of SEEDS) {
      const run = referenceRun(await pipeline.generationRun(seed));
      const specs = hazardSpecs(run);
      if (specs.length === 0) continue;
      expect((await measure(run)).get(`gen.complete.${HAZARD}`), `seed ${seed}`).toEqual({
        pass: true,
        detail: 'holds',
      });
      const checks = referenceChecks();
      for (const spec of specs) {
        const loaded = required(spec.loaded);
        const reread = (loaded.spec.rules?.custom?.hazard_recovery as { reread?: string[] } | undefined)
          ?.reread;
        expect(reread?.length, `seed ${seed} reread`).toBeGreaterThan(0);
        // The conforming follower reads the file again after the marker; one that ignores the rule does not.
        expect((await pipeline.replayOnFollower(run, loaded, checks)).pass, `seed ${seed} conforming`).toBe(
          true,
        );
        const faulty = await pipeline.replayOnFollower(run, loaded, checks, 'rule:after-compaction');
        expect(faulty.pass, `seed ${seed} faulty`).toBe(false);
        expect(faulty.failing.join('\n'), `seed ${seed}`).toMatch(/reread/);
      }
    }
  });
});
