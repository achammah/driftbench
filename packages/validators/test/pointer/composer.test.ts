import { describe, expect, it } from 'vitest';
import { distinctSentences } from '../../src/ladders/pointer/kit/anchor-world';
import { compose } from '../../src/ladders/pointer/kit/compose';
import { headingText, Prose } from '../../src/ladders/pointer/kit/words';

/** The composer is the oracle of the cutting items: its units must be exact slices of its own text. */
describe('the composer', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const eol of ['\n', '\r\n'] as const) {
      it(`gives units that slice the text exactly (seed ${seed}, ${JSON.stringify(eol)})`, () => {
        const p = new Prose(seed, 'composer');
        const texts = distinctSentences(p, 12);
        const doc = compose(
          [
            { kind: 'heading', level: 1, text: headingText(p.random) },
            { kind: 'paragraph', sentences: texts.slice(0, 3) },
            { kind: 'list', items: texts.slice(3, 6).map((text) => ({ text })) },
            { kind: 'heading', level: 2, text: headingText(p.random) },
            { kind: 'quote', paragraphs: texts.slice(6, 8) },
            { kind: 'paragraph', sentences: texts.slice(8) },
          ],
          { eol, bom: seed % 2 === 0 },
        );
        expect(doc.units.length).toBeGreaterThan(8);
        for (const unit of doc.units) {
          expect(doc.text.slice(unit.start, unit.end), `${unit.start}-${unit.end}`).toBe(unit.text);
          expect(unit.start).toBeLessThan(unit.end);
        }
        const starts = doc.units.map((u) => u.start);
        expect([...starts].sort((a, b) => a - b)).toEqual(starts);
        if (seed % 2 === 0) expect(doc.text.startsWith('﻿')).toBe(true);
      });
    }
  }
});
