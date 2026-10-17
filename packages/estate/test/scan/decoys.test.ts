import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { answer, estate, NOW } from '../support';

/**
 * Lines that look like what code reads and are not: a hazard word in a quoted sample, a script's name in
 * passing, a file named in a change note, a form number that reads like a rule label, a
 * guard message that quotes only a rule's condition. Each decoy sits beside the real form it imitates, which
 * must still be read.
 */

const skill = (name: string, body: string[]) =>
  `---\nname: ${name}\ndescription: Handles ${name} work for the team.\n---\n\n${body.join('\n')}\n`;

async function scan(files: Record<string, string>, port?: FakeModelPort) {
  const root = await estate(files);
  return (await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW, ...(port ? { port } : {}) }))
    .map;
}

const SETTINGS = (scripts: string[]) =>
  JSON.stringify({
    hooks: {
      Stop: scripts.map((script) => ({
        hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR"/.claude/guards/${script}` }],
      })),
    },
  });

/** The rules of a CLAUDE.md written as `- **Rn.** text`, each split by a fake model with its own words. */
function rulesPort(rules: string[]): FakeModelPort {
  return new FakeModelPort([
    answer(
      'CLAUDE.md',
      rules.map((quote, index) => ({
        kind: 'instruction',
        title: `Rule ${index + 1}`,
        quote,
        evidence: [{ type: 'custom', name: `r${index + 1}` }],
      })),
    ),
  ]);
}
const standing = (rules: string[]) =>
  `# Rules\n\n${rules.map((rule, index) => `- **R${index + 1}.** ${rule}`).join('\n')}\n`;

describe('a hazard word inside a quoted sample', () => {
  it('names no hazard when the quotation shows how some text reads', async () => {
    const map = await scan({
      'CLAUDE.md': [
        '# Formats',
        'An error reads like "rate limit exceeded for order 42"; quote it as it is.',
        'A typical log line looks like `worker restarted at 02:00`.',
        'For example, "context compacted" may appear in the export; copy it into the ticket.',
        'Status lines are written like “restart pending (3)” in the console.',
      ].join('\n'),
    });
    expect(map.atoms.filter((atom) => atom.kind === 'hazard')).toEqual([]);
  });

  it('keeps the hazard when the quotation is the event the agent reacts to, or the word is outside it', async () => {
    const map = await scan({
      'CLAUDE.md': [
        '# Recovery',
        'If the API answers "rate limit exceeded", wait a minute and retry.',
        'When the log reads like "context compacted", reread the plan.',
        'After a restart (for example "worker 3 down"), reopen the tracker.',
        'Errors such as "too many requests" mean you should slow down.',
      ].join('\n'),
    });
    expect(
      map.atoms.filter((atom) => atom.kind === 'hazard').map((atom) => atom.provenance.startLine),
    ).toEqual([2, 3, 4, 5]);
  });
});

describe("a script's name in passing", () => {
  const scripts = async (body: string[]) => {
    const map = await scan({
      'CLAUDE.md': '# Estate\n',
      '.claude/skills/weekly/SKILL.md': skill('weekly', body),
      '.claude/skills/weekly/scripts/report.py': '#!/usr/bin/env python3\n',
      '.claude/skills/weekly/scripts/export.sh': '#!/bin/sh\n',
    });
    return Object.fromEntries(
      map.atoms
        .filter((atom) => atom.kind === 'script')
        .map((atom) => [String(atom.fields?.path).split('/').pop(), atom.provenance.startLine]),
    );
  };

  it('anchors the script where the body names it to run, not where it is mentioned first', async () => {
    const lines = await scripts([
      'The legacy report.py was retired last year; export.sh used to be slow.',
      'Run `python3 scripts/report.py --week` to build the report.',
      'See [the exporter](scripts/export.sh) when you need a CSV.',
    ]);
    expect(lines).toEqual({ 'report.py': 7, 'export.sh': 8 });
  });

  it('keeps a bare mention as the anchor when no line names the script to run', async () => {
    const lines = await scripts(['Use report.py for the weekly numbers.', 'Call export.sh for a CSV.']);
    expect(lines).toEqual({ 'report.py': 6, 'export.sh': 7 });
  });
});

describe('a file named in a change note', () => {
  it('is no reference when the note reports it removed, deleted, dropped or renamed away', async () => {
    const map = await scan({
      'CLAUDE.md': '# Estate\n',
      '.claude/skills/pricing/SKILL.md': skill('pricing', [
        'Quote prices from the price list.',
        '',
        '## Changelog',
        '',
        '- v3 removed `references/old-pricing.md`.',
        '- `references/draft.txt` was deleted in March.',
        '- Dropped `notes/scratch.md` (merged into the main list).',
        '- `references/v1.md` was renamed to `references/current.md`.',
      ]),
      '.claude/skills/pricing/references/current.md': '# Current\n',
    });
    const paths = map.atoms.filter((atom) => atom.kind === 'reference').map((atom) => atom.fields?.path);
    expect(paths).toEqual(['.claude/skills/pricing/references/current.md']);
  });

  it('keeps references the agent is told to read, to remove now, or that a file moved to', async () => {
    const map = await scan({
      'CLAUDE.md': '# Estate\n',
      '.claude/skills/pricing/SKILL.md': skill('pricing', [
        'Read `references/pricing.md` before quoting.',
        'The guide moved to `references/guide.md`.',
        'Remove `references/tmp.md` when the task closes.',
        'Version 2 replaced the old list; read `references/list.md` instead.',
      ]),
      '.claude/skills/pricing/references/pricing.md': '# Pricing\n',
      '.claude/skills/pricing/references/guide.md': '# Guide\n',
      '.claude/skills/pricing/references/list.md': '# List\n',
    });
    const paths = map.atoms
      .filter((atom) => atom.kind === 'reference')
      .map((atom) => String(atom.fields?.path).split('/').pop());
    expect(paths).toEqual(['pricing.md', 'guide.md', 'tmp.md', 'list.md']);
  });
});

describe('a label that names something other than a rule', () => {
  it('cites no rule after a noun it designates, and cites after a verb, a function word or a rule noun', async () => {
    const rules = [
      'Read a file before you edit it.',
      'Shelve customs form R1 in the cabinet for five years.',
      'Print the Form R1 cover sheet on blue paper.',
      'File the return on form R1 every quarter.',
      'Always follow R1 when you edit a notebook.',
      'As R1 says, never guess a path.',
      'Rule R1 also covers notebooks.',
      'The agent follows R1 on every branch.',
      'Obey R1 before anything else.',
    ];
    const map = await scan({ 'CLAUDE.md': standing(rules) }, rulesPort(rules));
    const titles = new Map(map.atoms.map((atom) => [atom.id, atom.title]));
    const citing = map.edges.filter((edge) => edge.kind === 'cites').map((edge) => titles.get(edge.from));
    expect(citing.sort()).toEqual(['Rule 5', 'Rule 6', 'Rule 7', 'Rule 8', 'Rule 9']);
  });
});

describe('a guard message that quotes part of a rule', () => {
  it("enforces the rule when it repeats the directive, never when it repeats only the rule's condition", async () => {
    const rules = [
      'When the owner asks to pause, halt every running task and confirm in one line.',
      'Before you deploy on a Friday, ask the lead for an explicit yes.',
    ];
    const map = await scan(
      {
        'CLAUDE.md': standing(rules),
        '.claude/settings.json': SETTINGS(['condition.sh', 'directive.sh', 'friday.sh', 'ask.sh']),
        '.claude/guards/condition.sh': '#!/bin/sh\necho "the owner asks to pause"\n',
        '.claude/guards/directive.sh': '#!/bin/sh\necho "halt every running task and confirm in one line"\n',
        '.claude/guards/friday.sh': '#!/bin/sh\necho "before you deploy on a friday"\n',
        '.claude/guards/ask.sh': '#!/bin/sh\necho "ask the lead for an explicit yes"\n',
      },
      rulesPort(rules),
    );
    const titles = new Map(map.atoms.map((atom) => [atom.id, atom.title]));
    const enforced = map.atoms
      .filter((atom) => atom.kind === 'guard')
      .map((guard) => [
        String(guard.fields?.name),
        map.edges
          .filter((edge) => edge.kind === 'enforces' && edge.from === guard.id)
          .map((edge) => titles.get(edge.to)),
      ]);
    expect(Object.fromEntries(enforced)).toEqual({
      'condition.sh': [],
      'directive.sh': ['Rule 1'],
      'friday.sh': [],
      'ask.sh': ['Rule 2'],
    });
  });
});

describe('a reference that names a second reference', () => {
  it('gives the skill a reference edge to every file its references name in turn', async () => {
    const map = await scan({
      'CLAUDE.md': '# Estate\n',
      '.claude/skills/refunds/SKILL.md': skill('refunds', ['Read `references/policy.md` first.']),
      '.claude/skills/refunds/references/policy.md': '# Policy\n\nFor edge cases, open `cases.md` too.\n',
      '.claude/skills/refunds/references/cases.md': '# Cases\n\nFor chargebacks, see `chargebacks.md`.\n',
      '.claude/skills/refunds/references/chargebacks.md': '# Chargebacks\n',
    });
    const skillAtom = map.atoms.find((atom) => atom.kind === 'skill');
    const reached = map.edges
      .filter((edge) => edge.kind === 'reference' && edge.from === skillAtom?.id)
      .map((edge) => map.atoms.find((atom) => atom.id === edge.to)?.fields?.path)
      .map((path) => String(path).split('/').pop());
    expect(reached.sort()).toEqual(['cases.md', 'chargebacks.md', 'policy.md']);
  });
});
