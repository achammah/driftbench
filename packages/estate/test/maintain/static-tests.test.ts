import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffEstateMaps, estateImpact, loadEstateTests, writeRetirements } from '../../src/index';
import { estate } from '../support';
import { atom, estateMap } from './support';

const record = (id: string, atomId: string, key: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify(
    {
      id,
      planRow: `row.${atomId}`,
      testType: 'setting',
      atom: atomId,
      title: `Setting ${key}`,
      check: { kind: 'setting', key },
      mapHash: 'a'.repeat(64),
      ...extra,
    },
    null,
    2,
  )}\n`;

const settings = (keys: string[]) =>
  estateMap(
    keys.map((key, index) =>
      atom(`setting.settings.${key}`, `"${key}": "x"`, {
        kind: 'setting',
        file: '.claude/settings.json',
        line: 4 + index,
      }),
    ),
  );

describe('static tests are tests', () => {
  it('retires the record of a removed setting, writes the reason, and leaves a kept setting alone', async () => {
    const root = await estate({
      'suite/static/setting/a.json': record('t-a', 'setting.settings.alpha', 'env.alpha'),
      'suite/static/setting/b.json': record('t-b', 'setting.settings.beta', 'env.beta'),
      'suite/static/notes.json': '{"unrelated": true}\n',
    });
    const dir = join(root, 'suite');
    const loaded = await loadEstateTests(dir);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    expect(loaded.tests.map((test) => [test.id, test.atoms])).toEqual([
      ['t-a', ['setting.settings.alpha']],
      ['t-b', ['setting.settings.beta']],
    ]);

    const report = estateImpact(
      diffEstateMaps(settings(['alpha', 'beta']), settings(['beta'])),
      loaded.tests,
    );
    expect(report.retire.map((entry) => [entry.test, entry.state])).toEqual([['t-a', 'to_write']]);
    expect(report.unaffected.tests).toBe(1);

    expect(await writeRetirements(report, loaded.tests)).toEqual([
      { file: 'static/setting/a.json', ok: true },
    ]);
    const written = JSON.parse(await readFile(join(dir, 'static/setting/a.json'), 'utf8'));
    expect(written.retired).toBe('atom setting.settings.alpha removed');
    expect(written.check).toEqual({ kind: 'setting', key: 'env.alpha' });

    const again = await loadEstateTests(dir);
    if (!again.ok) throw new Error('reload failed');
    const second = estateImpact(diffEstateMaps(settings(['alpha', 'beta']), settings(['beta'])), again.tests);
    expect(second.retire.map((entry) => entry.state)).toEqual(['already']);
    expect(second.tests.retired).toBe(1);
  });
});
