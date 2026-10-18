import { describe, expect, it } from 'vitest';
import { actOf, codeAsk } from '../../src/estate/asks';
import type { EstateAtom } from '../../src/estate/inputs';

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
