import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearObjectContexts, loadSpecFile, type Spec } from '@agent-nexus/driftbench-core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createToolsCheck } from '../src/checks/tools';
import { initializeShippedObjects } from '../src/initialize';
import { acmeReplayer } from './support/acme-replayer';
import { context, observed, run, verdict } from './support/context';

/**
 * Blast radius of the value-check ladder (PR 459) on the object layers. The loader resolves `uses.value_check`
 * against the shipped, project and suite objects of a spec file, and the tools check resolves it against the same
 * context (`objectContextOfSpec`). A spec the loader accepts is scored with the policy it names, a project or suite
 * `uses.yaml` that names a policy reaches the check, and a policy that cannot resolve is reported, never replaced
 * by the shipped one in silence. Fictional data only. From the audit lane (ladder), turned green by the fix.
 */

const ADDRESS = '88 Summit Avenue, Acmeville';
const WRITTEN = '88 summit avenue, acmeville';

/** A project policy that turns rung 1 off: a writing the tool resolves is then compared exactly. */
const STRICT = `kind: policy/value-check
id: strict
extends: default
items:
  - id: rung1_outcome
    enabled: false
`;

function specText(uses?: string): string {
  return `id: blast-ladder-layers
target: { adapter: function, agent: acme-sales }
${uses === undefined ? '' : `uses: ${uses}\n`}blocks:
  - user: Do you cover ${ADDRESS}?
    expect:
      tools:
        - label: coverage.check
          input: { address: ${ADDRESS} }
`;
}

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  initializeShippedObjects();
  clearObjectContexts();
});

/** A project folder: `driftbench.yaml`, the strict policy in `driftbench/`, and the spec in `specs/`. */
async function project(options: { uses?: string; suiteUses?: string }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'blast-ladder-layers-'));
  made.push(root);
  await writeFile(join(root, 'driftbench.yaml'), '# a project root\n');
  await mkdir(join(root, 'driftbench', 'policy', 'value-check'), { recursive: true });
  await writeFile(join(root, 'driftbench', 'policy', 'value-check', 'strict.yaml'), STRICT);
  await mkdir(join(root, 'specs', '_driftbench'), { recursive: true });
  if (options.suiteUses !== undefined) {
    await writeFile(join(root, 'specs', '_driftbench', 'uses.yaml'), options.suiteUses);
  }
  const file = join(root, 'specs', 'coverage.yaml');
  await writeFile(file, specText(options.uses));
  return file;
}

async function loaded(file: string): Promise<Spec> {
  const result = await loadSpecFile(file);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.spec;
}

/** The address verdicts of the loaded spec, with the Acme replayer configured: rung 1 can settle the writing. */
async function scored(spec: Spec) {
  const seen = observed('Checking.', [{ label: 'coverage.check', input: { address: WRITTEN } }]);
  return run(createToolsCheck({ services: { replayer: acmeReplayer() } }), context(spec, 0, seen));
}

describe('uses.value_check through the object layers (PR 459)', () => {
  it('control: with no policy named, rung 1 settles the lower-case writing the tool resolves', async () => {
    const spec = await loaded(await project({}));
    const verdicts = await scored(spec);
    expect(verdict(verdicts, 'tools.coverage.check.input.address').outcome).toBe('pass');
    expect(verdicts.map((entry) => entry.id)).not.toContain('tools.value_check');
  });

  it('control: an inline policy in the spec file that turns rung 1 off compares the writing exactly', async () => {
    const inline = '{ value_check: { extends: default, items: [{ id: rung1_outcome, enabled: false }] } }';
    const spec = await loaded(await project({ uses: inline }));
    const address = verdict(await scored(spec), 'tools.coverage.check.input.address');
    expect(address.outcome).toBe('fail');
    expect(address.evidence).toContain('exact_fallback');
  });

  it('scores a spec that names a project policy by id with that policy', async () => {
    const spec = await loaded(await project({ uses: '{ value_check: strict }' }));
    const verdicts = await scored(spec);
    expect(verdicts.map((entry) => entry.id)).not.toContain('tools.value_check');
    const address = verdict(verdicts, 'tools.coverage.check.input.address');
    expect(address.outcome).toBe('fail');
    expect(address.evidence).toContain('exact_fallback');
  });

  it('scores the specs under a suite uses.yaml with the policy it names', async () => {
    const spec = await loaded(await project({ suiteUses: 'value_check: strict\n' }));
    const address = verdict(await scored(spec), 'tools.coverage.check.input.address');
    expect(address.outcome).toBe('fail');
    expect(address.evidence).toContain('exact_fallback');
  });

  it('an object the check cannot resolve fails tools.value_check and keeps the count and input verdicts, compared exactly', async () => {
    const spec = await loaded(await project({}));
    const named = { ...spec, uses: { value_check: 'nowhere' } } as Spec;
    const verdicts = await scored(named);
    const ids = verdicts.map((entry) => entry.id);
    expect(ids).toContain('tools.value_check');
    expect(verdict(verdicts, 'tools.value_check').evidence).toContain('compared exactly');
    expect(ids).toEqual(
      expect.arrayContaining(['tools.coverage.check.count', 'tools.coverage.check.input.address']),
    );
    expect(verdict(verdicts, 'tools.coverage.check.input.address').evidence).toContain('exact_fallback');
  });
});
