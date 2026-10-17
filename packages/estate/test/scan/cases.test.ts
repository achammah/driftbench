import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approveAtoms,
  ClaudeCodeReader,
  estateRecordingPort,
  INFORMATION,
  lintEstate,
  loadEstateMap,
  loadEstateRecording,
  scanEstate,
} from '../../src/index';
import { NOW } from '../support';
import { CASES } from './cases';

async function scanCases() {
  const recording = await loadEstateRecording(join(CASES, 'answers.yaml'));
  if (!recording.ok) throw new Error(recording.message);
  return scanEstate({
    root: CASES,
    reader: new ClaudeCodeReader(),
    port: estateRecordingPort(recording.recording),
    now: NOW,
  });
}

describe('the committed reader-cases outputs', () => {
  it('map.yaml is what a scan with the recorded answers gives today, with no refusal', async () => {
    const committed = await loadEstateMap(join(CASES, 'map.yaml'));
    if (!committed.ok) throw new Error(JSON.stringify(committed.errors));
    const fresh = await scanCases();
    expect(fresh.refusals).toEqual([]);
    expect(fresh.chunks.every((run) => run.status === 'done')).toBe(true);
    expect(committed.map.hash).toBe(fresh.map.hash);
    // The committed map predates descriptive guard metadata. Keep exact parity for its
    // entire legacy shape; the source/registry metadata has its own public scan tests.
    const legacy = fresh.map.atoms.map((atom) => {
      if (atom.kind !== 'guard' || !atom.fields) return atom;
      const { ruleText, ruleSources, rules, ...fields } = atom.fields;
      expect(ruleText).toBeTypeOf('string');
      expect(ruleSources).toBeInstanceOf(Array);
      expect(rules).toBeInstanceOf(Array);
      return { ...atom, fields };
    });
    expect(committed.map.atoms).toEqual(legacy);
    expect(committed.map.edges).toEqual(fresh.map.edges);
  });

  it('approved.yaml is map.yaml with every atom approved', async () => {
    const approved = approveAtoms(await readFile(join(CASES, 'map.yaml'), 'utf8'), { all: true });
    if (!approved.ok) throw new Error('invalid');
    expect(await readFile(join(CASES, 'approved.yaml'), 'utf8')).toBe(approved.text);
  });

  it('lints cleanly when a shared bare name has one local match', async () => {
    const { map, raw } = await scanCases();
    const result = lintEstate(map, raw);
    expect(
      result.findings
        .filter((finding) => !INFORMATION.has(finding.code))
        .map((finding) => [finding.code, finding.subject]),
    ).toEqual([]);
    expect(
      map.atoms.find((atom) => atom.id === 'reference.shipment-tracker.read-notes-md')?.fields,
    ).toMatchObject({
      path: '.claude/skills/shipment-tracker/references/notes.md',
      exists: true,
      resolvedBy: 'suffix',
    });
    expect(raw.notes.map((note) => note.file)).toEqual(['.claude/skills/parcel-claims/SKILL.md']);
  });
});
