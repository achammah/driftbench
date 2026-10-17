import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  copyEstate,
  type EstateMap,
  invertText,
  loadEstateMap,
  MutantError,
  mutateEstate,
  parseJsonRanges,
  quoteDrift,
  validateEstateMap,
} from '../../src/index';

/** Estate mutants on a copy of the fictional Northwind fixture. */

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const R3 = 'gate.standing.read-a-file-before-editing-it';
const R7 = 'instruction.standing.tell-the-user-about-a-late';
const WEBFETCH = 'tool.settings.deny-webfetch';

let map: EstateMap;
beforeAll(async () => {
  const loaded = await loadEstateMap(join(FIXTURE, 'approved.yaml'));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  map = loaded.map;
});

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function copy(): Promise<string> {
  const to = await mkdtemp(join(tmpdir(), 'driftbench-mutant-'));
  folders.push(to);
  await copyEstate(FIXTURE, to, map);
  return to;
}

/** Every quote of the mutant map is at its span in the mutant copy, and the map validates with its hash. */
async function consistent(root: string, mutant: EstateMap): Promise<void> {
  expect(validateEstateMap(JSON.parse(JSON.stringify(mutant)))).toMatchObject({ ok: true });
  const texts = new Map<string, string>();
  for (const file of new Set(mutant.atoms.map((atom) => atom.provenance.file))) {
    texts.set(file, await readFile(join(root, file), 'utf8'));
  }
  expect(quoteDrift(mutant.atoms, texts)).toEqual([]);
}

describe('mutateEstate', () => {
  it('deletes an atom by its span: the quote and its emptied line go, later spans move, the hash changes', async () => {
    const root = await copy();
    const result = await mutateEstate({ root, map }, { delete: R3 });
    const text = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(text).not.toContain('Read a file before you edit it.');
    expect(text).not.toContain('**R3.**');
    expect(text).toContain('- **R4.** Never delete a file under `ledger/`');
    expect(result.before).toBe('- **R3.** Read a file before you edit it.');
    expect(result.mapHash).not.toBe(map.hash);
    expect(result.originalMapHash).toBe(map.hash);
    expect(result.map.atoms.some((atom) => atom.id === R3)).toBe(false);
    expect(result.map.atoms).toHaveLength(map.atoms.length - 1);
    expect(result.map.edges.some((edge) => edge.from === R3 || edge.to === R3)).toBe(false);
    const r4 = result.map.atoms.find(
      (atom) => atom.id === 'instruction.standing.never-delete-a-ledger-file-archive',
    );
    expect(r4?.provenance.startLine).toBe(11);
    expect(result.collateral).toEqual([]);
    await consistent(root, result.map);
  });

  it('refuses to delete a skill name line that equals the folder name: an equivalent mutant, nothing written', async () => {
    const root = await copy();
    const skill = '.claude/skills/invoice-reconcile/SKILL.md';
    const before = await readFile(join(root, skill), 'utf8');
    await expect(
      mutateEstate({ root, map }, { delete: 'skill.invoice-reconcile.skill-invoice-reconcile' }),
    ).rejects.toThrow(/equivalent mutant.*folder/);
    expect(await readFile(join(root, skill), 'utf8')).toBe(before);
  });

  it('inverts an obligation by the table of forms, in place, the line count kept', async () => {
    const root = await copy();
    const original = await readFile(join(FIXTURE, 'CLAUDE.md'), 'utf8');
    const result = await mutateEstate({ root, map }, { invert: R7 });
    const text = await readFile(join(root, 'CLAUDE.md'), 'utf8');
    expect(result.after).toBe(
      '- **R7.** When a shipment is late by more than two days, do not tell the user and propose a supplier email.',
    );
    expect(text.split('\n')).toHaveLength(original.split('\n').length);
    const atom = result.map.atoms.find((candidate) => candidate.id === R7);
    expect(atom?.provenance.quote).toBe(
      'When a shipment is late by more than two days, do not tell the user and propose a supplier email.',
    );
    expect(result.mapHash).not.toBe(map.hash);
    await consistent(root, result.map);
  });

  it('deletes a value from a JSON list and leaves the file JSON', async () => {
    const root = await copy();
    const result = await mutateEstate({ root, map }, { delete: WEBFETCH });
    const settings = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8'));
    expect(settings.permissions.deny).toEqual(['Bash(git push --force:*)', 'Bash(rm -rf:*)']);
    await consistent(root, result.map);
  });

  it('gives the same hash for the same mutation of the same estate', async () => {
    const first = await mutateEstate({ root: await copy(), map }, { invert: R7 });
    const second = await mutateEstate({ root: await copy(), map }, { invert: R7 });
    expect(first.mapHash).toBe(second.mapHash);
  });

  it('refuses to invert what is not a prose obligation, an unknown atom, and a copy that drifted', async () => {
    const root = await copy();
    await expect(mutateEstate({ root, map }, { invert: WEBFETCH })).rejects.toBeInstanceOf(MutantError);
    await expect(mutateEstate({ root, map }, { delete: 'no.such.atom' })).rejects.toThrow('not in the map');
    await writeFile(join(root, 'CLAUDE.md'), '# Another estate\n');
    await expect(mutateEstate({ root, map }, { delete: R3 })).rejects.toThrow('no longer at CLAUDE.md');
  });

  it('copies the estate files alone, not the maps, specs and sessions beside them', async () => {
    const root = await copy();
    const { readdir } = await import('node:fs/promises');
    // The estate configuration (helper executors, script fixtures) travels with the copy; the maps and specs do not.
    expect((await readdir(root)).sort()).toEqual(['.claude', 'CLAUDE.md', 'driftbench.estate.yaml']);
  });
});

describe('invertText', () => {
  it.each([
    ['Never run `git push --force` on any branch.', 'Always run `git push --force` on any branch.'],
    [
      'Always answer in the language of the latest message.',
      'Never answer in the language of the latest message.',
    ],
    ['Do not invent order numbers.', 'Invent order numbers.'],
    ["Don't paste the token.", 'Paste the token.'],
    ['The brief must name the files.', 'The brief must not name the files.'],
    ['The brief must not name the files.', 'The brief must name the files.'],
    ['When the user says stop, stop all work.', 'When the user says stop, do not stop all work.'],
    [
      'Before editing any invoice file: Read the rules.',
      'Before editing any invoice file: do not read the rules.',
    ],
    ['If a tool fails twice, never retry it.', 'If a tool fails twice, always retry it.'],
    ['Read a file before you edit it.', 'Do not read a file before you edit it.'],
    ['- **R9.** Ask at most one question per reply.', '- **R9.** Do not ask at most one question per reply.'],
  ])('%s', (text, inverted) => {
    expect(invertText(text)).toBe(inverted);
  });

  it.each([['"WebFetch"'], ['name: invoice-reconcile'], ['Edit'], ['$CLAUDE_PROJECT_DIR/x.sh']])(
    'refuses %s',
    (text) => {
      expect(invertText(text)).toBeUndefined();
    },
  );
});

describe('a delete in a JSON file, structurally', () => {
  const CASES = fileURLToPath(new URL('../../../../examples/estates/reader-cases/', import.meta.url));

  async function casesCopy(): Promise<{ root: string; map: EstateMap }> {
    const loaded = await loadEstateMap(join(CASES, 'approved.yaml'));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
    const root = await mkdtemp(join(tmpdir(), 'driftbench-mutant-json-'));
    folders.push(root);
    await copyEstate(CASES, root, loaded.map);
    return { root, map: loaded.map };
  }

  it('deletes a script atom with its file: the mention goes, and so does the script it names', async () => {
    const root = await copy();
    const id = 'script.invoice-reconcile.script-scripts-reconcile-py';
    const script = '.claude/skills/invoice-reconcile/scripts/reconcile.py';
    expect(existsSync(join(root, script))).toBe(true);
    const result = await mutateEstate({ root, map }, { delete: id });
    expect(await readFile(join(root, '.claude/skills/invoice-reconcile/SKILL.md'), 'utf8')).not.toContain(
      'scripts/reconcile.py <invoice> <order>',
    );
    expect(existsSync(join(root, script))).toBe(false);
    expect(result.removed).toEqual([script]);
    expect(result.collateral).toEqual(['instruction.invoice-reconcile.run-the-reconcile-script-and-show']);
  });

  it('deletes a settings guard by its whole entry, and an environment key by its member', async () => {
    const guard = await casesCopy();
    const result = await mutateEstate(guard, {
      delete: 'guard.settings.pretooluse-bash-guard-block-force-push',
    });
    const settings = JSON.parse(await readFile(join(guard.root, '.claude/settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse[0].hooks).toEqual([]);
    expect(settings.hooks.Stop[0].hooks).toHaveLength(1);
    expect(result.map.atoms.some((atom) => atom.id === result.atom)).toBe(false);
    expect(result.collateral).toEqual(['invariant.settings.every-guard-finds-its-script-from']);

    const env = await casesCopy();
    await mutateEstate(env, { delete: 'setting.settings.setting-env-northwind-region' });
    const after = JSON.parse(await readFile(join(env.root, '.claude/settings.json'), 'utf8'));
    expect(after.env).toEqual({});
    expect(after.model).toBe('opus');
  });

  it('empties a JSON document whose quote only the whole document holds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-mutant-root-'));
    folders.push(root);
    const atom = {
      ...map.atoms[0],
      id: 'invariant.registry.the-registry',
      kind: 'invariant',
      provenance: { file: '.claude/hooks/CATALOGUE.json', startLine: 1, endLine: 1, quote: '{', hash: '' },
    } as EstateMap['atoms'][number];
    await mkdir(join(root, '.claude/hooks'), { recursive: true });
    await writeFile(
      join(root, '.claude/hooks/CATALOGUE.json'),
      '{\n  "checks": [{ "id": "K1", "event": "Stop", "status": "enforce" }]\n}\n',
    );
    const result = await mutateEstate(
      { root, map: { ...map, atoms: [atom], edges: [] } },
      { delete: atom.id },
    );
    expect(await readFile(join(root, '.claude/hooks/CATALOGUE.json'), 'utf8')).toBe('{}\n');
    expect(result.op).toBe('delete');
  });

  it('reads the offsets of every JSON value, and refuses a text that is not JSON', () => {
    const text = '{ "a": [1, "two", { "b": null }], "c": true }';
    const root = parseJsonRanges(text);
    expect(root?.elements.map((element) => text.slice(element.start, element.end))).toEqual([
      '"a": [1, "two", { "b": null }]',
      '"c": true',
    ]);
    expect(parseJsonRanges('{ "a": }')).toBeUndefined();
    expect(parseJsonRanges('[1, 2] 3')).toBeUndefined();
  });
});
