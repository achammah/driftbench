import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { main } from '../src/index';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const fixtures = join(root, 'examples/acme/prompts');
let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'acme-sections-'));
});
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function cli(args: string[]) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd: dir,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}

it('writes a registry from the headings and checks it against the prompt', async () => {
  const prompt = join(fixtures, 'acme-sales.md');
  const made = await cli([
    'radius',
    'sections',
    'init',
    prompt,
    '--id',
    'acme-sales',
    '--prompt-version',
    'v1',
    '--out',
    'acme-sales.sections.yaml',
  ]);
  expect(made.code).toBe(0);
  expect(made.err).toContain('30 sections, all global');
  const registry = parse(await readFile(join(dir, 'acme-sales.sections.yaml'), 'utf8'));
  expect(registry.sections[0]).toMatchObject({ id: 'who_you_are', scope: 'global' });

  const checked = await cli(['radius', 'sections', 'check', 'acme-sales.sections.yaml', '--prompt', prompt]);
  expect(checked.code).toBe(0);
  expect(checked.out).toContain('30 sections match the prompt');

  await writeFile(join(dir, 'edited.md'), (await readFile(prompt, 'utf8')).replace('English', 'French'));
  const wrong = await cli([
    'radius',
    'sections',
    'check',
    'acme-sales.sections.yaml',
    '--prompt',
    'edited.md',
  ]);
  expect(wrong.code).toBe(1);
  expect(wrong.out).toContain('text_sha256');
}, 60_000);

it('re-anchors on the next prompt version: edited sections stale, the rest moved or kept', async () => {
  const prompt = await readFile(join(fixtures, 'acme-sales.md'), 'utf8');
  await writeFile(join(dir, 'old.md'), prompt);
  await writeFile(
    join(dir, 'new.md'),
    `Acme sales assistant, v2.\n\n${prompt.replace('Always reply in English', 'Always reply in plain English')}`,
  );
  const result = await cli([
    'radius',
    'sections',
    'reanchor',
    join(fixtures, 'acme-sales.sections.yaml'),
    '--prompt',
    'old.md',
    'new.md',
    '--to-version',
    'v2',
    '--out',
    'v2.sections.yaml',
  ]);
  expect(result.code).toBe(1);
  expect(result.out).toContain('acme-sales v1 to v2: 0 kept, 29 moved, 1 stale.');
  expect(result.out).toContain(
    'stale language: neither the text nor the anchor is found once: edited or removed',
  );
  expect(result.out).toContain('changed outside every section, between (start) and identity');
  const next = parse(await readFile(join(dir, 'v2.sections.yaml'), 'utf8'));
  expect(next.version).toBe('v2');
  expect(next.sections.find((section: { id: string }) => section.id === 'language').stale).toBe(true);
  const json = await cli([
    'radius',
    'sections',
    'reanchor',
    join(fixtures, 'acme-sales.sections.yaml'),
    '--prompt',
    'old.md',
    'old.md',
    '--to-version',
    'v1',
    '--json',
  ]);
  expect(json.code).toBe(0);
  expect(
    JSON.parse(json.out).sections.every((section: { status: string }) => section.status === 'kept'),
  ).toBe(true);
}, 60_000);

it('lints prompt-section links against the registries', async () => {
  const spec = {
    id: 'acme-language',
    blocks: [{ id: 'hello', when: { user: 'Hola' }, expect: { must: ['English'] } }],
    metadata: {
      links: [
        {
          block: 'hello',
          to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'language' },
          status: 'declared',
        },
        {
          block: 'hello',
          to: { kind: 'prompt_section', prompt: 'acme-sales', section: 'tone' },
          status: 'declared',
        },
      ],
    },
  };
  await writeFile(join(dir, 'spec.yaml'), stringify(spec));
  const plain = await cli(['spec', 'lint', 'spec.yaml']);
  expect(plain.code).toBe(0);
  const checked = await cli([
    'spec',
    'lint',
    'spec.yaml',
    '--sections',
    join(fixtures, 'acme-sales.sections.yaml'),
  ]);
  expect(checked.code).toBe(1);
  expect(checked.out).toContain(
    'LINK_TARGET_UNKNOWN  the prompt acme-sales (version v1) has no section tone',
  );

  spec.metadata.links.pop();
  await writeFile(join(dir, 'spec.yaml'), stringify(spec));
  const ok = await cli([
    'spec',
    'lint',
    'spec.yaml',
    '--sections',
    join(fixtures, 'acme-sales.sections.yaml'),
  ]);
  expect(ok.code).toBe(0);
  const bad = await cli(['spec', 'lint', 'spec.yaml', '--sections', 'spec.yaml']);
  expect(bad.code).toBe(2);
}, 60_000);

it('derives a prompt_section manifest and prints the advisory selection, running the whole suite', async () => {
  const prompt = await readFile(join(fixtures, 'acme-sales.md'), 'utf8');
  await writeFile(join(dir, 'v1.md'), prompt);
  await writeFile(
    join(dir, 'v2.md'),
    prompt.replace('"sure", "ok" or "go ahead" is not enough', '"sure" or "ok" is enough'),
  );
  const registry = join(fixtures, 'acme-sales.sections.yaml');
  const derived = await cli([
    'radius',
    'sections',
    'reanchor',
    registry,
    '--prompt',
    'v1.md',
    'v2.md',
    '--to-version',
    'v2',
    '--change-out',
    'change.yaml',
  ]);
  expect(derived.code).toBe(1);
  const manifest = parse(await readFile(join(dir, 'change.yaml'), 'utf8'));
  expect(manifest).toMatchObject({
    from: 'v1',
    to: 'v2',
    changes: [{ kind: 'prompt_section', id: 'acme-sales#explicit_confirm' }],
  });
  const specs = join(fixtures, 'linked');
  const advised = await cli(['radius', specs, '--change', 'change.yaml', '--sections', registry]);
  expect(advised.code).toBe(1);
  expect(advised.out).toContain('The radius is the whole suite: prompt_section:acme-sales#explicit_confirm');
  expect(advised.out).toContain('Would run 3 of 7 blocks (2 by links, 1 forward) and would skip 4');
  expect(advised.out).toContain('link:acme-sales#explicit_confirm (declared)');
  const json = JSON.parse(
    (await cli(['radius', specs, '--change', 'change.yaml', '--sections', registry, '--json'])).out,
  );
  expect(json.totals.F.out).toBe(0);
  expect(json.advisory.counts).toEqual({ selected: 3, direct: 2, forward: 1, skipped: 4, total: 7 });
  const plain = await cli(['radius', specs, '--change', 'change.yaml']);
  expect(plain.out).toContain('Pass --sections <registries>');
}, 60_000);
