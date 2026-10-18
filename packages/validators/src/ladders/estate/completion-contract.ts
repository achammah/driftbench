import type { Spec } from '@agent-nexus/driftbench-core';
import type { EstateRun, GeneratedSpec } from './pipeline';

/** Required check structure is the generated structure plus source evidence. The latter
 * prevents deletion of a generated assertion from also deleting its validation probe.
 * No fixture names, item ids, hidden atom ids or product-mutant state select behavior. */
export function completionContract(run: EstateRun, source: GeneratedSpec): Spec {
  if (!source.loaded) throw new Error('Cannot inspect an unloaded spec');
  const spec = structuredClone(source.loaded.spec);
  const row = run.plan.plan.rows.find((r) => r.id === source.record.row);
  const atoms = run.scanned.map.atoms.filter((a) => row?.atomIds.includes(a.id));
  const head = atoms.find((a) => a.id === row?.atomIds[0]);
  const block = spec.blocks[0];
  if (!block || !head) return spec;
  block.expect ??= {};
  spec.rules ??= {};
  spec.rules.custom ??= {};
  const custom = spec.rules.custom;
  const fields = head.fields ?? {};
  const identity = { references: 'path', skills: 'name', tools: 'label', subagents: 'name' } as const;
  const append = (key: 'references' | 'skills' | 'tools' | 'subagents', entry: Record<string, unknown>) => {
    const expect = block.expect as Record<string, unknown>;
    const entries = (expect[key] ?? []) as Array<Record<string, unknown>>;
    if (entries.some((e) => JSON.stringify(e) === JSON.stringify(entry))) return;
    // An emitted entry with the same identity carries the requirement. An omitted count means
    // at least one, so it already satisfies `{ min: 1 }`; any weaker bound is raised to the
    // required minimum, never lowered, exactly as the guard reconstruction below does.
    const required = entry.count as { min?: number } | number | undefined;
    const index = entries.findIndex((e) => e[identity[key]] === entry[identity[key]]);
    const known = entries[index];
    if (known && typeof required === 'object' && typeof required.min === 'number') {
      const count = known.count as { min?: number; max?: number } | number | undefined;
      const knownMin = count === undefined ? 1 : typeof count === 'number' ? count : (count.min ?? 0);
      entries[index] = {
        ...known,
        count:
          typeof count === 'number' && count >= required.min
            ? count
            : { ...(typeof count === 'object' ? count : {}), min: Math.max(required.min, knownMin) },
      };
    } else entries.push(entry);
    expect[key] = entries;
  };
  const situation = run.situations.find((s) =>
    s.phrases.includes(String((block.when as { user?: string }).user)),
  );
  if (situation) {
    block.expect.workspace = {
      ...block.expect.workspace,
      ...Object.fromEntries(Object.entries(situation.touches).filter(([, paths]) => paths.length > 0)),
      others_untouched: true,
    };
  }
  if (['journey', 'read_when'].includes(source.record.testType)) {
    for (const atom of atoms) {
      if (atom.kind === 'subagent' && typeof atom.fields?.name === 'string')
        append('subagents', { name: atom.fields.name, count: { min: 1 } });
      for (const evidence of atom.evidence ?? []) {
        if (evidence.type === 'skill_loaded') append('skills', { name: evidence.name, count: { min: 1 } });
      }
      if (atom.kind === 'reference' && typeof atom.fields?.path === 'string')
        append('references', { path: `**/${atom.fields.path}`, count: { min: 1 } });
    }
  }
  if (source.record.testType === 'skip_pressure' && head.kind === 'gate' && typeof fields.path === 'string') {
    append('references', { path: `**/${fields.path}`, count: { min: 1 } });
    custom.ordered = { pairs: [{ before: `Read~${fields.path}`, after: 'Edit' }] };
  }
  if (source.record.testType === 'guard_register') {
    custom.guard_message ??= { name: fields.name, block: 0 };
    // The scanner owns the required selector, including whether verdict is constrained.
    // Reconstruct from evidence so deleting an emitted entry cannot delete its probe.
    for (const evidence of head.evidence ?? []) {
      if (evidence.type !== 'guard') continue;
      const entry = {
        name: evidence.name,
        ...(evidence.verdict === undefined ? {} : { verdict: evidence.verdict }),
        count: { min: evidence.min ?? 1 },
      };
      block.expect.guards ??= [];
      const index = block.expect.guards.findIndex((known) => known.name === evidence.name);
      if (index < 0) block.expect.guards.push(entry);
      else {
        const known = block.expect.guards[index];
        if (known)
          block.expect.guards[index] = {
            ...known,
            ...entry,
            ...(evidence.verdict === undefined && known.verdict !== undefined
              ? { verdict: known.verdict }
              : {}),
            count:
              typeof known.count === 'number' && known.count >= entry.count.min
                ? known.count
                : {
                    ...(typeof known.count === 'object' ? known.count : {}),
                    min: Math.max(
                      entry.count.min,
                      typeof known.count === 'object' ? (known.count.min ?? 0) : 0,
                    ),
                  },
          };
      }
    }
  }
  if (source.record.testType === 'guard_negative') {
    const guard = run.estate.guards.find((g) => g.name === fields.name);
    if (guard?.verdict === 'warn') block.expect.guards = [{ name: guard.name, verdict: 'warn', count: 0 }];
  }
  if (['stage_order', 'stage_anytime'].includes(source.record.testType) && fields.anytime === true)
    custom.stage_seen ??= { name: fields.id, block: 0 };
  if (source.record.testType === 'hazard_recovery') {
    // Required targets come from map evidence, independently of generated assertions.
    // Missing source declarations stay gaps; arbitrary source prose cannot fill them.
    const recovery = recoveryEvidenceOf(head);
    const required = recovery.reread;
    const known = (custom.hazard_recovery ?? {}) as {
      reread?: string[];
      calls?: RecoveryCall[];
      retry?: boolean;
    };
    custom.hazard_recovery = {
      ...known,
      hazard: fields.hazard,
      block: 0,
      // This validator-only option is deliberately unsupported by completionComponents:
      // its named gap prevents an empty source contract from passing as an easier demand.
      ...(recovery.gap ? { [recovery.gap]: true } : {}),
      ...(recovery.calls.length > 0 ? { calls: [...(known.calls ?? []), ...recovery.calls] } : {}),
      ...(recovery.retry ? { retry: true } : {}),
      ...(required.length > 0 || known.reread
        ? { reread: [...new Set([...(known.reread ?? []), ...required])] }
        : {}),
    };
  }
  if (['tool_boundary', 'tool_denied'].includes(source.record.testType) && typeof fields.rule === 'string') {
    if (fields.effect === 'declared') {
      const owner = run.scanned.map.atoms.find(
        (atom) => ['skill', 'subagent'].includes(atom.kind) && atom.provenance.file === head.provenance.file,
      );
      if (owner && typeof owner.fields?.name === 'string')
        append(owner.kind === 'skill' ? 'skills' : 'subagents', {
          name: owner.fields.name,
          count: { min: 1 },
        });
    }
    if (fields.effect === 'deny' && !fields.rule.includes('(')) {
      append('tools', { label: fields.rule, count: 0 });
      const offered = block.expect.tools_offered ?? {};
      offered.exclude = [...new Set([...(offered.exclude ?? []), fields.rule])];
      block.expect.tools_offered = offered;
    } else {
      // The source permission retains its argument restriction if compilation broadens it.
      custom.permission = { rules: [{ effect: fields.effect, rule: fields.rule }], block: 0 };
    }
  }
  return spec;
}

/** Scope is semantic, not a list of bank ids. Other generation groups retain their oracle. */
export function completionApplies(run: EstateRun, source: GeneratedSpec): boolean {
  const row = run.plan.plan.rows.find((r) => r.id === source.record.row);
  const head = run.scanned.map.atoms.find((a) => a.id === row?.atomIds[0]);
  const f = head?.fields ?? {};
  switch (source.record.testType) {
    case 'read_when':
    case 'guard_register':
    case 'tool_boundary':
    case 'tool_denied':
      return true;
    case 'guard_negative':
      return run.estate.guards.some((g) => g.name === f.name && g.verdict === 'warn');
    case 'journey':
      return head?.kind === 'route';
    case 'skip_pressure':
      return head?.kind === 'gate' && typeof f.path === 'string';
    case 'stage_anytime':
    case 'stage_order':
      return f.anytime === true;
    case 'hazard_recovery':
      return f.hazard === 'compaction';
    default:
      return false;
  }
}

type RecoverySource = {
  provenance?: { file: string; quote: string };
  fields?: Record<string, unknown>;
  evidence?: ReadonlyArray<{ type: string; name?: string; options?: Record<string, unknown> }>;
};

type RecoveryCall = { label: string; input: Record<string, unknown> };

/** Typed recovery declarations are independent of source phrasing and generated assertions. */
function recoveryEvidenceOf(atom: RecoverySource): {
  reread: string[];
  calls: RecoveryCall[];
  retry: boolean;
  gap?: string;
} {
  const reread = new Set<string>();
  const calls: RecoveryCall[] = [];
  let retry = false;
  let invalid = false;
  const declarations: unknown[] = atom.fields?.recovery === undefined ? [] : [atom.fields.recovery];
  for (const evidence of atom.evidence ?? [])
    if (evidence.type === 'custom' && evidence.name === 'hazard_recovery' && evidence.options)
      declarations.push(evidence.options);
  for (const declaration of declarations) {
    if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
      invalid = true;
      continue;
    }
    const source = declaration as Record<string, unknown>;
    if (source.reread !== undefined) {
      if (!Array.isArray(source.reread)) invalid = true;
      else
        for (const path of source.reread) {
          if (typeof path !== 'string' || path.trim() === '') invalid = true;
          else reread.add(path);
        }
    }
    if (source.calls !== undefined) {
      if (!Array.isArray(source.calls)) invalid = true;
      else
        for (const call of source.calls) {
          if (typeof call !== 'object' || call === null || Array.isArray(call)) {
            invalid = true;
            continue;
          }
          const value = call as Record<string, unknown>;
          if (
            typeof value.label !== 'string' ||
            value.label.trim() === '' ||
            typeof value.input !== 'object' ||
            value.input === null ||
            Array.isArray(value.input)
          )
            invalid = true;
          else calls.push({ label: value.label, input: value.input as Record<string, unknown> });
        }
    }
    if (source.retry === true) retry = true;
    else if (source.retry !== undefined && source.retry !== false) invalid = true;
  }
  return {
    reread: [...reread],
    calls,
    retry,
    ...(invalid
      ? { gap: 'invalid_source_recovery_evidence' }
      : reread.size === 0 && calls.length === 0 && !retry
        ? { gap: 'missing_source_recovery_evidence' }
        : {}),
  };
}

/** Reread paths are declared by fields.recovery or custom hazard_recovery evidence. */
export function rereadOf(atom: RecoverySource): string[] {
  return recoveryEvidenceOf(atom).reread;
}
