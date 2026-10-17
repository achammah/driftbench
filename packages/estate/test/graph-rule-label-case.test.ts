import { describe, expect, it } from 'vitest';
import { AtomBuilder, buildGraph, ClaudeCodeReader, codeAtoms, labelOfLine } from '../src/index';
import { estate } from './support';

const rules = ['Never erase the parcel archive.', 'Always record the parcel count.'];

async function enforcedBy(options: {
  labels?: string[];
  registry?: string;
  json?: unknown;
  script?: string;
}) {
  const labels = options.labels ?? ['R1', 'AB2'];
  const files: Record<string, string> = {
    'CLAUDE.md': rules.map((rule, index) => `- **${labels[index]}.** ${rule}`).join('\n'),
    '.claude/settings.json': JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/guards/check.sh' }] }],
      },
    }),
    '.claude/guards/check.sh': options.script ?? '#!/bin/sh\nexit 0\n',
  };
  if (options.registry) files['.claude/guards/REGISTRY.md'] = options.registry;
  if (options.json) files['.claude/guards/registry.json'] = JSON.stringify(options.json);
  const root = await estate(files);
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  for (const [index, quote] of rules.entries()) {
    builder.add({
      kind: 'instruction',
      title: `Parcel rule ${index + 1}`,
      at: { file: 'CLAUDE.md', startLine: index + 1, endLine: index + 1, quote },
      evidence: [{ type: 'custom', name: 'obey-rule' }],
    });
  }
  return [...buildGraph(builder.atoms, raw).enforces.values()].flat();
}

const registry = (ids: string) => `| Id | Guard | Enforces |\n|---|---|---|\n| G1 | check.sh | ${ids} |\n`;

describe('explicit rule labels are case insensitive', () => {
  it.each([
    ['- **r1.** Read the parcel.', 'R1'],
    ['**aB#2.** Count the parcel.', 'AB2'],
    ['R3. Store the parcel.', 'R3'],
  ])('normalizes a definition label: %s', (line, expected) => {
    expect(labelOfLine(line)).toBe(expected);
  });

  it.each(['The parcel r1 is missing.', 'version v2 is published.', 'Report R1 is archived.'])(
    'does not find a definition label in ordinary prose: %s',
    (line) => {
      expect(labelOfLine(line)).toBeUndefined();
    },
  );

  it('connects lowercase and mixed-case markdown registry IDs to uppercase definitions', async () => {
    expect(await enforcedBy({ registry: registry('r1, aB2') })).toHaveLength(2);
  });

  it('connects uppercase markdown registry IDs to lowercase definitions', async () => {
    expect(await enforcedBy({ labels: ['r1', 'ab2'], registry: registry('R1, AB2') })).toHaveLength(2);
  });

  it('normalizes explicit JSON IDs including the hash spelling', async () => {
    expect(
      await enforcedBy({
        json: { checks: [{ id: 'G1', guard: 'check.sh', enforces: [{ id: 'r#1' }, { id: 'aB2' }] }] },
      }),
    ).toHaveLength(2);
  });

  it('normalizes IDs in an explicit Enforces declaration', async () => {
    expect(await enforcedBy({ script: '#!/bin/sh\n# Enforces: r1, aB2\nexit 0\n' })).toHaveLength(2);
  });

  it('normalizes explicit hash citations in a guard message', async () => {
    expect(await enforcedBy({ script: '#!/bin/sh\necho "blocked (r#1, aB#2)"\nexit 2\n' })).toHaveLength(2);
  });

  it('does not infer guard IDs from unrelated lowercase prose', async () => {
    expect(
      await enforcedBy({ script: '#!/bin/sh\necho "parcel r1 and ab2 await review"\nexit 0\n' }),
    ).toEqual([]);
  });
});
