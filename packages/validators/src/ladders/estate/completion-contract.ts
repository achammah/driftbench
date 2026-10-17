import type { Spec } from '@agent-nexus/driftbench-core';
import { ACTING_VERDICTS, answersWithoutStopping } from './completion';
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
      if (atom.kind === 'script') {
        // A script of the walk ran: the commands of the block include one, and a call of the tool names it. Both come
        // from the script atom's own evidence, so deleting a generated assertion cannot delete its probe.
        block.expect.execution = { ...block.expect.execution, ran_code: true };
        for (const evidence of atom.evidence ?? []) {
          if (evidence.type !== 'tool_called') continue;
          const calls = ((custom.some_call as { calls?: Array<Record<string, unknown>> } | undefined)
            ?.calls ?? []) as Array<Record<string, unknown>>;
          const at = calls.findIndex(
            (call) =>
              call.label === evidence.label &&
              JSON.stringify(call.input ?? {}) === JSON.stringify(evidence.input ?? {}),
          );
          const known = calls[at];
          if (!known)
            calls.push({ label: evidence.label, input: evidence.input ?? {}, count: { min: 1 }, block: 0 });
          else if (known.count !== undefined) {
            // The script ran at least once: a weaker bound is raised to one, never lowered. An omitted count
            // already means at least one.
            const count = known.count as { min?: number; max?: number } | number;
            calls[at] = {
              ...known,
              count:
                typeof count === 'number' && count >= 1
                  ? count
                  : {
                      ...(typeof count === 'object' ? count : {}),
                      min: Math.max(1, (count as { min?: number }).min ?? 0),
                    },
            };
          }
          custom.some_call = { calls };
        }
      }
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
    // A control forbids the verdicts by which the guard acts. The scanner owns the selector, as for guard_register: the
    // guard's declared verdict, or every acting verdict when it declares none. The true verdict of a guard that answers
    // without stopping (warn, nudge) is always demanded, so a declaration that names another verdict cannot hide it.
    if (guard && answersWithoutStopping(guard.verdict)) {
      const evidence = (head.evidence ?? []).filter(
        (item): item is Extract<typeof item, { type: 'guard' }> => item.type === 'guard',
      );
      const verdicts = new Set<string>([guard.verdict]);
      for (const item of evidence)
        for (const verdict of item.verdict === undefined ? ACTING_VERDICTS : [item.verdict])
          verdicts.add(verdict);
      // Keep the product's own order, which names the verdicts of its checks, then add what it left out.
      const kept = (block.expect.guards ?? []).filter(
        (known) => known.name !== guard.name || (known.verdict !== undefined && verdicts.has(known.verdict)),
      );
      const present = new Set(
        kept.filter((known) => known.name === guard.name).map((known) => known.verdict),
      );
      block.expect.guards = [
        ...kept.map((known) => (known.name === guard.name ? { ...known, count: 0 } : known)),
        ...[...verdicts]
          .filter((verdict) => !present.has(verdict))
          .map((verdict) => ({ name: guard.name, verdict, count: 0 })),
      ];
    }
  }
  if (['stage_order', 'stage_anytime'].includes(source.record.testType) && fields.anytime === true)
    custom.stage_seen ??= { name: fields.id, block: 0 };
  if (source.record.testType === 'hazard_recovery') {
    // The passage names what the agent must read again after the hazard ("re-read this file", a backticked path).
    // Recovered here from the source atom, so a generated spec that drops the reread cannot drop its demand.
    const required = rereadOf(head);
    const known = (custom.hazard_recovery ?? {}) as { reread?: string[] };
    custom.hazard_recovery = {
      ...known,
      hazard: String(fields.hazard).includes('compaction') ? 'compaction' : fields.hazard,
      block: 0,
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
      return run.estate.guards.some((g) => g.name === f.name && answersWithoutStopping(g.verdict));
    case 'journey':
      return head?.kind === 'route';
    case 'skip_pressure':
      return head?.kind === 'gate' && typeof f.path === 'string';
    case 'stage_anytime':
    case 'stage_order':
      return f.anytime === true;
    case 'hazard_recovery':
      return String(f.hazard).includes('compaction');
    default:
      return false;
  }
}

/**
 * The paths a rule asks the agent to read again, from the passage alone: backticked paths, words with a file
 * extension, and "this file" or "this document", which name the file the passage stands in. A phrase that names no
 * path ("the open tracker note") asks for none the oracle can check.
 */
export function rereadOf(atom: {
  provenance: { file: string; quote: string };
  fields?: Record<string, unknown>;
}): string[] {
  const quote = atom.provenance.quote;
  const found: string[] = [];
  const add = (path: string) => {
    const clean = path.replace(/[.,;:]+$/, '');
    if (clean !== '' && !found.includes(clean)) found.push(clean);
  };
  for (const match of quote.matchAll(
    /`([^`\s]+)`|(?:^|\s)((?:[\w.-]+\/)*[\w-]+\.(?:md|json|ya?ml|txt|csv))\b/g,
  ))
    add(match[1] ?? match[2] ?? '');
  if (/\bre-?read\b[^.;]*\bthis (?:file|document)\b/i.test(quote)) add(atom.provenance.file);
  return found;
}
