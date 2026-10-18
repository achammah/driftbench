import { describe, expect, it } from 'vitest';
import { actOf, codeAsk, fileSubjectDerivation } from '../../src/estate/asks';
import { renderAsk, SLOT, SUBJECT_SHAPE, SUBJECT_TAIL } from '../../src/estate/frames';
import type { EstateAtom } from '../../src/estate/inputs';
import { fromRecord } from '../../src/estate/record';

/** Hand-written shapes, with wordings written for this file only. */
function atom(id: string, extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: id.split('.')[0] ?? 'instruction', title: id, approved: true, evidence: [], ...extra };
}
const owner = atom('skill.kiln', {
  fields: { name: 'kiln', description: 'Fire the pottery kiln. Use when the user asks to fire a batch.' },
  provenance: { quote: 'x', file: '.claude/skills/kiln/SKILL.md' },
});
const reference = (path: string, readWhen: string) =>
  atom(`reference.kiln.${path.replace(/\W+/g, '-')}`, {
    fields: { path, readWhen },
    provenance: { quote: readWhen, file: '.claude/skills/kiln/SKILL.md' },
  });

describe('a file that states no moment is read at the work of its unit and the subject of the file', () => {
  it('gives each bare listed file its own ask', () => {
    const asks = ['references/glaze-recipes.md', 'references/firing-curves.md', 'references/data-3.json'].map(
      (path) => codeAsk('trigger', [reference(path, `- \`${path}\``), owner], []).text,
    );
    expect(asks).toEqual([
      'Please fire a batch, including the glaze recipes.',
      'Please fire a batch, including the firing curves.',
      'Please fire a batch, including the data 3.',
    ]);
    expect(new Set(asks).size).toBe(3);
  });

  it('keeps the moment a line states for its file', () => {
    const ref = reference(
      'references/glaze-recipes.md',
      'Read `references/glaze-recipes.md` for glaze colour mixing',
    );
    const found = actOf([ref, owner]);
    expect(found.act).toBe('help me with glaze colour mixing');
    expect(found.source).toBe(`${ref.id} (readWhen topic)`);
  });

  it('names no subject for a generic file name, a missing path or a name with no letters', () => {
    for (const path of ['references/README.md', 'index.md', '12.json']) {
      expect(codeAsk('trigger', [reference(path, `- \`${path}\``), owner], []).text).toBe(
        'Please fire a batch.',
      );
    }
    const bare = atom('reference.kiln.x', { fields: { readWhen: '- something' } });
    expect(codeAsk('trigger', [bare, owner], []).text).toBe('Please fire a batch.');
  });

  it('does not repeat a subject the act already holds', () => {
    const found = actOf([reference('references/batch.md', '- `references/batch.md`'), owner]);
    expect(found.act).toBe('fire a batch');
  });

  it('compares words, not substrings, to decide a subject is already in the task', () => {
    const weaver = atom('skill.loom', {
      fields: { name: 'loom', description: 'Weave a panel. Use when the user asks to weave a panel.' },
      provenance: { quote: 'x', file: '.claude/skills/loom/SKILL.md' },
    });
    const ref = (path: string) =>
      atom(`reference.loom.${path.replace(/\W+/g, '-')}`, {
        fields: { path, readWhen: `- \`${path}\`` },
        provenance: { quote: path, file: '.claude/skills/loom/SKILL.md' },
      });
    // Every word of the subject is in the task, in another order and with words between: not repeated.
    expect(actOf([ref('references/weave-panel.md'), weaver]).act).toBe('weave a panel');
    // A word that only sits inside a longer one is not a repeat: "pan" is not in "panel".
    expect(actOf([ref('references/pan.md'), weaver]).act).toBe('weave a panel, including the pan');
  });
});

describe('the ask that names the subject of a file records where it came from', () => {
  const ref = reference('references/glaze-recipes.md', '- `references/glaze-recipes.md`');

  it('derives the subject from the path alone, by a fixed rule', () => {
    expect(fileSubjectDerivation('references/glaze-recipes.md')).toBe('glaze recipes');
    expect(fileSubjectDerivation('data-3.json')).toBe('data 3');
    for (const path of ['references/README.md', 'index.md', '12.json', 'Check the tide tables', undefined, 3])
      expect(fileSubjectDerivation(path)).toBeUndefined();
  });

  it('names the unit of the task as its source, with no file suffix', () => {
    const written = codeAsk('trigger', [ref, owner], []);
    expect(written.source).toBe(`${owner.id} (asks it names)`);
  });

  it('also fits a task put as help with a topic', () => {
    const bare = reference('references/firing-curves.md', '- `references/firing-curves.md`');
    const helper = atom('skill.kiln2', {
      fields: { name: 'kiln2', description: 'Use when the user asks for help with firing schedules.' },
      provenance: { quote: 'x', file: '.claude/skills/kiln2/SKILL.md' },
    });
    const written = codeAsk('trigger', [bare, helper], []);
    const from = fromRecord({
      askFrom: written.source,
      built: { frame: written.frame as string, act: written.act as string },
      atoms: new Map([[helper.id, helper]]),
    }) as unknown as { frame: string; shape: string; pieces: string[] } | undefined;
    expect(from?.shape).toBe(`help me with ${SLOT}${SUBJECT_TAIL}`);
    expect(renderAsk(from as { frame: string; shape: string; pieces: string[] })).toBe(written.text);
  });

  it('records the frame, the shape of the act and the pieces so the ask is rebuilt from them', () => {
    const written = codeAsk('trigger', [ref, owner], []);
    const from = fromRecord({
      askFrom: written.source,
      built: {
        frame: written.frame as string,
        act: written.act as string,
        ...(written.context ? { context: written.context } : {}),
      },
      atoms: new Map([[owner.id, owner]]),
    });
    expect(from).toMatchObject({
      form: 'asks it names',
      shape: SUBJECT_SHAPE,
      pieces: ['fire a batch', 'glaze recipes'],
    });
    const parts = from as unknown as { frame: string; shape: string; context?: string; pieces: string[] };
    expect(renderAsk(parts)).toBe(written.text);
  });
});
