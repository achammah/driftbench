import { parseSpecText } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { estateOwners } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

const unit = (name: string, description: string): EstateAtom => ({
  id: `skill.${name}`,
  kind: 'skill',
  title: name,
  approved: true,
  fields: { name, description },
  provenance: { file: `skills/${name}/SKILL.md`, quote: description },
  evidence: [{ type: 'skill_loaded', name }],
});
const hub = unit('catalogue', 'Prepare the annual catalogue.');
const shipping = unit('shipping', 'Track delayed parcels for the dispatch centre.');
const reference = (
  id: string,
  path = 'skills/shipping/references/carriers.md',
  quote = 'Read the carrier policy when needed.',
): EstateAtom => ({
  id,
  kind: 'reference',
  title: 'Read the carrier policy',
  approved: true,
  fields: { path, readWhen: 'When a carrier update arrives' },
  provenance: { file: hub.provenance?.file, quote },
  evidence: [{ type: 'tool_called', label: 'Read', input: { file_path: { equals: path } } }],
});
function run(atoms: EstateAtom[], rows: EstatePlanRow[], situations: PhraseBank['situations'] = []) {
  const edges = atoms
    .filter((atom) => atom.kind === 'reference')
    .flatMap((atom) => [
      { from: hub.id, to: atom.id, kind: 'reference' },
      { from: shipping.id, to: atom.id, kind: 'reference' },
    ]);
  const map = { runtime: 'claude-code', hash: 'dispatch', atoms, edges };
  return generateEstateSuite(
    {
      map,
      plan: { mapHash: map.hash, rows },
      bank: PhraseBank.parse({
        version: 1,
        estate: 'dispatch',
        mapHash: map.hash,
        situations,
      }),
    },
    { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
}
const row = (id: string): EstatePlanRow => ({
  id,
  atomIds: [id, hub.id],
  cell: {},
  testType: 'read_when',
  mode: 'live',
  status: 'approved',
});

it('the target folder overrides a wrong citing skill, including stale plan metadata', () => {
  const ref = reference('reference.carriers');
  const suite = run([hub, shipping, ref], [row(ref.id)]);
  expect(
    estateOwners([hub, shipping, ref], [{ from: hub.id, to: ref.id, kind: 'reference' }]).get(ref.id),
  ).toBe(shipping.id);
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(suite.report.summary.complete).toBe(1);
  // The shipping skill owns the reference by folder, so it supplies the task; it does not join the row.
  expect(suite.specs[0]?.atoms).toEqual([ref.id]);
  expect(parsed.spec.blocks[0]?.when).toEqual({
    user: 'Please track delayed parcels for the dispatch centre, including the carriers. When a carrier update arrives.',
  });
  // The rule is written in the catalogue's file: the shipping skill supplies the task, but its load is not required.
  expect(parsed.spec.blocks[0]?.expect?.skills).toBeUndefined();
  expect((parsed.spec.metadata?.estate as { atoms?: string[] } | undefined)?.atoms).not.toContain(hub.id);
});

it.each([
  [
    'Before notarizing the delivery document, read the shipping policy.',
    'help me with notarizing the delivery document',
  ],
  [
    'Before you translate the customs declaration, read the shipping policy.',
    'translate the customs declaration',
  ],
  ['Read the shipping policy before preparing the customs declaration.', 'prepare the customs declaration'],
  ['Read the shipping policy first, then archive the delivery receipt.', 'archive the delivery receipt'],
  ['Never publish the carrier notice without reading the shipping policy.', 'publish the carrier notice'],
])('takes the work from its own governed clause: %s', (quote, action) => {
  const ref = reference('reference.clause', undefined, quote);
  const suite = run([hub, shipping, ref], [row(ref.id)]);
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(parsed.spec.blocks[0]?.when).toEqual({ user: `Please ${action}.` });
});

it('a shared reference takes the task of the unit that cites it directly, never one that only links to it', () => {
  // The edges link the catalogue and the shipping unit to the shared file; only the file of the atom's own
  // citation decides.
  const fromShipping = reference('reference.shared-one', 'shared/policy.md');
  fromShipping.provenance = { file: shipping.provenance?.file, quote: 'Read shared/policy.md.' };
  const suite = run([hub, shipping, fromShipping], [row(fromShipping.id)]);
  expect(suite.report.summary.complete).toBe(1);
  expect(suite.specs[0]?.atoms).toEqual([fromShipping.id, shipping.id]);
  const file = suite.files.find((entry) => entry.path.endsWith('.yaml'));
  const parsed = parseSpecText(file?.text ?? '', 'yaml', file?.path ?? '');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(parsed.spec.blocks[0]?.when).toEqual({
    user: 'Please track delayed parcels for the dispatch centre, including the policy. When a carrier update arrives.',
  });
  // Written in the unit's own file, the same reference does require the unit.
  expect(parsed.spec.blocks[0]?.expect?.skills).toEqual([{ name: 'shipping', count: { min: 1 } }]);
});

it('a shared reference cited from no unit borrows no linked task and hides no gap by grouping', () => {
  const standing = (id: string): EstateAtom => {
    const ref = reference(id, 'shared/policy.md');
    ref.provenance = { file: 'CLAUDE.md', quote: 'Read shared/policy.md.' };
    return ref;
  };
  const first = standing('reference.shared-one');
  const second = standing('reference.shared-two');
  const suite = run([hub, shipping, first, second], [row(first.id), row(second.id)]);
  expect(suite.report.summary.complete).toBe(0);
  expect(suite.report.incomplete).toHaveLength(2);
  expect(suite.report.equivalence.collapsed).toBe(0);
  for (const spec of suite.specs) {
    expect(spec.atoms).toHaveLength(1);
    expect(spec.markers).toContain('needs-askable-act');
  }
});

it('preserves folder ownership across hundreds of deliberately flattened citation links', () => {
  const units = Array.from({ length: 24 }, (_, i) =>
    unit(`dispatch-${i}`, `Review the delivery notes for dispatch centre ${i}.`),
  );
  const actions = ['archive', 'translate', 'publish', 'review', 'export', 'edit'];
  const refs = units.flatMap((owner) =>
    Array.from({ length: 12 }, (_, i) => {
      const ref = reference(
        `reference.${owner.id}.${i}`,
        `skills/${owner.fields?.name}/references/policy-${i}.md`,
        `Before you ${actions[i % actions.length]} the ${i < 6 ? 'delivery notice' : 'carrier update'} for ${owner.fields?.name}, read the carrier policy.`,
      );
      return ref;
    }),
  );
  const suite = run(
    [hub, ...units, ...refs],
    refs.map((ref) => row(ref.id)),
  );
  expect(suite.report.summary.complete).toBe(288);
  const asks = new Set<string>();
  for (const file of suite.files.filter((file) => file.path.endsWith('.yaml'))) {
    const parsed = parseSpecText(file.text, 'yaml', file.path);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const when = parsed.spec.blocks[0]?.when;
    if (when && 'user' in when) asks.add(when.user);
  }
  expect(asks.size).toBe(288);
  expect([...asks].some((ask) => ask.includes('annual catalogue'))).toBe(false);
  for (const record of suite.specs) {
    const ref = refs.find((ref) => ref.id === record.atoms[0]);
    const expected = units.find((owner) =>
      String(ref?.fields?.path).startsWith(`skills/${owner.fields?.name}/`),
    );
    // The unit owns the reference by folder (its task), and holds it only if the rule is written in its files.
    expect(record.atoms).toEqual([ref?.id]);
    expect(expected).toBeDefined();
  }
});

it('uses the source clause before stale extracted gate metadata', () => {
  const ref = reference(
    'gate.delivery',
    undefined,
    'Before publishing the delivery notice, read the carrier policy.',
  );
  ref.kind = 'gate';
  ref.fields = { ...ref.fields, trigger: 'Prepare the annual catalogue.' };
  const suite = run([hub, shipping, ref], [{ ...row(ref.id), testType: 'ordered_pair' }]);
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(parsed.spec.blocks[0]?.when).toEqual({ user: 'Please publish the delivery notice.' });
});

it('rejects an approved phrase belonging to a different skill despite an explicit reference pin', () => {
  const ref = reference(
    'reference.phrased',
    undefined,
    'Before editing the delivery label, read the carrier policy.',
  );
  const suite = run(
    [hub, shipping, ref],
    [row(ref.id)],
    [
      {
        id: 'wrong-catalogue-task',
        title: 'Catalogue task',
        use: 'trigger',
        atoms: [ref.id, hub.id],
        phrases: [{ text: 'Prepare the annual catalogue.', lang: 'en', approved: true }],
      },
    ],
  );
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(parsed.spec.blocks[0]?.when).toEqual({ user: 'Please edit the delivery label.' });
});

it('a declared tool uses its owning helper situation when other tasks list its permission', () => {
  const helper = {
    ...unit('dispatch-helper', 'Audit delivery manifests for missing parcels.'),
    kind: 'subagent',
    provenance: { file: 'agents/dispatch-helper.md', quote: 'Audit delivery manifests.' },
    evidence: [
      { type: 'tool_called', label: 'Agent', input: { subagent_type: { equals: 'dispatch-helper' } } },
    ],
  } as EstateAtom;
  const tool: EstateAtom = {
    id: 'tool.manifest-search',
    kind: 'tool',
    approved: true,
    title: 'Allow Glob',
    provenance: { file: helper.provenance?.file, quote: 'tools: Glob' },
    fields: { rule: 'Glob', tool: 'Glob', effect: 'allow' },
    evidence: [{ type: 'custom', name: 'permission', options: { effect: 'allow', rule: 'Glob' } }],
  };
  const suite = run(
    [hub, helper, tool],
    [{ ...row(tool.id), testType: 'tool_boundary' }],
    [
      {
        id: 'catalogue',
        title: 'Catalogue task',
        use: 'trigger',
        atoms: [hub.id, tool.id],
        phrases: [{ text: 'Prepare the annual catalogue.', lang: 'en', approved: true }],
      },
      {
        id: 'manifest-audit',
        title: 'Audit task',
        use: 'trigger',
        atoms: [helper.id],
        phrases: [{ text: 'Audit the delivery manifests for missing parcels.', lang: 'en', approved: true }],
      },
    ],
  );
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(parsed.spec.blocks[0]?.when).toEqual({ user: 'Audit the delivery manifests for missing parcels.' });
  expect(suite.specs[0]?.atoms).toEqual([tool.id, helper.id]);
  expect(suite.report.summary.complete).toBe(1);
  expect(suite.report.invalid).toEqual([]);
});
