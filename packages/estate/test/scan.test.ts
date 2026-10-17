import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { SpaceId } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  chunkOf,
  locateQuote,
  PROSE_SYSTEM_PROMPT,
  provenanceHash,
  quoteAtSpan,
  readerFor,
  scanAtoms,
  scanEstate,
  scriptOf,
} from '../src/index';
import { answer, estate, FIXTURE, NOW, scanFixture } from './support';

describe('the Claude Code reader', () => {
  it('reads every estate file with its kind, and nothing outside the estate', async () => {
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    const kinds = Object.fromEntries(raw.files.map((file) => [file.path, file.kind]));
    expect(kinds).toEqual({
      'CLAUDE.md': 'standing',
      '.claude/agents/inbox-triager.md': 'subagent',
      '.claude/agents/ledger-auditor.md': 'subagent',
      '.claude/agents/route-planner.md': 'subagent',
      '.claude/guards/CHECK-REGISTRY.md': 'registry',
      '.claude/guards/block-force-push.sh': 'guard_script',
      '.claude/guards/ledger-guard.py': 'guard_script',
      '.claude/guards/read-before-edit.py': 'guard_script',
      '.claude/guards/reply-length.py': 'guard_script',
      '.claude/guards/stop-word.sh': 'guard_script',
      '.claude/memory/MEMORY.md': 'memory',
      '.claude/memory/supplier-languages.md': 'memory',
      '.claude/settings.json': 'settings',
      '.claude/skills/invoice-reconcile/SKILL.md': 'skill',
      '.claude/skills/invoice-reconcile/references/currency-table.md': 'skill_file',
      '.claude/skills/invoice-reconcile/references/matching-rules.md': 'skill_file',
      '.claude/skills/invoice-reconcile/references/old-tolerances.md': 'skill_file',
      '.claude/skills/invoice-reconcile/scripts/reconcile.py': 'skill_file',
      '.claude/skills/shipment-tracker/SKILL.md': 'skill',
      '.claude/skills/shipment-tracker/data/shipments.txt': 'skill_file',
      '.claude/skills/shipment-tracker/scripts/check-carrier.sh': 'guard_script',
      '.claude/skills/shipment-tracker/scripts/track.sh': 'skill_file',
      '.claude/skills/supplier-email/SKILL.md': 'skill',
      '.claude/skills/weekly-report/SKILL.md': 'skill',
      '.claude/skills/weekly-report/templates/report.md': 'skill_file',
      '.claude/steps.json': 'step_list',
    });
    expect(raw.notes).toEqual([]);
  });

  it('reads guards from the settings and from a skill frontmatter, with the script and its anchoring', async () => {
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    expect(
      raw.guards.map((guard) => [
        guard.event,
        guard.matcher ?? '',
        guard.script,
        guard.anchored,
        guard.scope,
      ]),
    ).toEqual([
      ['PreToolUse', 'Bash', '.claude/guards/block-force-push.sh', true, 'estate'],
      ['PreToolUse', 'Edit|Write', '.claude/guards/read-before-edit.py', true, 'estate'],
      ['PostToolUse', 'Bash', '.claude/guards/ledger-guard.py', false, 'estate'],
      ['UserPromptSubmit', '', '.claude/guards/stop-word.sh', true, 'estate'],
      ['Stop', '', '.claude/guards/reply-length.py', true, 'estate'],
      [
        'PreToolUse',
        'Bash',
        '.claude/skills/shipment-tracker/scripts/check-carrier.sh',
        true,
        'shipment-tracker',
      ],
    ]);
    expect(raw.guards[1]?.timeout).toBe(5);
  });

  it('keeps permission rules and setting keys, and never an environment value', async () => {
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    expect(raw.permissions.map((permission) => `${permission.effect} ${permission.rule}`)).toEqual([
      'allow Read',
      'allow Grep',
      'allow Glob',
      'allow Bash(git status)',
      'allow Bash(python3 *)',
      'deny Bash(git push --force:*)',
      'deny Bash(rm -rf:*)',
      'deny WebFetch',
      'ask Bash(git commit:*)',
    ]);
    expect(raw.permissions[5]).toMatchObject({ tool: 'Bash', pattern: 'git push --force:*' });
    expect(raw.settings.map((setting) => [setting.key, setting.value])).toEqual([
      ['model', 'opus'],
      ['permissions.defaultMode', 'default'],
      ['env.NORTHWIND_REGION', undefined],
      ['env.NORTHWIND_LEDGER_DIR', undefined],
    ]);
    const quotes = raw.settings.map((setting) => setting.at.quote).join('\n');
    expect(quotes).not.toContain('eu-west');
    expect(quotes).not.toContain('"ledger"');
  });

  it('reads the check registry rows by id and by quoted passage, and the step list', async () => {
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    expect(raw.registry.map((row) => [row.id, row.guard, row.verdict, row.enforces])).toEqual([
      ['G1', 'block-force-push.sh', 'deny', [{ id: 'R6' }]],
      ['G2', 'read-before-edit.py', 'deny', [{ id: 'R3' }, { id: 'R5' }]],
      ['G3', 'ledger-guard.py', 'warn', [{ id: 'R4' }]],
      ['G4', 'stop-word.sh', 'nudge', [{ id: 'R10' }]],
      ['G5', 'check-carrier.sh', 'deny', [{ quote: 'Always pass the carrier code to track.sh' }]],
      ['G6', 'supplier-send-guard.py', 'deny', [{ id: 'R2' }]],
    ]);
    expect(raw.steps.map((step) => [step.id, step.next, step.anytime])).toEqual([
      ['plan', ['do'], false],
      ['do', ['verify'], false],
      ['verify', ['report', 'do'], false],
      ['report', [], false],
      ['note', [], true],
    ]);
  });

  it('gives the prose of standing files, memory, skill bodies, skill files and helper bodies to the model, never a frontmatter', async () => {
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    expect(raw.prose.map((chunk) => [chunk.id, chunk.startLine])).toEqual([
      ['CLAUDE.md', 1],
      ['.claude/agents/inbox-triager.md', 7],
      ['.claude/agents/ledger-auditor.md', 8],
      ['.claude/agents/route-planner.md', 8],
      ['.claude/memory/MEMORY.md', 1],
      ['.claude/memory/supplier-languages.md', 1],
      ['.claude/skills/invoice-reconcile/SKILL.md', 6],
      ['.claude/skills/invoice-reconcile/references/currency-table.md', 1],
      ['.claude/skills/invoice-reconcile/references/matching-rules.md', 1],
      ['.claude/skills/invoice-reconcile/references/old-tolerances.md', 1],
      ['.claude/skills/shipment-tracker/SKILL.md', 12],
      ['.claude/skills/supplier-email/SKILL.md', 5],
      ['.claude/skills/weekly-report/SKILL.md', 6],
      ['.claude/skills/weekly-report/templates/report.md', 1],
      ['.claude/skills/shipment-tracker/data/shipments.txt', 1],
    ]);
    for (const chunk of raw.prose) expect(chunk.text).not.toMatch(/^name:/m);
  });

  it('finds a script from an anchor or from the working folder', () => {
    expect(scriptOf('"$CLAUDE_PROJECT_DIR"/.claude/guards/a.sh')).toEqual({
      script: '.claude/guards/a.sh',
      anchored: true,
    });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, not a template
    expect(scriptOf('python3 "${CLAUDE_PROJECT_DIR}/.claude/guards/b.py" --strict')).toEqual({
      script: '.claude/guards/b.py',
      anchored: true,
    });
    expect(scriptOf('python3 .claude/guards/c.py')).toEqual({
      script: '.claude/guards/c.py',
      anchored: false,
    });
    expect(scriptOf('./scripts/d.sh')).toEqual({ script: 'scripts/d.sh', anchored: false });
    expect(scriptOf('echo done')).toEqual({ anchored: false });
  });

  it('is the reader for claude-code, and there is none for an unknown runtime', () => {
    expect(readerFor('claude-code')?.runtime).toBe('claude-code');
    expect(readerFor('other')).toBeUndefined();
  });
});

describe('code atoms', () => {
  it('reads every structured atom of the fixture, approved as read, with no model call', async () => {
    const result = await scanEstate({ root: FIXTURE, reader: new ClaudeCodeReader(), now: NOW });
    const counts: Record<string, number> = {};
    for (const atom of result.map.atoms) counts[atom.kind] = (counts[atom.kind] ?? 0) + 1;
    expect(counts).toEqual({
      skill: 4,
      route: 13,
      subagent: 3,
      guard: 6,
      tool: 12,
      setting: 4,
      stage: 5,
      script: 2,
      reference: 10,
      gate: 4,
      hazard: 2,
      invariant: 4,
    });
    expect(result.map.atoms.every((atom) => atom.producedBy === 'code' && atom.approved)).toBe(true);
    expect(result.calls).toBe(0);
    expect(result.map.producedBy).toBeUndefined();
  });

  it('reads the fixed forms of a gate, with the read first and the act after', async () => {
    const { map } = await scanEstate({ root: FIXTURE, reader: new ClaudeCodeReader(), now: NOW });
    const gates = map.atoms.filter((atom) => atom.kind === 'gate');
    expect(
      gates.map((gate) => [
        gate.provenance.file,
        gate.provenance.startLine,
        gate.fields?.form,
        gate.evidence[0],
      ]),
    ).toEqual([
      ['CLAUDE.md', 13, 'before-colon-read', { type: 'ordered', before: 'Read', after: 'Edit' }],
      ['CLAUDE.md', 22, 'not-until-read', { type: 'ordered', before: 'Bash', after: 'Bash' }],
      [
        '.claude/skills/invoice-reconcile/SKILL.md',
        9,
        'read-before',
        { type: 'ordered', before: 'Read', after: 'matching any line' },
      ],
      [
        '.claude/skills/weekly-report/SKILL.md',
        9,
        'before-colon-read',
        { type: 'ordered', before: 'Read', after: 'Write' },
      ],
    ]);
    expect(gates[0]?.fields?.path).toBe('.claude/skills/invoice-reconcile/references/matching-rules.md');
    expect(gates[3]?.fields?.path).toBe('.claude/skills/weekly-report/templates/report.md');
  });

  it('resolves a named file from its skill folder or from the root, and marks one that does not exist', async () => {
    const { map } = await scanEstate({ root: FIXTURE, reader: new ClaudeCodeReader(), now: NOW });
    const references = map.atoms.filter((atom) => atom.kind === 'reference');
    expect(references.map((atom) => [atom.fields?.path, atom.fields?.exists])).toEqual([
      ['.claude/skills/invoice-reconcile/references/matching-rules.md', true],
      ['.claude/steps.json', true],
      ['.claude/memory/MEMORY.md', true],
      ['.claude/memory/supplier-languages.md', true],
      ['.claude/skills/invoice-reconcile/references/matching-rules.md', true],
      ['.claude/skills/invoice-reconcile/references/currency-table.md', true],
      ['.claude/skills/shipment-tracker/data/shipments.txt', true],
      ['.claude/memory/supplier-languages.md', true],
      ['.claude/skills/weekly-report/templates/report.md', true],
      ['.claude/skills/weekly-report/references/kpi-definitions.md', false],
    ]);
    const scripts = map.atoms.filter((atom) => atom.kind === 'script');
    expect(scripts.map((atom) => [atom.fields?.path, atom.provenance.file, atom.fields?.named])).toEqual([
      [
        '.claude/skills/invoice-reconcile/scripts/reconcile.py',
        '.claude/skills/invoice-reconcile/SKILL.md',
        true,
      ],
      ['.claude/skills/shipment-tracker/scripts/track.sh', '.claude/skills/shipment-tracker/SKILL.md', true],
    ]);
  });

  it('reads routes from descriptions and from a routing table', async () => {
    const { map } = await scanEstate({ root: FIXTURE, reader: new ClaudeCodeReader(), now: NOW });
    const table = map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table');
    expect(table.map((atom) => [atom.fields?.target, atom.evidence[0]])).toEqual([
      ['invoice-reconcile', { type: 'skill_loaded', name: 'invoice-reconcile' }],
      ['shipment-tracker', { type: 'skill_loaded', name: 'shipment-tracker' }],
      ['supplier-email', { type: 'skill_loaded', name: 'supplier-email' }],
      ['weekly-report', { type: 'skill_loaded', name: 'weekly-report' }],
      ['ledger-auditor', { type: 'tool_called', label: 'Agent', input: { subagent_type: 'ledger-auditor' } }],
      ['route-planner', { type: 'tool_called', label: 'Agent', input: { subagent_type: 'route-planner' } }],
    ]);
    expect(
      map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'description'),
    ).toHaveLength(7);
  });

  it('gives each atom a stable id usable as a space value, and a quote that is in its file at its span', async () => {
    const first = await scanFixture();
    const second = await scanFixture();
    expect(second.map.atoms.map((atom) => atom.id)).toEqual(first.map.atoms.map((atom) => atom.id));
    const ids = first.map.atoms.map((atom) => atom.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const atom of first.map.atoms) {
      expect(SpaceId.safeParse(atom.id).success, atom.id).toBe(true);
      const text = await readFile(join(FIXTURE, atom.provenance.file), 'utf8');
      expect(quoteAtSpan(text, atom.provenance), atom.id).toBe(true);
      expect(atom.provenance.hash).toBe(provenanceHash(atom.provenance));
    }
  });
});

describe('prose atoms through the model port', () => {
  const RULES = '# Rules\n\n- Always reply in English.\n- Never delete a file\n  under data/.\n';

  async function scanWith(answers: ConstructorParameters<typeof FakeModelPort>[0]) {
    const root = await estate({ 'CLAUDE.md': RULES });
    const raw = await new ClaudeCodeReader().read(root);
    const port = new FakeModelPort(answers);
    return { ...(await scanAtoms(raw, { port })), port };
  }

  it('sends one request per chunk with the contract, and accepts quoted atoms unapproved, spanning lines', async () => {
    const { builder, chunks, refusals, port } = await scanWith([
      answer('CLAUDE.md', [
        {
          kind: 'register',
          title: 'English',
          quote: 'Always reply in English.',
          evidence: [{ type: 'text', lang: 'en' }],
        },
        {
          kind: 'instruction',
          title: 'No delete under data',
          quote: 'Never delete a file under data/.',
          polarity: 'prohibition',
          evidence: [{ type: 'custom', name: 'no_delete' }],
        },
      ]),
    ]);
    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]?.system).toBe(PROSE_SYSTEM_PROMPT);
    expect(chunkOf(port.requests[0]?.user ?? '')).toBe('CLAUDE.md');
    expect(refusals).toEqual([]);
    expect(chunks).toEqual([{ chunk: 'CLAUDE.md', calls: 1, status: 'done', accepted: 2 }]);
    const prose = builder.atoms.filter((atom) => atom.producedBy === 'model');
    expect(
      prose.map((atom) => [atom.kind, atom.provenance.startLine, atom.provenance.endLine, atom.approved]),
    ).toEqual([
      ['register', 3, 3, false],
      ['instruction', 4, 5, false],
    ]);
    expect(prose[1]?.fields).toEqual({ polarity: 'prohibition' });
  });

  it('refuses an atom it cannot place, with the reason, and keeps the others', async () => {
    const { builder, refusals } = await scanWith([
      answer('CLAUDE.md', [
        {
          kind: 'instruction',
          title: 'Invented',
          quote: 'Always reply in French.',
          evidence: [{ type: 'custom', name: 'x' }],
        },
        { kind: 'instruction', title: 'Too short', quote: 'Ne', evidence: [{ type: 'custom', name: 'x' }] },
        {
          kind: 'instruction',
          title: 'Too long',
          quote: 'x'.repeat(401),
          evidence: [{ type: 'custom', name: 'x' }],
        },
        { kind: 'instruction', title: 'No evidence', quote: 'Always reply in English.', evidence: [] },
        {
          kind: 'route',
          title: 'Wrong kind',
          quote: 'Always reply in English.',
          evidence: [{ type: 'custom', name: 'x' }],
        },
        {
          kind: 'instruction',
          title: 'Extra key',
          quote: 'Always reply in English.',
          evidence: [{ type: 'custom', name: 'x' }],
          why: 'x',
        },
        {
          kind: 'register',
          title: 'Good',
          quote: 'Always reply in English.',
          evidence: [{ type: 'text', lang: 'en' }],
        },
      ]),
    ]);
    expect(refusals.map((refusal) => [refusal.entry.split(' ')[1], refusal.reason.split(':')[0]])).toEqual([
      ['#1', 'the quote is not in CLAUDE.md'],
      ['#2', 'the quote is too short to place the atom'],
      ['#3', 'the quote is longer than 400 characters'],
      ['#4', 'evidence'],
      ['#5', 'kind'],
      ['#6', 'unknown key why'],
    ]);
    expect(builder.atoms.filter((atom) => atom.producedBy === 'model').map((atom) => atom.title)).toEqual([
      'Good',
    ]);
  });

  it('refuses a quote that is in the file but outside the chunk, such as a frontmatter line', async () => {
    const root = await estate({
      '.claude/skills/demo/SKILL.md':
        '---\nname: demo\ndescription: Use it to demo things.\n---\n\nAlways log the run.\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    const port = new FakeModelPort([
      answer('.claude/skills/demo/SKILL.md', [
        {
          kind: 'instruction',
          title: 'Demo',
          quote: 'Use it to demo things.',
          evidence: [{ type: 'custom', name: 'x' }],
        },
        {
          kind: 'instruction',
          title: 'Log',
          quote: 'Always log the run.',
          evidence: [{ type: 'custom', name: 'x' }],
        },
      ]),
    ]);
    const { refusals, builder } = await scanAtoms(raw, { port });
    expect(refusals).toEqual([
      {
        chunk: '.claude/skills/demo/SKILL.md',
        entry: 'atom #1 (instruction: Demo)',
        reason: 'the quote is in .claude/skills/demo/SKILL.md at line 3, outside the chunk (lines 5 to 6)',
      },
    ]);
    expect(
      builder.atoms.filter((atom) => atom.producedBy === 'model').map((atom) => atom.provenance.startLine),
    ).toEqual([6]);
  });

  it('skips a model atom that repeats an atom code already read', async () => {
    const root = await estate({
      'CLAUDE.md': 'Before editing a page: Read `guide.md`.\n',
      'guide.md': '# Guide\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    const port = new FakeModelPort([
      answer('CLAUDE.md', [
        {
          kind: 'gate',
          title: 'Guide first',
          quote: 'Before editing a page: Read `guide.md`.',
          evidence: [{ type: 'ordered', before: 'Read', after: 'Edit' }],
        },
      ]),
    ]);
    const { duplicates, builder } = await scanAtoms(raw, { port });
    expect(duplicates).toEqual([
      'CLAUDE.md: atom #1 (gate: Guide first) repeats gate.standing.read-guide-md-before-editing-a',
    ]);
    expect(builder.atoms.filter((atom) => atom.kind === 'gate')).toHaveLength(1);
  });

  it('retries an unreadable answer once, then reports the chunk failed', async () => {
    const retried = await scanWith(['not json', answer('CLAUDE.md', [])]);
    expect(retried.chunks).toEqual([{ chunk: 'CLAUDE.md', calls: 2, status: 'done', accepted: 0 }]);
    expect(retried.port.requests[1]?.user).toContain('Your previous answer could not be read');
    const failed = await scanWith(['not json', '{"chunk": "other.md", "atoms": []}']);
    expect(failed.chunks[0]).toMatchObject({ calls: 2, status: 'failed' });
    expect(failed.chunks[0]?.error).toContain('the answer is for the chunk "other.md"');
  });

  it('reports a model call that fails, and goes on', async () => {
    const { chunks } = await scanWith([new Error('down')]);
    expect(chunks[0]).toMatchObject({ status: 'failed', calls: 1 });
    expect(chunks[0]?.error).toContain('down');
  });
});

describe('locating a quote', () => {
  it('folds white space and typographic quotes, and picks the occurrence nearest a hint', () => {
    const text = 'one\nNever  send\n  a draft.\nx\nNever send a draft.\n';
    expect(locateQuote(text, 'Never send a draft.')).toEqual({ startLine: 2, endLine: 3 });
    expect(locateQuote(text, 'Never send a draft.', { nearLine: 5 })).toEqual({ startLine: 5, endLine: 5 });
    expect(locateQuote(text, 'Never send a draft.', { fromLine: 4 })).toEqual({ startLine: 5, endLine: 5 });
    expect(locateQuote('It’s “fine”.', 'It\'s "fine".')).toEqual({ startLine: 1, endLine: 1 });
    expect(locateQuote(text, '   ')).toBeUndefined();
    expect(locateQuote(text, 'absent')).toBeUndefined();
  });

  it('checks a quote at its span only', () => {
    const text = 'a\nNever send a draft.\nc\n';
    expect(quoteAtSpan(text, { file: 'f', startLine: 2, endLine: 2, quote: 'Never send a draft.' })).toBe(
      true,
    );
    expect(quoteAtSpan(text, { file: 'f', startLine: 3, endLine: 3, quote: 'Never send a draft.' })).toBe(
      false,
    );
  });
});
