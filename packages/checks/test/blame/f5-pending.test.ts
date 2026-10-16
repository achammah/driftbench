import * as core from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

type Stamp = core.By;

core.initializeShippedObjects();

describe('F5 integration contracts', () => {
  it('real runDiagnostics preserves the deciding item output.by stamp', async () => {
    const api = core;
    expect(api.registerDiagnosticStep, 'requires the real F5 registrar').toBeTypeOf('function');
    expect(api.runDiagnostics, 'requires the real F5 runner').toBeTypeOf('function');
    if (!api.registerDiagnosticStep || !api.runDiagnostics) throw new Error('F5 API is not available');

    const registry = new core.ObjectRegistry();
    for (const kind of core.BUILTIN_KINDS) registry.registerKind(kind);
    const deciding: Stamp = {
      object: 'policy/blame:project@12345678',
      item: 'project_rule',
      impl: 'plugin:project-blame',
      layer: 'project',
    };
    const impl = 'plugin:blame-pending-f5-deciding-stamp';
    api.registerDiagnosticStep(
      impl,
      {
        params: z.strictObject({}),
        cost: 'static',
        run: () => ({ summary: 'decided', by: deciding }),
      },
      registry,
    );
    registry.registerShipped(
      {
        kind: 'diagnostic',
        id: 'blame-pending-f5-stamp',
        scope: 'block',
        steps: [{ id: 'attribute', title: 'Attribute the finding', impl }],
      },
      'test diagnostic:blame-pending-f5-stamp',
    );
    const diagnostic = new core.ObjectStore(registry).resolve('diagnostic', 'blame-pending-f5-stamp');
    const result = await api.runDiagnostics([diagnostic], {
      // This step does not read the check; exercise real registration, execution, schema and stamping only.
      check: {} as core.CheckContext,
      verdicts: [],
      objects: [],
    });
    expect(result.skippedForBudget).toBe(0);
    expect(result.diagnoses).toHaveLength(1);
    expect(result.diagnoses[0]).toMatchObject({
      summary: 'decided',
      diagnostic: diagnostic.ref,
      step: 'attribute',
      by: deciding,
    });
  });

  it('diagnostic schema accepts and retains any_verdict.gating', () => {
    const when = core.objectRegistry.kind('diagnostic')?.fields?.when;
    expect(when, 'requires the real F5 diagnostic kind').toBeDefined();
    const trigger = { any_verdict: { gating: true, outcome: 'fail' } };
    expect(when && z.safeParse(when, trigger)).toMatchObject({
      success: true,
      data: trigger,
    });
  });

  it('diagnostic schema accepts and retains any_diagnosis.confidence', () => {
    const when = core.objectRegistry.kind('diagnostic')?.fields?.when;
    expect(when, 'requires the real F5 diagnostic kind').toBeDefined();
    const trigger = { any_diagnosis: { confidence: ['static', 'undecided'] } };
    expect(when && z.safeParse(when, trigger)).toMatchObject({
      success: true,
      data: trigger,
    });
  });
});
