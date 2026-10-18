import { readFileSync } from 'node:fs';
import { AtomKind } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import {
  drawEstate,
  FIXTURE_FOLDER,
  fixtureName,
  fixtureText,
  renderEstate,
  situationsOf,
} from '../../src/ladders/estate/index';

const ROOT = new URL('../../../../', import.meta.url);
const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

describe('the seeded estate generator', { timeout: 120_000 }, () => {
  it('draws the same estate from the same seed and another from another seed', () => {
    expect(renderEstate(drawEstate(4)).files).toEqual(renderEstate(drawEstate(4)).files);
    expect(renderEstate(drawEstate(4)).files).not.toEqual(renderEstate(drawEstate(5)).files);
  });

  it('matches the committed fixtures of seed 1, byte for byte', () => {
    for (const profile of ['visible', 'holdout'] as const) {
      const committed = readFileSync(new URL(`${FIXTURE_FOLDER}/${fixtureName(1, profile)}`, ROOT), 'utf8');
      expect(fixtureText(1, profile)).toBe(committed);
    }
  });

  it('plants atoms of all fourteen kinds and at least two defects on every seed', () => {
    for (const seed of SEEDS) {
      const estate = drawEstate(seed);
      const kinds = new Set(renderEstate(estate).atoms.map((atom) => atom.kind));
      expect([...kinds].sort(), `seed ${seed}`).toEqual([...AtomKind.options].sort());
      expect(estate.defects.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('plants every defect class over seeds 1 to 20, each with the finding it must give', () => {
    const codes = new Set<string>();
    const defects = new Set<string>();
    for (const seed of SEEDS) {
      const estate = drawEstate(seed);
      for (const defect of estate.defects) defects.add(defect);
      const findings = renderEstate(estate).findings;
      expect(findings.map((finding) => finding.defect).sort(), `seed ${seed}`).toEqual(
        [...estate.defects].sort(),
      );
      for (const finding of findings) codes.add(finding.code);
    }
    expect([...defects].sort()).toEqual([
      'ghost_row',
      'guard_without_row',
      'missing_reference',
      'orphan',
      'unanchored_guard',
    ]);
    expect([...codes].sort()).toEqual([
      'MISSING_REFERENCE',
      'ORPHAN',
      'REGISTRY_GUARD',
      'REGISTRY_ROW',
      'UNANCHORED_GUARD',
    ]);
  });

  it('gives every atom it plants a line of the file it names, and every edge two planted ends', () => {
    for (const seed of SEEDS) {
      const rendered = renderEstate(drawEstate(seed));
      const hids = new Set(rendered.atoms.map((atom) => atom.hid));
      expect(hids.size, `seed ${seed}: hidden ids are unique`).toBe(rendered.atoms.length);
      for (const atom of rendered.atoms) {
        const lines = rendered.files[atom.file]?.split('\n') ?? [];
        expect(lines[atom.line - 1]?.trim(), `${atom.hid} at ${atom.file}:${atom.line}`).toBeTruthy();
      }
      for (const edge of rendered.edges) {
        expect(hids.has(edge.from), `${edge.from} of ${edge.kind}`).toBe(true);
        expect(edge.to.startsWith('event.') || hids.has(edge.to), `${edge.to} of ${edge.kind}`).toBe(true);
      }
    }
  });

  it('records an answer for every prose chunk, each quote found on the line it claims', () => {
    const rendered = renderEstate(drawEstate(1, 'holdout'));
    expect(Object.keys(rendered.recording.answers).sort()).toEqual([...rendered.chunks].sort());
    for (const [chunk, answer] of Object.entries(rendered.recording.answers)) {
      const lines = rendered.files[chunk]?.split('\n') ?? [];
      for (const atom of (answer as { atoms: Array<{ quote: string; line: number }> }).atoms) {
        expect(lines[atom.line - 1], `${chunk}:${atom.line}`).toContain(atom.quote.slice(0, 20));
      }
    }
  });

  it('keeps the holdout forms out of the visible profile', () => {
    const forms = (profile: 'visible' | 'holdout') =>
      SEEDS.slice(0, 5).map((seed) => {
        const estate = drawEstate(seed, profile);
        const files = renderEstate(estate).files;
        const text = Object.values(files).join('\n');
        return {
          memory: Object.keys(files).some((path) => path.includes('/memory/')),
          json: Object.keys(files).some((path) => path.endsWith('registry.json')),
          comma: estate.skills.some((skill) =>
            text.includes(
              `Before you ${skill.topic.comma.verb}, read \`references/${skill.topic.comma.file}\`.`,
            ),
          ),
          until: text.includes('until you have read'),
          hook: Object.entries(files).some(
            ([path, body]) => path.endsWith('SKILL.md') && body.includes('hooks:'),
          ),
        };
      });
    for (const shape of forms('visible')) {
      expect(shape).toEqual({ memory: false, json: false, comma: false, until: false, hook: false });
    }
    for (const shape of forms('holdout')) {
      expect(shape).toEqual({ memory: true, json: true, comma: true, until: true, hook: true });
    }
  });

  it('gives every ask one situation, and every skill and helper a trigger situation', () => {
    for (const seed of SEEDS) {
      const estate = drawEstate(seed);
      const situations = situationsOf(estate);
      for (const unit of [...estate.skills.map((skill) => skill.hid), ...estate.helpers.map((h) => h.hid)]) {
        expect(
          situations.some((situation) => situation.use === 'trigger' && situation.atoms.includes(unit)),
          `${unit} on seed ${seed}`,
        ).toBe(true);
      }
    }
  });
});
