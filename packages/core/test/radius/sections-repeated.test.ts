import { describe, expect, it } from 'vitest';
import {
  checkSectionRegistry,
  parseSectionRegistry,
  reanchorRegistry,
  type SectionRegistry,
  sectionsFromHeadings,
} from '../../src/radius/sections';

// Invented lighthouse prompts. Every heading and sentence below is made up for these tests.

const CHART = '## Chart room\nKeep the chart dry and the lamp trimmed.\n';
const MOORINGS = '## Moorings\nTie off fore and aft.\n';
const SIGNALS = '## Signals\nFlash the lamp twice for a vessel in distress.\n';
const PROMPT = [MOORINGS, CHART, SIGNALS, CHART].join('\n');

function register(text: string): SectionRegistry {
  const built = sectionsFromHeadings(text, { promptId: 'lighthouse', version: 'v1' });
  if (!built.ok) throw new Error(built.errors.join('\n'));
  expect(checkSectionRegistry(built.registry, text)).toEqual([]);
  return built.registry;
}

function reanchor(registry: SectionRegistry, before: string, after: string) {
  const result = reanchorRegistry(registry, before, after, 'v2');
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.result;
}

const section = (registry: SectionRegistry, id: string) => {
  const found = registry.sections.find((each) => each.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
};

/** The text of the prompt that no section covers, white space aside: init must leave none. */
function uncovered(registry: SectionRegistry, text: string): string {
  let rest = '';
  let cursor = 0;
  for (const each of [...registry.sections].sort((a, b) => a.span.start - b.span.start)) {
    rest += text.slice(cursor, each.span.start);
    cursor = each.span.end;
  }
  return (rest + text.slice(cursor)).trim();
}

describe('sections init keeps identical sections apart', () => {
  it('gives two identical sections their own ids and an anchor that names the copy', () => {
    const registry = register(PROMPT);
    expect(registry.sections.map((each) => each.id)).toEqual([
      'moorings',
      'chart_room',
      'signals',
      'chart_room_2',
    ]);
    expect(registry.sections.map((each) => each.title)).toEqual([
      'Moorings',
      'Chart room',
      'Signals',
      'Chart room',
    ]);
    expect(section(registry, 'chart_room').anchor.occurrence).toBe(1);
    expect(section(registry, 'chart_room_2').anchor.occurrence).toBe(2);
    expect(section(registry, 'moorings').anchor.occurrence).toBeUndefined();
    expect(section(registry, 'signals').anchor.occurrence).toBeUndefined();
    expect(uncovered(registry, PROMPT)).toBe('');
  });

  it('anchors each copy on its own text: the quote is found as many times as there are copies', () => {
    const registry = register(PROMPT);
    for (const id of ['chart_room', 'chart_room_2']) {
      const { quote, occurrence } = section(registry, id).anchor;
      expect(PROMPT.split(quote).length - 1, id).toBe(2);
      const at = PROMPT.indexOf(quote, occurrence === 2 ? PROMPT.indexOf(quote) + 1 : 0);
      expect(at, id).toBeGreaterThanOrEqual(section(registry, id).span.start);
      expect(at + quote.length, id).toBeLessThanOrEqual(section(registry, id).span.end);
    }
  });

  it('extends the quote past a look-alike section, so it is found only in the copies', () => {
    const lookAlike = '## Dusk\nKeep the chart dry and the lamp trimmed at dusk, when the fog rolls in.\n';
    const text = [CHART, lookAlike, CHART].join('\n');
    const registry = register(text);
    expect(registry.sections.map((each) => each.id)).toEqual(['chart_room', 'dusk', 'chart_room_2']);
    for (const id of ['chart_room', 'chart_room_2']) {
      const { quote } = section(registry, id).anchor;
      expect(text.split(quote).length - 1, id).toBe(2);
    }
    expect(section(registry, 'dusk').anchor.occurrence).toBeUndefined();
  });

  it('numbers three copies 1, 2 and 3 and ids them by occurrence', () => {
    const text = `${CHART}\n${CHART}\n${CHART}`;
    const registry = register(text);
    expect(registry.sections.map((each) => each.id)).toEqual(['chart_room', 'chart_room_2', 'chart_room_3']);
    expect(registry.sections.map((each) => each.anchor.occurrence)).toEqual([1, 2, 3]);
  });

  it('keeps copies that sit next to each other', () => {
    const registry = register(`${CHART}${CHART}${MOORINGS}`);
    expect(registry.sections.map((each) => each.id)).toEqual(['chart_room', 'chart_room_2', 'moorings']);
    expect(registry.sections.map((each) => each.anchor.occurrence)).toEqual([1, 2, undefined]);
  });

  it('leaves a quote of its own to a copy whose heading differs, with no occurrence', () => {
    const registry = register('## Notes\nLog the tide at noon.\n\n## NOTES\nLog the tide at noon.\n');
    expect(registry.sections.map((each) => each.id)).toEqual(['notes', 'notes_2']);
    expect(registry.sections.map((each) => each.anchor.occurrence)).toEqual([undefined, undefined]);
  });

  it('takes the next free id when a repeat suffix meets another title', () => {
    const registry = register(
      '# T\nLog the tide at noon.\n# T\nLog the tide at noon.\n# T 2\nCheck the glass.\n',
    );
    expect(registry.sections.map((each) => each.id)).toEqual(['t', 't_2', 't_2_2']);
    expect(registry.sections.map((each) => each.anchor.occurrence)).toEqual([1, 2, undefined]);
  });

  it('keeps a repeated heading that has no body', () => {
    const registry = register('## Notes\n## Notes\nLog the tide at noon.\n');
    expect(registry.sections.map((each) => each.id)).toEqual(['notes', 'notes_2']);
    expect(section(registry, 'notes').anchor.occurrence).toBe(1);
  });

  it('keeps identical setext sections apart too', () => {
    const text =
      'Chart room\n==========\nKeep the chart dry.\n\nSignals\n-------\nFlash twice.\n\nChart room\n==========\nKeep the chart dry.\n';
    const registry = register(text);
    expect(registry.sections.map((each) => each.id)).toEqual(['chart_room', 'signals', 'chart_room_2']);
    expect(uncovered(registry, text)).toBe('');
  });

  it('still folds a section that has no word of its own', () => {
    const registry = register('## Tides\nRead the gauge twice.\n##\n##\n');
    expect(registry.sections.map((each) => each.id)).toEqual(['tides']);
  });
});

describe('sections check reads the occurrence', () => {
  it('passes as written, and names a repeated quote that has no occurrence', () => {
    const registry = register(PROMPT);
    const bare = structuredClone(registry);
    delete section(bare, 'chart_room_2').anchor.occurrence;
    expect(checkSectionRegistry(bare, PROMPT)).toEqual([
      'chart_room_2: the anchor quote is found 2 times, not once',
    ]);
  });

  it('reports an occurrence that points at another copy or past the last one', () => {
    const registry = register(PROMPT);
    const wrong = structuredClone(registry);
    section(wrong, 'chart_room_2').anchor.occurrence = 1;
    expect(checkSectionRegistry(wrong, PROMPT)).toEqual([
      'chart_room_2: occurrence 1 of the anchor quote lies outside the section',
    ]);
    const past = structuredClone(registry);
    section(past, 'chart_room_2').anchor.occurrence = 3;
    expect(checkSectionRegistry(past, PROMPT)).toEqual([
      'chart_room_2: the anchor quote is found 2 times, so it has no occurrence 3',
    ]);
  });

  it('refuses an occurrence that is not a whole number from 1', () => {
    const registry = register(PROMPT);
    for (const bad of [0, -1, 1.5]) {
      const value = structuredClone(registry);
      section(value, 'chart_room_2').anchor.occurrence = bad;
      expect(parseSectionRegistry(value).ok, String(bad)).toBe(false);
    }
    expect(parseSectionRegistry(structuredClone(registry)).ok).toBe(true);
  });
});

describe('sections reanchor keeps identical sections apart', () => {
  it('finds both copies after text is inserted above them, each at its own place', () => {
    const registry = register(PROMPT);
    const next = `## Weather\nRead the glass at dawn.\n\n${PROMPT}`;
    const made = reanchor(registry, PROMPT, next);
    const first = made.sections.find((each) => each.id === 'chart_room');
    const second = made.sections.find((each) => each.id === 'chart_room_2');
    expect(first).toMatchObject({ status: 'moved', method: 'occurrence' });
    expect(second).toMatchObject({ status: 'moved', method: 'occurrence' });
    expect(first?.to?.start).toBe(next.indexOf(CHART));
    expect(second?.to?.start).toBe(next.lastIndexOf(CHART));
    expect(made.sections.filter((each) => each.status === 'stale')).toEqual([]);
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('writes the occurrence of the new text when the inserted text holds the quote too', () => {
    const registry = register(PROMPT);
    const next = `Note: Keep the chart dry and the lamp trimmed.\n\n${PROMPT}`;
    const made = reanchor(registry, PROMPT, next);
    expect(made.sections.filter((each) => each.status === 'stale')).toEqual([]);
    expect(section(made.registry, 'chart_room').anchor.occurrence).toBe(2);
    expect(section(made.registry, 'chart_room_2').anchor.occurrence).toBe(3);
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('keeps the first copy where it is and moves the second when text is inserted between them', () => {
    const registry = register(PROMPT);
    const at = PROMPT.lastIndexOf(CHART);
    const next = `${PROMPT.slice(0, at)}## Weather\nRead the glass at dawn.\n\n${PROMPT.slice(at)}`;
    const made = reanchor(registry, PROMPT, next);
    expect(made.sections.find((each) => each.id === 'chart_room')).toMatchObject({ status: 'kept' });
    expect(made.sections.find((each) => each.id === 'chart_room_2')).toMatchObject({
      status: 'moved',
      method: 'occurrence',
    });
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('keeps three copies in order at every insertion point', () => {
    const text = [MOORINGS, CHART, SIGNALS, CHART, CHART].join('\n');
    const registry = register(text);
    const old = (id: string) => section(registry, id).span;
    for (const where of [0, ...registry.sections.map((each) => each.span.start)]) {
      const added = '## Weather\nRead the glass at dawn.\n\n';
      const next = text.slice(0, where) + added + text.slice(where);
      const made = reanchor(registry, text, next);
      for (const each of registry.sections) {
        const moved = made.sections.find((entry) => entry.id === each.id);
        const shift = old(each.id).start >= where ? added.length : 0;
        expect(moved?.to?.start, `${each.id} after an insertion at ${where}`).toBe(
          old(each.id).start + shift,
        );
      }
      expect(checkSectionRegistry(made.registry, next), `insertion at ${where}`).toEqual([]);
    }
  });

  it('finds the copy whose surroundings survive when the other copy is edited', () => {
    const registry = register(PROMPT);
    const at = PROMPT.lastIndexOf(CHART);
    const next = `${PROMPT.slice(0, at)}${CHART.replace('trimmed.', 'trimmed daily.')}`;
    const made = reanchor(registry, PROMPT, next);
    expect(made.sections.find((each) => each.id === 'chart_room')).toMatchObject({
      status: 'kept',
      method: 'window',
    });
    expect(made.sections.find((each) => each.id === 'chart_room_2')).toMatchObject({
      status: 'stale',
      reason: expect.stringContaining('occurs 2 times in the old prompt and 1 in the new one'),
    });
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('keeps the first copy and marks the second stale when the second copy is removed', () => {
    const registry = register(PROMPT);
    const next = PROMPT.slice(0, PROMPT.lastIndexOf(CHART));
    const made = reanchor(registry, PROMPT, next);
    expect(made.sections.find((each) => each.id === 'chart_room')).toMatchObject({
      status: 'kept',
      method: 'window',
    });
    expect(made.sections.find((each) => each.id === 'chart_room_2')).toMatchObject({ status: 'stale' });
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('moves the second copy and marks the first stale when the first copy is removed', () => {
    const registry = register(PROMPT);
    const next = PROMPT.replace(CHART, '');
    const made = reanchor(registry, PROMPT, next);
    expect(made.sections.find((each) => each.id === 'chart_room')).toMatchObject({ status: 'stale' });
    const second = made.sections.find((each) => each.id === 'chart_room_2');
    expect(second).toMatchObject({ status: 'moved', method: 'window' });
    expect(second?.to?.start).toBe(next.indexOf(CHART));
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('keeps the copies in order when the sections above them are deleted', () => {
    const registry = register(PROMPT);
    const next = PROMPT.replace(MOORINGS, '');
    const made = reanchor(registry, PROMPT, next);
    expect(made.sections.map((each) => [each.id, each.status, each.method])).toEqual([
      ['moorings', 'stale', undefined],
      ['chart_room', 'moved', 'occurrence'],
      ['signals', 'moved', 'same_hash'],
      ['chart_room_2', 'moved', 'occurrence'],
    ]);
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('never gives two sections one place when their surroundings both fit the same copy', () => {
    // Old: copy, other section, copy. New: one copy between two other sections. Each old copy's window fits it.
    const registry = register(`${CHART}\n${SIGNALS}\n${CHART}`);
    const next = `${SIGNALS}\n${CHART}\n${SIGNALS}`;
    const made = reanchor(registry, `${CHART}\n${SIGNALS}\n${CHART}`, next);
    const claimed = made.sections.flatMap((each) => (each.to ? [each.to.start] : []));
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(
      made.sections.filter((each) => each.id.startsWith('chart_room')).map((each) => each.status),
    ).toEqual(['stale', 'stale']);
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('marks both copies stale when a copy is removed and their surroundings are the same', () => {
    const gap = '## Gap\nStay clear of the rocks at all times.\n';
    const same = '## Same\nLog the water level at noon every day, rain or shine.\n';
    const before = [gap, same, gap, same, gap].join('\n');
    const after = [gap, same, gap, gap].join('\n');
    const registry = register(before);
    expect(registry.sections.map((each) => each.id)).toEqual(['gap', 'same', 'gap_2', 'same_2', 'gap_3']);
    const made = reanchor(registry, before, after);
    // The three gap copies are still three: they keep their order. The two same copies cannot be told apart.
    expect(made.sections.filter((each) => each.status === 'stale').map((each) => each.id)).toEqual([
      'same',
      'same_2',
    ]);
    for (const id of ['gap', 'gap_2', 'gap_3'])
      expect(made.sections.find((each) => each.id === id)?.method, id).toBe('occurrence');
    // No section is placed on text it did not hold, and no two sections hold the same place.
    const places = made.sections.flatMap((each) => (each.to ? [each.to.start] : []));
    expect(new Set(places).size).toBe(places.length);
    expect(checkSectionRegistry(made.registry, after)).toEqual([]);
  });

  it('finds each copy by its surroundings, and never two on one place, when a copy is added elsewhere', () => {
    const registry = register(PROMPT);
    const next = `${CHART}\n${PROMPT}\n${CHART}`;
    const made = reanchor(registry, PROMPT, next);
    const claimed = made.sections.flatMap((each) => (each.to ? [each.to.start] : []));
    expect(new Set(claimed).size).toBe(claimed.length);
    for (const each of made.sections) {
      if (!each.to) continue;
      expect(next.slice(each.to.start, each.to.end), each.id).toBe(
        PROMPT.slice(each.from.start, each.from.end),
      );
    }
    expect(made.sections.map((each) => [each.id, each.status, each.method])).toEqual([
      ['moorings', 'moved', 'same_hash'],
      ['chart_room', 'moved', 'window'],
      ['signals', 'moved', 'same_hash'],
      ['chart_room_2', 'moved', 'window'],
    ]);
    expect(checkSectionRegistry(made.registry, next)).toEqual([]);
  });

  it('re-anchors twice in a row without losing the copies', () => {
    const registry = register(PROMPT);
    const one = `## Weather\nRead the glass at dawn.\n\n${PROMPT}`;
    const first = reanchor(registry, PROMPT, one);
    const two = `${one}\n## Tides\nRead the gauge twice.\n`;
    const second = reanchorRegistry(first.registry, one, two, 'v3');
    if (!second.ok) throw new Error(second.errors.join('\n'));
    expect(second.result.sections.map((each) => each.status)).toEqual(['kept', 'kept', 'kept', 'kept']);
    expect(checkSectionRegistry(second.result.registry, two)).toEqual([]);
  });
});

/** CPU time of a run, as the other timing tests of the radius package count it. */
function cpuMs<T>(run: () => T): { result: T; ms: number } {
  const before = process.cpuUsage();
  const result = run();
  const used = process.cpuUsage(before);
  return { result, ms: (used.user + used.system) / 1000 };
}

describe('many identical sections take CPU time near linear in the sections', () => {
  const BUDGET_MS = 3000;
  const identical = (count: number) =>
    Array.from({ length: count }, () => '## Same\nThe same rule says that the same item stays.\n').join('\n');

  function everything(count: number) {
    const text = identical(count);
    const init = cpuMs(() => sectionsFromHeadings(text, { promptId: 'p', version: '1' }));
    if (!init.result.ok) throw new Error(init.result.errors[0]);
    const registry = init.result.registry;
    const check = cpuMs(() => checkSectionRegistry(registry, text));
    const next = `## Weather\nRead the glass at dawn.\n\n${text}`;
    const moved = cpuMs(() => reanchorRegistry(registry, text, next, 'v2'));
    return { registry, check, moved, init, next };
  }

  it.each([2000, 8000])('%d identical sections: init, check and reanchor', (count) => {
    const { registry, init, check, moved, next } = everything(count);
    expect(registry.sections).toHaveLength(count);
    expect(new Set(registry.sections.map((each) => each.id)).size).toBe(count);
    expect(registry.sections.at(-1)).toMatchObject({ id: `same_${count}`, anchor: { occurrence: count } });
    expect(check.result).toEqual([]);
    if (!moved.result.ok) throw new Error(moved.result.errors.join('\n'));
    expect(moved.result.result.sections.every((each) => each.method === 'occurrence')).toBe(true);
    expect(checkSectionRegistry(moved.result.result.registry, next)).toEqual([]);
    expect(init.ms).toBeLessThan(BUDGET_MS);
    expect(check.ms).toBeLessThan(BUDGET_MS);
    expect(moved.ms).toBeLessThan(BUDGET_MS);
  });

  it('four times the identical sections take about four times the time', () => {
    const total = (count: number) => {
      const run = everything(count);
      return run.init.ms + run.check.ms + run.moved.ms;
    };
    total(500);
    const small = Math.max(total(2000), 5);
    const large = total(8000);
    expect(large / small).toBeLessThan(10);
  });
});

describe('repeated slugs take the next free suffix', () => {
  // The reference: the naive search from _2 that the cursor per slug must agree with.
  function naive(slugs: string[]): string[] {
    const taken = new Set<string>();
    return slugs.map((base) => {
      let id = base;
      for (let next = 2; taken.has(id); next++) id = `${base}_${next}`;
      taken.add(id);
      return id;
    });
  }

  it('agrees with the naive search on random orders of titles that collide with their own suffixes', () => {
    const titles = ['T', 'T 2', 'T 3', 'T 2 2', 'T 2 3', 'U', 'U 2'];
    const slugOf = (title: string) => title.toLowerCase().replace(/ /g, '_');
    let state = 20260101;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    for (let round = 0; round < 300; round++) {
      const picked = Array.from(
        { length: 4 + Math.floor(next() * 12) },
        () => titles[Math.floor(next() * titles.length)] as string,
      );
      const text = picked
        .map((title, at) => `## ${title}\nBody number ${at} of round ${round}.\n`)
        .join('\n');
      const built = register(text);
      expect(
        built.sections.map((each) => each.id),
        picked.join(' | '),
      ).toEqual(naive(picked.map(slugOf)));
    }
  });
});
