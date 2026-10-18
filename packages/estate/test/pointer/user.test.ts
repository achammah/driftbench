import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Cassette,
  createHttpLabeler,
  httpLabelerId,
  LabelerConfigError,
  LabelerError,
  type LabelSet,
  loadModuleLabeler,
  pointerScan,
  questionKey,
  singleLabelling,
  userAnswer,
  userRequest,
} from '../../src/pointer';
import { BAKERY, type Call, fakeFetch, load, windowOf } from './support';

const [BAKE] = load(BAKERY) as [LabelSet];
const GATED = load(
  `${BAKERY.replace('examples: ["Allergen details are on the label."]', 'atom: { kind: instruction }')}`,
)[0] as LabelSet;

describe('what a user labeler is sent', () => {
  it('sends a system 2 labeler the set, the window and the ready dense prompt, without the estate mapping', () => {
    const body = userRequest('system2', GATED, windowOf(2), false) as {
      set: { name: string; labels: Array<Record<string, unknown>> };
      window: { id: string; units: Array<{ n: number; text: string }> };
      prompt: { system: string; user: string };
    };
    expect(body.set.name).toBe('counter-voice');
    expect(JSON.stringify(body.set)).not.toContain('atom');
    expect(body.window.units.map((unit) => unit.n)).toEqual([1, 2]);
    expect(body.prompt.user).toContain('[2] Line 2 wrapped');
    expect(body.prompt.system).toContain('You label numbered units');
  });

  it('sends a system 1 labeler the numbered text and one question per unit and label', () => {
    const body = userRequest('system1', BAKE, windowOf(2), false) as {
      state: string;
      questions: Record<string, string>;
    };
    expect(body.state).toContain('[1] Line 1 wrapped');
    expect(Object.keys(body.questions)).toHaveLength(6);
    expect(body.questions[questionKey(2, 'greeting')]).toContain('Does this label apply to unit [2]');
  });
});

describe('what a user labeler answers', () => {
  it('reads labels for system 2 and probabilities for system 1, with the model and the usage when given', () => {
    expect(
      userAnswer(
        'system2',
        {
          labels: [{ units: '1', label: 'greeting' }],
          model: 'mine-2',
          usage: { input_tokens: 5, output_tokens: 2 },
        },
        'mine',
      ),
    ).toEqual({
      labels: [{ units: '1', label: 'greeting' }],
      returnedModel: 'mine-2',
      stopReason: 'answered',
      usage: { input: 5, output: 2 },
    });
    expect(userAnswer('system1', { probabilities: { a: 0.5, b: 7 } }, 'mine')).toEqual({
      probabilities: { a: 0.5 },
      returnedModel: 'mine',
      stopReason: 'answered',
      usage: { input: 0, output: 0 },
    });
  });

  it('refuses an answer that is not the shape of its class', () => {
    expect(() => userAnswer('system2', 'text', 'm')).toThrow(LabelerError);
    expect(() => userAnswer('system2', { probabilities: {} }, 'm')).toThrow(/no labels list/);
    expect(() => userAnswer('system1', { labels: [] }, 'm')).toThrow(/no probabilities object/);
  });
});

describe('an HTTP labeler', () => {
  const url = 'https://labels.example.test/v1/label?token=very-secret';

  it('has an id of the hash of its address, so a secret in the address never reaches a cassette', () => {
    const labeler = createHttpLabeler({ url, cls: 'system2', replayOnly: true });
    expect(labeler.id).toBe(httpLabelerId(url));
    expect(labeler.id).toMatch(/^http:[0-9a-f]{12}$/);
    expect(JSON.stringify([labeler.render(BAKE, windowOf(1)).labeler, labeler.model])).not.toContain(
      'secret',
    );
    expect(httpLabelerId(`${url}x`)).not.toBe(labeler.id);
  });

  it('posts the request with a bearer token from the variable it names, and reads the answer', async () => {
    const calls: Call[] = [];
    const labeler = createHttpLabeler({
      url,
      cls: 'system2',
      keyVariable: 'MY_LABELER_KEY',
      env: { MY_LABELER_KEY: 'k-secret' },
      fetch: fakeFetch({ labels: [{ units: '1-2', label: 'greeting' }] }, calls),
    });
    const wire = labeler.render(BAKE, windowOf(2));
    const answer = await labeler.call?.(wire, BAKE, windowOf(2));
    expect(calls[0]?.url).toBe(url);
    expect(calls[0]?.headers.authorization).toBe('Bearer k-secret');
    expect(calls[0]?.body).toEqual(wire.body);
    expect(answer?.labels).toEqual([{ units: '1-2', label: 'greeting' }]);
  });

  it('refuses a variable that is not set, an address that is no URL and a scheme that is not http', () => {
    expect(() => createHttpLabeler({ url, cls: 'system2', keyVariable: 'NOPE', env: {} })).toThrow(
      LabelerConfigError,
    );
    expect(() => createHttpLabeler({ url: 'not a url', cls: 'system2', replayOnly: true })).toThrow(
      /is no URL/,
    );
    expect(() => createHttpLabeler({ url: 'ftp://x.test/', cls: 'system2', replayOnly: true })).toThrow(
      /http or https/,
    );
  });

  it('is recorded in the cassette and replayed from it with no endpoint', async () => {
    const calls: Call[] = [];
    const files = [
      { path: 'notes.md', text: '# Notes\n\n- Say good morning first\n- A loaf costs two coins\n' },
    ];
    const answer = {
      labels: [
        { units: '1', label: 'none' },
        { units: '2', label: 'greeting' },
        { units: '3', label: 'price-claim' },
      ],
    };
    const cassette = new Cassette();
    const live = createHttpLabeler({ url, cls: 'system2', fetch: fakeFetch(answer, calls) });
    const first = await pointerScan({
      files,
      sets: [BAKE],
      labelling: singleLabelling(live),
      cassette,
      mode: 'record',
    });
    expect(calls).toHaveLength(1);
    expect(first.labelled.map((item) => item.label)).toEqual(['greeting', 'price-claim']);
    // Every cassette key holds the id of the labeler.
    expect([...cassette.entries.values()].every((entry) => entry.readable.labeler === live.id)).toBe(true);

    const replay = await pointerScan({
      files,
      sets: [BAKE],
      labelling: singleLabelling(createHttpLabeler({ url, cls: 'system2', replayOnly: true })),
      cassette: Cassette.parse(cassette.render()),
      mode: 'replay',
    });
    expect(replay.calls).toBe(0);
    expect(replay.labelled.map((item) => item.label)).toEqual(['greeting', 'price-claim']);
    // Another endpoint is another labeler: the same cassette does not answer for it.
    await expect(
      pointerScan({
        files,
        sets: [BAKE],
        labelling: singleLabelling(
          createHttpLabeler({ url: 'https://other.example.test/', cls: 'system2', replayOnly: true }),
        ),
        cassette: Cassette.parse(cassette.render()),
        mode: 'replay',
      }),
    ).rejects.toThrow(/no answer for request/);
  });
});

describe('a labeler module', () => {
  async function module(source: string): Promise<{ dir: string; file: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-labeler-'));
    const file = join(dir, 'labeler.mjs');
    await writeFile(file, source);
    return { dir, file };
  }

  const SYSTEM2 = `export default {
    id: 'house-rules',
    cls: 'system2',
    model: 'rules-1',
    label(request) {
      return { labels: request.window.units.map((unit) => ({ units: String(unit.n), label: /morning/.test(unit.text) ? 'greeting' : 'none' })) };
    },
  };`;

  it('loads an object, calls its label function and puts its id in the labeler', async () => {
    const { dir } = await module(SYSTEM2);
    const labeler = await loadModuleLabeler('./labeler.mjs', { cwd: dir });
    expect([labeler.id, labeler.cls, labeler.model]).toEqual(['module:house-rules', 'system2', 'rules-1']);
    const window = {
      ...windowOf(2),
      units: [
        { n: 1, text: 'Say good morning', index: 0 },
        { n: 2, text: 'Weigh the flour', index: 1 },
      ],
    };
    const answer = await labeler.call?.(labeler.render(BAKE, window), BAKE, window);
    expect(answer?.labels).toEqual([
      { units: '1', label: 'greeting' },
      { units: '2', label: 'none' },
    ]);
  });

  it('loads a factory that receives the options of the scan', async () => {
    const { dir } = await module(`export default (options) => ({
      id: 'factory', cls: 'system1',
      label: (request) => ({ probabilities: Object.fromEntries(Object.keys(request.questions).map((key) => [key, options.threshold ?? 0])) }),
    });`);
    const labeler = await loadModuleLabeler('./labeler.mjs', { cwd: dir, threshold: 0.9 });
    expect(labeler.cls).toBe('system1');
    expect(labeler.settings).toEqual({ threshold: 0.9 });
    const answer = await labeler.call?.(labeler.render(BAKE, windowOf(1)), BAKE, windowOf(1));
    expect(Object.values(answer?.probabilities ?? {})).toEqual([0.9, 0.9, 0.9]);
  });

  it('replays with no call when it is not asked to record', async () => {
    const { dir } = await module(SYSTEM2);
    const labeler = await loadModuleLabeler('./labeler.mjs', { cwd: dir, replayOnly: true });
    expect(labeler.call).toBeUndefined();
    expect(labeler.id).toBe('module:house-rules');
  });

  it('refuses a module that is missing, has no default export, a bad id, a bad class or no label function', async () => {
    const dir = (await module('')).dir;
    await expect(loadModuleLabeler('./none.mjs', { cwd: dir })).rejects.toThrow(
      /cannot load the labeler module/,
    );
    const bad = async (source: string) => {
      const made = await module(source);
      return loadModuleLabeler('./labeler.mjs', { cwd: made.dir });
    };
    await expect(bad('export const x = 1;')).rejects.toThrow(/no default export/);
    await expect(bad("export default { id: 'a b', cls: 'system2', label() {} };")).rejects.toThrow(
      /an id of letters/,
    );
    await expect(bad("export default { id: 'ok', cls: 'system3', label() {} };")).rejects.toThrow(
      /cls: system1 or system2/,
    );
    await expect(bad("export default { id: 'ok', cls: 'system2' };")).rejects.toThrow(/label function/);
  });

  it('is recorded in the cassette and replayed from it', async () => {
    const { dir } = await module(SYSTEM2);
    const files = [{ path: 'notes.md', text: '# Notes\n\n- Say good morning first\n- Weigh the flour\n' }];
    const cassette = new Cassette();
    const first = await pointerScan({
      files,
      sets: [BAKE],
      labelling: singleLabelling(await loadModuleLabeler('./labeler.mjs', { cwd: dir })),
      cassette,
      mode: 'record',
    });
    expect(first.labelled.map((item) => item.label)).toEqual(['greeting']);
    const replay = await pointerScan({
      files,
      sets: [BAKE],
      labelling: singleLabelling(await loadModuleLabeler('./labeler.mjs', { cwd: dir, replayOnly: true })),
      cassette: Cassette.parse(cassette.render()),
      mode: 'replay',
    });
    expect(replay.calls).toBe(0);
    expect(replay.labelled.map((item) => item.label)).toEqual(['greeting']);
  });
});
