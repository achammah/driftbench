import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildPlan,
  ClaudeCodeReader,
  renderEstateMap,
  renderPlan,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import { generateEstateSuite, PhraseBank } from '@agent-nexus/driftbench-generate';
import { expect, it } from 'vitest';
import { estate, NOW } from '../../estate/test/support';
import { main } from '../src/index';

it('one generated group covers every source cell, without counting struck rows', async () => {
  const rule = 'Before editing the interview: Read policy.md.';
  const root = await estate({
    'CLAUDE.md': '# Editorial desk',
    '.claude/skills/editorial/SKILL.md': [
      '---',
      'name: editorial',
      'description: Edit an interview for publication.',
      '---',
      '# Editing interviews',
      rule,
      rule,
      rule,
      rule,
    ].join('\n'),
    '.claude/skills/editorial/policy.md': '# Publication policy',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  const plan = buildPlan(map).plan;
  plan.rows = plan.rows.filter(
    (row) => row.testType === 'ordered_pair' && row.id.startsWith('ordered_pair.'),
  );
  expect(plan.rows).toHaveLength(4);
  for (const row of plan.rows) row.status = 'approved';
  const suite = generateEstateSuite(
    {
      map,
      plan,
      bank: PhraseBank.parse({
        version: 1,
        estate: 'editorial',
        mapHash: map.hash,
      }),
    },
    { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
  expect(suite.report.summary.complete).toBe(1);
  expect(suite.report.equivalence.groups[0]?.count).toBe(4);
  const output = join(root, 'output');
  for (const file of suite.files) {
    await mkdir(dirname(join(output, file.path)), { recursive: true });
    await writeFile(join(output, file.path), file.text);
  }
  // Advisory missing-piece notes do not cancel demonstrated coverage.
  const representative = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!representative) throw new Error('no representative');
  await writeFile(
    join(output, representative.path),
    representative.text.replace('    atoms:', '    needs: [{marker: advisory, blocking: false}]\n    atoms:'),
  );
  await writeFile(join(root, 'map.yaml'), renderEstateMap({ ...map, root: '.' }));
  const measure = async () => {
    await writeFile(join(root, 'plan.yaml'), renderPlan(plan));
    let out = '',
      err = '';
    const code = await main(
      [
        'estate',
        'stats',
        '--map',
        join(root, 'map.yaml'),
        '--plan',
        join(root, 'plan.yaml'),
        '--specs',
        output,
        '--json',
      ],
      {
        cwd: root,
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
      },
    );
    expect(err).toBe('');
    expect(code).toBe(0);
    return JSON.parse(out);
  };
  expect((await measure()).coverage.cells).toEqual({ covered: 4, total: 4 });
  const first = plan.rows[0];
  if (!first) throw new Error('no row');
  first.status = 'struck';
  expect((await measure()).coverage.cells).toEqual({ covered: 3, total: 4 });
  for (const row of plan.rows) row.status = 'struck';
  expect((await measure()).coverage.cells).toEqual({ covered: 0, total: 4 });
}, 30_000);
