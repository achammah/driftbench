// HF1: every example spec, main's loader against the extended loader: content hash and teacher-forced
// block cache keys. Controls C1 to C4 show the comparison can fail. Run from the worktree root:
//   tsx --tsconfig research/block-redesign/framework/core/tsconfig.json research/block-redesign/framework/core/src/hf1.mts
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { blockCacheKey } from '../../../../../packages/core/src/runner/cache.ts';
import { canonicalGiven, resolveGiven } from '../../../../../packages/core/src/runner/given.ts';
import { findSpecFiles, loadSpecFile, validateSpec } from '../../../../../packages/core/src/spec/load.ts';
import { contentHash } from '../../../../../packages/core/src/spec/hash.ts';
import { anchorWorkspace, buildExtendedSpec, ExtSpec, loadSpecFileWith, parseRaw, validateWith } from './spec-ext.ts';

const here = resolve(import.meta.dirname, '..');
type AnySpec = { version?: string; target?: unknown; blocks: { when: unknown }[] };

function blockKeys(spec: AnySpec): string[] {
  const { version: _v, ...unlabelled } = spec;
  const specHash = contentHash(unlabelled);
  const target = (spec.target ?? { adapter: 'stand-in' }) as never;
  return spec.blocks.map((block, index) => {
    try {
      const canonical = canonicalGiven(spec as never, index);
      const given = resolveGiven(canonical.state, canonical.prefix, target);
      return blockCacheKey({ specHash, repeat: 0, position: index, given, stimulus: block.when as never, target, adapter: 'stand-in', adapterVersion: '0' });
    } catch (cause) {
      return `error:${cause instanceof Error ? cause.message : String(cause)}`;
    }
  });
}

const files = await findSpecFiles(['examples']);
const Mutant = buildExtendedSpec({ mutantDefaultUses: true });
const rows = [];
let c1Differs = 0, c1MainRefused = 0, c1ExtOk = 0, c2Changed = 0;
for (const file of files) {
  const main = await loadSpecFile(file);
  const ext = await loadSpecFileWith(ExtSpec, file);
  const row: Record<string, unknown> = { file, mainOk: main.ok, extOk: ext.ok };
  if (main.ok && ext.ok) {
    const mk = blockKeys(main.spec as AnySpec);
    const ek = blockKeys(ext.spec as AnySpec);
    row.mainHash = main.hash;
    row.extHash = ext.hash;
    row.hashChanged = main.hash !== ext.hash;
    row.blocks = mk.length;
    row.keyErrors = mk.filter((k) => k.startsWith('error:')).length;
    row.changedKeys = mk.filter((k, i) => k !== ek[i]).length + Math.abs(mk.length - ek.length);
    // C1: the same spec with a new key at the top. C2: the mutant extension that defaults `uses`.
    const parsed = parseRaw(await readFile(file, 'utf8'), file);
    if (parsed.ok && parsed.raw && typeof parsed.raw === 'object') {
      const withUses = { ...(parsed.raw as object), uses: { value_check: 'default' } };
      const extC1 = anchorWorkspace(validateWith(ExtSpec, withUses, file));
      const mainC1 = validateSpec(withUses, file);
      if (extC1.ok) c1ExtOk++;
      if (extC1.ok && extC1.hash !== main.hash) c1Differs++;
      if (!mainC1.ok && mainC1.errors.some((e) => /unknown key|unrecognized/i.test(e.message))) c1MainRefused++;
      const mutant = anchorWorkspace(validateWith(Mutant, parsed.raw, file));
      if (mutant.ok && mutant.hash !== main.hash) c2Changed++;
    }
  } else if (!main.ok && !ext.ok) {
    row.sameRefusal = true;
  }
  rows.push(row);
}

// C3: a fixture using all six new keys. C4: an unknown key is still refused by the extension.
const fixture = {
  id: 'fw-fixture',
  uses: { value_check: 'default', blame: 'acme', diagnostics: ['value-mismatch'] },
  blocks: [
    { user: 'hello' },
    {
      when: { simulated_user: { scenario: 'refund-late-order', personas: ['terse-regular'] } },
      given: { parent: 'refund-late-order#b0' },
      uses: { value_check: { extends: 'default', items: [{ id: 'rung3_same_referent', params: { repeats: 5 } }] } },
      links: [{ unit: 'R#41/c3', relation: 'verifies' }],
      diagnostics: ['persona-sensitivity'],
      expect: { tools: [{ label: 'coverage.check', input: { address: { equals: '7 Quarry Lane, Acmeville', compare: 'auto' }, zip: { exact: '1000', compare: 'exact', reason: 'the CRM needs it' } } }] },
    },
  ],
};
const c3Ext = validateWith(ExtSpec, fixture);
const c3Main = validateSpec(fixture);
const c4 = { ...fixture, bogus: 1 };
const c4Ext = validateWith(ExtSpec, c4);
const c4Main = validateSpec(c4);

const loadedBoth = rows.filter((r) => r.mainOk && r.extOk);
const summary = {
  files: files.length,
  mainOk: rows.filter((r) => r.mainOk).length,
  extOk: rows.filter((r) => r.extOk).length,
  loadedByBoth: loadedBoth.length,
  mainOkExtRefused: rows.filter((r) => r.mainOk && !r.extOk).length,
  mainRefusedExtOk: rows.filter((r) => !r.mainOk && r.extOk).length,
  bothRefused: rows.filter((r) => !r.mainOk && !r.extOk).length,
  specsHashChanged: loadedBoth.filter((r) => r.hashChanged).length,
  blocks: loadedBoth.reduce((s, r) => s + (r.blocks as number), 0),
  blockKeyErrors: loadedBoth.reduce((s, r) => s + (r.keyErrors as number), 0),
  specsKeyChanged: loadedBoth.filter((r) => (r.changedKeys as number) > 0).length,
  blockKeysChanged: loadedBoth.reduce((s, r) => s + (r.changedKeys as number), 0),
  controls: {
    C1_extLoadsWithUses: c1ExtOk,
    C1_hashDiffers: c1Differs,
    C1_mainRefusesUnknownKey: c1MainRefused,
    C2_mutantHashChanged: c2Changed,
    C3_fixtureExtOk: c3Ext.ok,
    C3_fixtureMainOk: c3Main.ok,
    C3_mainErrors: c3Main.ok ? [] : c3Main.errors.map((e) => `${e.path}: ${e.message}`),
    C4_unknownKeyExtOk: c4Ext.ok,
    C4_unknownKeyMainOk: c4Main.ok,
  },
};
summary.verdict = summary.mainOkExtRefused === 0 && summary.specsHashChanged === 0 && summary.specsKeyChanged === 0 ? 'SUPPORTED' : 'FALSIFIED';
await writeFile(resolve(here, 'results-hf1.json'), `${JSON.stringify({ summary, rows }, null, 1)}\n`);
console.log(JSON.stringify(summary, null, 1));
