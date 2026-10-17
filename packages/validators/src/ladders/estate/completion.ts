import {
  type Assertion,
  type ExecutionRecord,
  globMatches,
  matchAssertion,
  type Observed,
  type Spec,
  type ToolCall,
} from '@agent-nexus/driftbench-core';
import { operationWitnesses } from './operation-witnesses';

export type Component = {
  id: string;
  block: number;
  channel: 'expect' | 'custom';
  check: string;
  prepare?: (o: Observed) => void;
  change: (o: Observed) => void;
  verdicts: string[];
  controlVerdicts: string[];
  violationOutcome?: 'fail' | 'inconclusive' | 'not_applicable' | 'absent';
};
export type ComponentInventory = { components: Component[]; gaps: string[] };
type RecordValue = Record<string, unknown>;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing derived assertion component');
  return value;
}
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' ? (value as RecordValue) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const rows = (value: unknown): RecordValue[] => (Array.isArray(value) ? value.map(record) : []);
const foreign = '__outside_assertion__';
// A bounded universal witness basis exercises the beginning, interior and end.
const positions = ['first', 'middle', 'last'] as const;
function atPosition<T>(values: T[], position: (typeof positions)[number]): T | undefined {
  return values[
    position === 'first' ? 0 : position === 'last' ? values.length - 1 : Math.floor(values.length / 2)
  ];
}

/** A schema visitor, not a mutant catalogue. Each check adapter expands its conjunctions,
 * finite count bounds and universal quantifiers into independently falsifiable clauses.
 * Unknown shapes are named gaps, never silently counted as covered. */
export function completionComponents(spec: Spec): ComponentInventory {
  const inventory: ComponentInventory = { components: [], gaps: [] };
  spec.blocks.forEach((block, index) => {
    const visit = (channel: Component['channel'], check: string, value: unknown) => {
      if (Array.isArray(value) && value.length === 0) return;
      const prefix = `${index}.${channel}.${check}`;
      const add = (clause: string, change: Component['change'], prepare?: Component['prepare']) =>
        inventory.components.push({
          id: `${prefix}.${clause}`,
          block: index,
          channel,
          check,
          change,
          verdicts: verdictIds(check, value, clause),
          controlVerdicts: verdictIds(
            check,
            value,
            clause.startsWith('event') ? 'resumed.call_or_text' : clause,
          ),
          ...(prepare ? { prepare } : {}),
        });
      const gap = (clause: string) => inventory.gaps.push(`${prefix}.${clause}`);
      const opts = record(value);
      const keys = (allowed: string[]) => {
        for (const key of Object.keys(opts)) if (!allowed.includes(key)) gap(`unsupported-option:${key}`);
      };
      if (channel === 'expect' && ['guards', 'references', 'skills', 'subagents', 'tools'].includes(check)) {
        for (const [at, entry] of rows(value).entries()) {
          const identity = check === 'references' ? 'path' : check === 'tools' ? 'label' : 'name';
          const matches = (r: RecordValue) =>
            (identity === 'path'
              ? globMatches(String(entry.path), String(r.path))
              : r[identity] === entry[identity]) &&
            (entry.verdict === undefined || r.verdict === entry.verdict) &&
            (entry.model === undefined || r.model === entry.model);
          const get = (o: Observed): RecordValue[] =>
            check === 'tools' ? (o.toolCalls as unknown as RecordValue[]) : rows(record(o.runtime)[check]);
          const set = (o: Observed, values: RecordValue[]) => {
            if (check === 'tools') o.toolCalls = values as unknown as ToolCall[];
            else {
              o.runtime ??= {};
              (o.runtime as RecordValue)[check] = values;
            }
          };
          const sample: RecordValue = {
            [identity]: String(entry[identity]).replace(/^\*\*\//, ''),
            ...(entry.verdict ? { verdict: entry.verdict } : {}),
            ...(entry.model ? { model: entry.model } : {}),
          };
          if (check === 'tools') sample.input = {};
          if (check === 'guards' && sample.verdict === undefined) sample.verdict = 'allow';
          const count = entry.count ?? { min: 1 };
          const min = typeof count === 'number' ? count : Number(record(count).min ?? 0);
          const max = typeof count === 'number' ? count : Number(record(count).max ?? Infinity);
          const resize = (o: Observed, n: number) => {
            const current = get(o);
            const exemplar = current.find(matches) ?? sample;
            set(o, [
              ...current.filter((r) => !matches(r)),
              ...Array.from({ length: n }, () => structuredClone(exemplar)),
            ]);
          };
          if (min > 0) {
            add(`${at}.count.min`, (o) => resize(o, min - 1));
            for (const n of new Set([min, Number.isFinite(max) ? max : min + 1]))
              add(
                `${at}.count.boundary.${n}`,
                (o) => resize(o, min - 1),
                (o) => resize(o, n),
              );
            // A matching entry need not be the first observation. Preserve all existing
            // entries, but place nonmatching evidence on both sides of them.
            add(
              `${at}.selection.all-entries`,
              (o) => resize(o, min - 1),
              (o) => {
                resize(o, min);
                const irrelevant = {
                  ...structuredClone(get(o).find(matches) ?? sample),
                  [identity]: foreign,
                };
                set(o, [irrelevant, ...get(o), structuredClone(irrelevant)]);
              },
            );
          }
          if (Number.isFinite(max)) add(`${at}.count.max`, (o) => resize(o, max + 1));
          if (min === 0 && Number.isFinite(max))
            for (const variant of comparisonWitnesses(String(entry[identity]))) {
              const candidate = { ...sample, [identity]: variant.value };
              if (matches(candidate)) continue;
              add(
                `${at}.negative.selector.${identity}.${variant.name}`,
                (o) => resize(o, max + 1),
                (o) => {
                  resize(o, max);
                  set(o, [...get(o), candidate]);
                },
              );
            }
          if (min > 0) {
            // Same cardinality, wrong selector. Detects name/path/model/verdict filters being ignored.
            for (const field of [identity, ...['verdict', 'model'].filter((k) => entry[k] !== undefined)])
              for (const variant of comparisonWitnesses(String(entry[field]))) {
                const candidate = { ...sample, [field]: variant.value };
                if (matches(candidate)) continue;
                add(`${at}.selector.${field}.${variant.name}`, (o) => {
                  resize(o, min);
                  for (const r of get(o).filter(matches)) r[field] = variant.value;
                });
              }
          }
          for (const key of Object.keys(entry))
            if (![identity, 'count', 'verdict', 'model'].includes(key))
              gap(`${at}.unsupported-clause:${key}`);
        }
        if (['guards', 'skills'].includes(check)) {
          add('evidence.runtime', (o) => {
            delete o.runtime;
          });
          required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
        }
        if (['references', 'subagents'].includes(check)) {
          add('evidence.channel', (o) => {
            if (o.runtime) delete (o.runtime as RecordValue)[check];
          });
          required(inventory.components.at(-1)).violationOutcome = 'absent';
        }
      } else if (channel === 'expect' && check === 'workspace') {
        keys(['created', 'changed', 'deleted', 'others_untouched']);
        add('evidence.diff', (o) => {
          delete o.workspaceDiff;
        });
        required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
        for (const set of ['created', 'changed', 'deleted'] as const) {
          if (opts[set] === undefined) continue;
          const paths = strings(opts[set]);
          if (paths.length === 0)
            add(`${set}.empty`, (o) => {
              o.workspaceDiff ??= { created: [], changed: [], deleted: [] };
              o.workspaceDiff[set].push(foreign);
            });
          for (const [at, path] of paths.entries())
            add(`${set}.${at}.present`, (o) => {
              if (o.workspaceDiff) o.workspaceDiff[set] = o.workspaceDiff[set].filter((p) => p !== path);
            });
        }
        for (const set of ['created', 'changed', 'deleted'] as const) {
          for (const [at, path] of strings(opts[set]).entries()) {
            for (const variant of comparisonWitnesses(path))
              add(`${set}.${at}.selector.${variant.name}`, (o) => {
                if (o.workspaceDiff)
                  o.workspaceDiff[set] = o.workspaceDiff[set].map((p) => (p === path ? variant.value : p));
              });
            add(
              `${set}.${at}.selection.all-entries`,
              (o) => {
                if (o.workspaceDiff) o.workspaceDiff[set] = o.workspaceDiff[set].filter((p) => p !== path);
              },
              (o) => {
                o.workspaceDiff?.[set].unshift(foreign);
              },
            );
            add(`${set}.${at}.operation`, (o) => {
              if (!o.workspaceDiff) return;
              o.workspaceDiff[set] = o.workspaceDiff[set].filter((p) => p !== path);
              o.workspaceDiff[set === 'changed' ? 'created' : 'changed'].push(path);
            });
          }
        }
        if (opts.others_untouched === true) {
          const named = ['created', 'changed', 'deleted'].flatMap((set) => strings(opts[set]));
          for (const set of ['created', 'changed', 'deleted'] as const) {
            const change = (o: Observed) => {
              o.workspaceDiff ??= { created: [], changed: [], deleted: [] };
              o.workspaceDiff[set].push(foreign);
            };
            add(`others_untouched.${set}`, change);
            for (const [at, path] of named.entries())
              for (const variant of comparisonWitnesses(path))
                if (!named.includes(variant.value))
                  add(`others_untouched.${set}.${at}.selector.${variant.name}`, (o) => {
                    o.workspaceDiff ??= { created: [], changed: [], deleted: [] };
                    o.workspaceDiff[set].push(variant.value);
                  });
            if (named[0])
              add(`others_untouched.${set}.all-entries`, change, (o) => {
                o.workspaceDiff ??= { created: [], changed: [], deleted: [] };
                o.workspaceDiff[set].unshift(required(named[0]));
              });
          }
        }
      } else if (channel === 'expect' && check === 'tools_offered') {
        keys(['include', 'exclude']);
        add('evidence.offered', (o) => {
          if (o.runtime) delete o.runtime.offered;
        });
        required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
        for (const [at, name] of strings(opts.include).entries()) {
          add(`include.${at}`, (o) => {
            o.runtime ??= {};
            o.runtime.offered = (o.runtime.offered ?? []).filter((n) => n !== name);
          });
          for (const variant of comparisonWitnesses(name))
            add(`include.${at}.selector.${variant.name}`, (o) => {
              if (o.runtime?.offered)
                o.runtime.offered = o.runtime.offered.map((n) => (n === name ? variant.value : n));
            });
        }
        for (const [at, name] of strings(opts.exclude).entries()) {
          const change = (o: Observed) => {
            o.runtime ??= {};
            o.runtime.offered = [...(o.runtime.offered ?? []), name];
          };
          add(`exclude.${at}`, change);
          for (const variant of comparisonWitnesses(name))
            add(`exclude.${at}.selector.${variant.name}`, change, (o) => {
              o.runtime ??= {};
              o.runtime.offered = [...(o.runtime.offered ?? []), variant.value];
            });
        }
      } else if (channel === 'custom' && check === 'stage_seen') {
        keys(['name', 'block']);
        add('evidence.stages', (o) => {
          if (o.runtime) delete o.runtime.stages;
        });
        required(inventory.components.at(-1)).violationOutcome = 'not_applicable';
        add('exists', (o) => {
          if (o.runtime?.stages) o.runtime.stages = o.runtime.stages.filter((s) => s.name !== opts.name);
        });
        for (const variant of comparisonWitnesses(String(opts.name)))
          add(`exists.selector.${variant.name}`, (o) => {
            for (const stage of o.runtime?.stages ?? [])
              if (stage.name === opts.name) stage.name = variant.value;
          });
        add(
          'exists.all-entries',
          (o) => {
            if (o.runtime?.stages) o.runtime.stages = o.runtime.stages.filter((s) => s.name !== opts.name);
          },
          (o) => {
            o.runtime?.stages?.unshift({ name: foreign });
          },
        );
      } else if (channel === 'custom' && check === 'guard_message') {
        keys(['name', 'mustNot', 'block']);
        const matches = (g: RecordValue) =>
          g.name === opts.name && ['deny', 'block', 'warn'].includes(String(g.verdict));
        const selected = (o: Observed) => rows(o.runtime?.guards).filter(matches);
        add('intervention.exists', (o) => {
          if (o.runtime?.guards) o.runtime.guards = o.runtime.guards.filter((g) => !matches(g));
        });
        for (const variant of comparisonWitnesses(String(opts.name)))
          add(`intervention.selector.${variant.name}`, (o) => {
            for (const g of selected(o)) g.name = variant.value;
          });
        const prepare = (o: Observed) => {
          const found = selected(o);
          if (!found[0]) throw new Error('No conforming intervention for guard_message');
          while (selected(o).length < 3)
            o.runtime?.guards?.push(
              structuredClone(found[0]) as NonNullable<NonNullable<Observed['runtime']>['guards']>[number],
            );
        };
        // Expand the universal quantifier over the shared positional witness basis.
        const each = (clause: string, edit: (g: RecordValue) => void) => {
          for (const position of positions)
            add(
              `every.${clause}.${position}`,
              (o) => {
                const gs = selected(o);
                const g = atPosition(gs, position);
                if (g) edit(g);
              },
              prepare,
            );
        };
        each('message.nonempty', (g) => {
          g.stdout = '';
          g.stderr = '';
        });
        each('message.available', (g) => {
          delete g.stdout;
          delete g.stderr;
        });
        for (const component of inventory.components.filter(
          (c) => c.id.startsWith(prefix) && c.id.includes('message.available'),
        ))
          component.violationOutcome = 'fail';
        add(
          'evidence.output',
          (o) => {
            for (const g of selected(o)) {
              delete g.stdout;
              delete g.stderr;
            }
          },
          prepare,
        );
        required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
        const interventions = ['deny', 'block', 'warn'];
        const excludedVerdicts = new Set([
          'allow',
          ...interventions.flatMap((value) =>
            comparisonWitnesses(value)
              .map((variant) => variant.value)
              .filter((value) => !/^(deny|block)$/i.test(value) && value !== 'warn'),
          ),
        ]);
        for (const verdict of excludedVerdicts)
          add(
            `intervention.exclude.${verdict}`,
            (o) => {
              for (const g of selected(o)) {
                g.stdout = '';
                g.stderr = '';
              }
            },
            (o) => {
              prepare(o);
              const g = structuredClone(selected(o)[0]);
              if (!g) throw new Error('Missing guard run');
              g.verdict = verdict;
              delete g.stdout;
              delete g.stderr;
              o.runtime?.guards?.push(g as NonNullable<NonNullable<Observed['runtime']>['guards']>[number]);
            },
          );
        const encode = (g: RecordValue, text: string, form: string) => {
          g.stderr = '';
          g.stdout = JSON.stringify(
            form === 'hookSpecificOutput'
              ? { hookSpecificOutput: { permissionDecisionReason: text } }
              : { [form]: text },
          );
        };
        const textOf = (g: RecordValue) => {
          const stdout = String(g.stdout ?? '');
          try {
            const parsed = record(JSON.parse(stdout));
            const reason =
              record(parsed.hookSpecificOutput).permissionDecisionReason ??
              parsed.reason ??
              parsed.systemMessage;
            if (typeof reason === 'string') return reason;
          } catch {
            /* Plain text is also supported. */
          }
          return String(g.stderr || stdout);
        };
        for (const channel of ['stdout', 'stderr'])
          add(
            `message.channel.${channel}`,
            (o) => {
              for (const g of selected(o)) {
                g.stdout = '';
                g.stderr = '';
              }
            },
            (o) => {
              prepare(o);
              for (const g of selected(o)) {
                const text = textOf(g);
                delete g.stdout;
                delete g.stderr;
                g[channel] = text;
              }
            },
          );
        for (const form of ['hookSpecificOutput', 'reason', 'systemMessage']) {
          const structured = (o: Observed) => {
            prepare(o);
            for (const g of selected(o)) encode(g, textOf(g), form);
          };
          add(
            `message.structured.${form}`,
            (o) => {
              for (const g of selected(o)) encode(g, '   ', form);
            },
            structured,
          );
          for (const [at, pattern] of strings(opts.mustNot).entries()) {
            const witness = literalPattern(pattern);
            if (witness !== undefined)
              add(
                `every.mustNot.${at}.structured.${form}`,
                (o) => {
                  const g = selected(o).at(-1);
                  if (g) encode(g, witness, form);
                },
                structured,
              );
          }
        }
        for (const [at, pattern] of strings(opts.mustNot).entries()) {
          const witness = literalPattern(pattern);
          if (witness === undefined) gap(`mustNot.${at}.regex-witness`);
          else
            each(`mustNot.${at}`, (g) => {
              g.stdout = '';
              g.stderr = witness;
            });
        }
      } else if (channel === 'custom' && check === 'hazard_recovery') {
        keys(['hazard', 'reread', 'block']);
        const from = (o: Observed) =>
          Number(rows(record(o.raw).markers).find((m) => m.kind === 'compaction')?.afterToolCalls ?? 0);
        if (opts.hazard === 'compaction') {
          add('event', (o) => {
            record(o.raw).markers = [];
          });
          required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
          for (const field of ['kind', 'afterToolCalls']) {
            add(`event.evidence.${field}`, (o) => {
              for (const marker of rows(record(o.raw).markers)) delete marker[field];
            });
            required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
          }
          add(
            'event.all-markers',
            (o) => {
              record(o.raw).markers = rows(record(o.raw).markers).filter((m) => m.kind !== 'compaction');
            },
            (o) => {
              record(o.raw).markers = [
                { kind: 'fixture-status', afterToolCalls: 0 },
                ...rows(record(o.raw).markers),
              ];
            },
          );
          required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
          for (const variant of comparisonWitnesses('compaction')) {
            add(`event.selector.${variant.name}`, (o) => {
              for (const marker of rows(record(o.raw).markers))
                if (marker.kind === 'compaction') marker.kind = variant.value;
            });
            required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
          }
        }
        if (strings(opts.reread).length === 0) {
          const stop = (o: Observed) => {
            o.toolCalls = o.toolCalls.slice(0, from(o));
            o.text = '';
            o.segments = [];
          };
          add('resumed.call_or_text', stop);
          add('resumed.single-call', stop, (o) => {
            const n = from(o);
            o.toolCalls = [
              ...o.toolCalls.slice(0, n),
              { label: 'Read', input: { file_path: 'fixture-evidence.md' } },
            ];
            o.text = '';
            o.segments = [];
          });
          add('resumed.only-text', stop, (o) => {
            o.toolCalls = o.toolCalls.slice(0, from(o));
            o.text = 'Fixture recovery continues.';
            o.segments = [];
          });
        }
        // With a reread named, resuming is not a separate demand: every reread is a call after the hazard, so the
        // only trace that breaks "calls or text after the hazard" (none) breaks each reread as well. The reread
        // clauses below carry it, and each is falsified alone.

        for (const [at, path] of strings(opts.reread).entries())
          add(`reread.${at}.after-event`, (o) => {
            const n = from(o);
            o.toolCalls = o.toolCalls.filter(
              (c, i) => i < n || c.label !== 'Read' || !String(record(c.input).file_path).endsWith(path),
            );
          });
        add(
          'every.collateral.ignores-null-marker',
          (o) => {
            o.toolCalls.push({ label: 'Delete', input: {} });
          },
          (o) => {
            record(o.raw).markers = [null, ...rows(record(o.raw).markers)];
          },
        );
        for (const [kind, input] of [['null', null]] as const)
          add(
            `collateral.unknown-tool-input.${kind}`,
            (o) => {
              o.toolCalls.push({ label: 'Delete', input: {} });
            },
            (o) => {
              o.toolCalls.push({ label: 'Bash', input });
            },
          );
        const operations = operationWitnesses();
        for (const problem of operations.gaps) gap(`collateral.operation:${problem}`);
        const commandWitness = operations.harmful.find(
          (witness) => typeof witness.input.command === 'string',
        );
        if (commandWitness)
          add(
            'every.collateral.input-record-type',
            (o) => {
              o.toolCalls.push({ label: 'Delete', input: {} });
            },
            (o) => {
              if (commandWitness.needsNoDiff) delete o.workspaceDiff;
              o.toolCalls.push({
                label: commandWitness.label,
                input: Object.assign([], commandWitness.input),
              });
            },
          );
        for (const witness of operations.harmful)
          add(
            `every.collateral.${witness.id}`,
            (o) => {
              o.toolCalls.push({ label: witness.label, input: structuredClone(witness.input) });
            },
            witness.needsNoDiff
              ? (o) => {
                  delete o.workspaceDiff;
                }
              : undefined,
          );
        for (const witness of operations.benign)
          add(
            `every.collateral.benign.${witness.id}`,
            (o) => {
              o.toolCalls.push({ label: 'Delete', input: {} });
            },
            (o) => {
              if (witness.needsNoDiff) delete o.workspaceDiff;
              o.toolCalls.push({ label: witness.label, input: structuredClone(witness.input) });
            },
          );
        if (opts.hazard === 'compaction')
          add(
            'every.collateral.event-window',
            (o) => {
              o.toolCalls.push({ label: 'Delete', input: { file_path: 'fixture.md' } });
            },
            (o) => {
              o.toolCalls.unshift({ label: 'Delete', input: { file_path: 'fixture-before-event.md' } });
              for (const marker of rows(record(o.raw).markers))
                if (marker.kind === 'compaction')
                  marker.afterToolCalls = Number(marker.afterToolCalls ?? 0) + 1;
            },
          );
      } else if (channel === 'custom' && check === 'permission') {
        keys(['rules', 'effect', 'rule', 'block']);
        for (const [at, entry] of (Array.isArray(opts.rules) ? rows(opts.rules) : [opts]).entries()) {
          const rule = String(entry.rule);
          const label = rule.split('(')[0] ?? '';
          const pattern = /^([^()]+)\((.*)\)$/.exec(rule)?.[2];
          const match = (c: ToolCall) =>
            c.label === label &&
            (!pattern ||
              ruleMatches(
                pattern,
                String(
                  record(c.input).command ??
                    record(c.input).file_path ??
                    record(c.input).url ??
                    record(c.input).path ??
                    '',
                ),
              ));
          const key = label === 'Bash' ? 'command' : label === 'WebFetch' ? 'url' : 'file_path';
          const events = (o: Observed, c: ToolCall, subtype: string) =>
            rows(record(o.raw).kept).filter(
              (e) => record(e.record).requestId === c.id && record(e.record).subtype === subtype,
            );
          // Selection witnesses preserve identity joins. Otherwise a second failing
          // predicate can mask a weakened selector within the same verdict.
          const select = (o: Observed, edit: (c: ToolCall) => void) => {
            for (const c of o.toolCalls.filter(match)) {
              const requests = events(o, c, 'permission_request');
              edit(c);
              if (entry.effect === 'ask')
                for (const e of requests) {
                  record(e.record).tool = c.label;
                  record(e.record).input = structuredClone(c.input);
                }
            }
          };
          const examples = pattern?.endsWith(':*')
            ? [pattern.slice(0, -2), `${pattern.slice(0, -2)} `, `${pattern.slice(0, -2)} fixture`]
            : [pattern?.replace(/\*/g, 'fixture') ?? 'fixture'];
          if (entry.effect === 'deny') {
            const input = { [key]: pattern?.replace(/:\*$/, '').replace(/\*/g, 'fixture') ?? 'fixture' };
            const change = (o: Observed) => {
              o.toolCalls.push({ label, input });
            };
            add(`${at}.no-call`, change);
            for (const variant of comparisonWitnesses(label))
              add(`${at}.no-call.label.${variant.name}`, change, (o) => {
                o.toolCalls.push({ label: variant.value, input });
              });
            if (pattern)
              for (const variant of comparisonWitnesses(String(input[key])))
                if (!ruleMatches(pattern, variant.value))
                  add(`${at}.no-call.pattern.${variant.name}`, change, (o) => {
                    o.toolCalls.push({ label, input: { [key]: variant.value } });
                  });
            continue;
          }
          add(`${at}.covered.exists`, (o) => {
            o.toolCalls = o.toolCalls.filter((c) => !match(c));
          });
          if (pattern && pattern !== '*' && !ruleMatches(pattern, foreign))
            add(`${at}.covered.pattern`, (o) => {
              select(o, (c) => {
                c.input = { ...record(c.input), [key]: foreign };
              });
            });
          for (const variant of comparisonWitnesses(label))
            add(`${at}.covered.label.${variant.name}`, (o) => {
              select(o, (c) => {
                c.label = variant.value;
              });
            });
          if (pattern) {
            for (const [basis, example] of examples.entries())
              for (const variant of comparisonWitnesses(example))
                if (!ruleMatches(pattern, variant.value))
                  add(`${at}.covered.pattern.${basis}.${variant.name}`, (o) => {
                    select(o, (c) => {
                      c.input = { ...record(c.input), [key]: variant.value };
                    });
                  });
            if (entry.effect !== 'ask')
              add(`${at}.covered.pattern.string-type`, (o) => {
                select(o, (c) => {
                  c.input = { ...record(c.input), [key]: [record(c.input)[key]] };
                });
              });
          }
          const prepare = (o: Observed) => {
            const calls = o.toolCalls.filter(match);
            if (!calls[0]) throw new Error('No conforming covered call');
            while (o.toolCalls.filter(match).length < 3) {
              const copy = structuredClone(calls[0]);
              copy.id = `${copy.id}-quantified-${o.toolCalls.length}`;
              o.toolCalls.push(copy);
              const kept = rows(record(o.raw).kept);
              for (const event of kept.filter((e) => record(e.record).requestId === calls[0]?.id))
                kept.push({
                  ...structuredClone(event),
                  record: { ...record(event.record), requestId: copy.id },
                });
              record(o.raw).kept = kept;
            }
          };
          const each = (
            clause: string,
            edit: (o: Observed, c: ToolCall) => void,
            extra?: (o: Observed) => void,
          ) => {
            for (const position of positions)
              add(
                `${at}.every.${clause}.${position}`,
                (o) => {
                  const calls = o.toolCalls.filter(match);
                  const call = atPosition(calls, position);
                  if (call) edit(o, call);
                },
                (o) => {
                  prepare(o);
                  extra?.(o);
                },
              );
          };
          if (entry.effect !== 'ask')
            each('not-refused', (_o, c) => {
              c.error = 'permission denied';
            });
          else {
            for (const subtype of ['permission_request', 'permission_decision']) {
              each(`${subtype}.exists`, (o, c) => {
                record(o.raw).kept = rows(record(o.raw).kept).filter(
                  (e) => !events(o, c, subtype).includes(e),
                );
              });
              for (const variant of comparisonWitnesses(subtype))
                each(`${subtype}.selector.${variant.name}`, (o, c) => {
                  for (const e of events(o, c, subtype)) record(e.record).subtype = variant.value;
                });
            }
            for (const field of ['tool', 'input', 'requestId'])
              each(`request.${field}.matches`, (o, c) => {
                // A request/call id mismatch preserves the request/decision join.
                // It must not also falsify the separate decision-identity component.
                if (field === 'requestId')
                  for (const e of events(o, c, 'permission_decision')) record(e.record).requestId = foreign;
                for (const e of events(o, c, 'permission_request'))
                  record(e.record)[field] = field === 'input' ? {} : foreign;
              });
            const inputWithPath = (o: Observed) => {
              const command = `${examples[0]} ./fixture/record`;
              if (!pattern || !ruleMatches(pattern, command)) return;
              select(o, (c) => {
                c.input = { ...record(c.input), [key]: command };
              });
            };
            for (const variant of comparisonWitnesses('fixture-identity')) {
              const changed = (value: string) =>
                comparisonWitnesses(value).find((candidate) => candidate.name === variant.name)?.value ??
                foreign;
              for (const field of ['tool', 'requestId'])
                each(`request.${field}.identity.${variant.name}`, (o, c) => {
                  const value = changed(field === 'tool' ? c.label : String(c.id));
                  const requests = events(o, c, 'permission_request');
                  if (field === 'requestId')
                    for (const e of events(o, c, 'permission_decision')) record(e.record).requestId = value;
                  for (const e of requests) record(e.record)[field] = value;
                });
              each(`decision.requestId.identity.${variant.name}`, (o, c) => {
                for (const e of events(o, c, 'permission_decision'))
                  record(e.record).requestId = changed(String(c.id));
              });
              each(
                `request.input.identity.${variant.name}`,
                (o, c) => {
                  const map = (value: unknown): unknown =>
                    typeof value === 'string'
                      ? changed(value)
                      : Array.isArray(value)
                        ? value.map(map)
                        : value !== null && typeof value === 'object'
                          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, map(v)]))
                          : value;
                  for (const e of events(o, c, 'permission_request')) record(e.record).input = map(c.input);
                },
                inputWithPath,
              );
            }
            for (const wrap of ['array', 'object'])
              each(`request.input.${wrap}`, (o, c) => {
                for (const e of events(o, c, 'permission_request'))
                  record(e.record).input = wrap === 'array' ? [c.input] : { fixture: c.input };
              });
            each('decision.allow', (o, c) => {
              for (const e of events(o, c, 'permission_decision')) record(e.record).decision = 'deny';
            });
            for (const variant of comparisonWitnesses('allow'))
              each(`decision.allow.selector.${variant.name}`, (o, c) => {
                for (const e of events(o, c, 'permission_decision'))
                  record(e.record).decision = variant.value;
              });
            each('decision.requestId.matches', (o, c) => {
              for (const e of events(o, c, 'permission_decision')) record(e.record).requestId = foreign;
            });
            for (const delta of [0, 1])
              each(
                `request.before-decision.${delta}`,
                (o, c) => {
                  for (const e of events(o, c, 'permission_request'))
                    e.line = Number(events(o, c, 'permission_decision')[0]?.line ?? 0) + delta;
                },
                (o) => {
                  for (const c of o.toolCalls.filter(match))
                    for (const e of events(o, c, 'permission_request'))
                      e.line = Number(events(o, c, 'permission_decision')[0]?.line ?? 0) - 1;
                },
              );
            each('decision.before-call', (o, c) => {
              for (const e of events(o, c, 'permission_decision')) record(e.record).timestamp = c.startedAt;
            });
          }
        }
      } else if (channel === 'custom' && check === 'ordered') {
        keys(['pairs', 'before', 'after', 'key', 'reset']);
        for (const [at, pair] of (Array.isArray(opts.pairs) ? rows(opts.pairs) : [opts]).entries()) {
          if (
            typeof pair.before !== 'string' ||
            typeof pair.after !== 'string' ||
            String(pair.before).includes(':') ||
            String(pair.after).includes(':') ||
            pair.key ||
            pair.reset
          ) {
            gap(`${at}.OR-stage-key-reset-or-history`);
            continue;
          }
          const before = pair.before;
          const after = pair.after;
          const match = (c: ToolCall, selector: string) => {
            const [label, text] = selector.split('~');
            return (
              c.label === label &&
              (!text ||
                String(
                  record(c.input).command ?? record(c.input).file_path ?? record(c.input).skill ?? '',
                ).includes(text))
            );
          };
          const change = (o: Observed) => {
            const moved = o.toolCalls.filter((c) => match(c, before));
            o.toolCalls = [...o.toolCalls.filter((c) => !match(c, before)), ...moved];
            const last = Math.max(
              0,
              ...o.toolCalls.map((c) => Date.parse(c.startedAt ?? '')).filter(Number.isFinite),
            );
            moved.forEach((c, i) => {
              c.startedAt = new Date(last + i + 1).toISOString();
            });
            for (const r of o.runtime?.references ?? [])
              if (moved.some((c) => String(record(c.input).file_path).endsWith(r.path)))
                r.at = moved[0]?.startedAt;
          };
          add(`${at}.prior-qualified`, change);
          add(`${at}.raw-event-malformed`, (o) => {
            record(o.raw).markers = [null];
          });
          // Raw is an unknown external channel. A malformed event must retain the
          // custom-check rejection instead of becoming a passing or absent result.
          required(inventory.components.at(-1)).verdicts = ['custom.ordered'];
          for (const [kind, input] of [['null', null]] as const)
            add(`${at}.unrelated-input.${kind}`, change, (o) => {
              o.toolCalls.push({ label: foreign, input });
            });
          const toolOnly = (o: Observed) => {
            if (o.runtime) o.runtime.stages = [];
            record(o.raw).markers = [];
          };
          add(`${at}.prior-at-start`, change, (o) => {
            toolOnly(o);
            // Exactly one prerequisite makes index zero necessary. Additional matching
            // prerequisites would let a search that skips zero pass the control.
            const prerequisite = required(o.toolCalls.find((c) => match(c, before)));
            o.toolCalls = [prerequisite, ...o.toolCalls.filter((c) => !match(c, before))];
          });
          add(`${at}.after-at-end`, change, (o) => {
            toolOnly(o);
            o.toolCalls = [
              ...o.toolCalls.filter((c) => !match(c, after)),
              ...o.toolCalls.filter((c) => match(c, after)),
            ];
          });
          for (const [side, selector] of [
            ['before', before],
            ['after', after],
          ] as const) {
            const label = selector.split('~')[0] ?? '';
            for (const variant of comparisonWitnesses(label)) {
              add(`${at}.${side}.label.${variant.name}`, (o) => {
                for (const c of o.toolCalls.filter((c) => match(c, selector))) c.label = variant.value;
              });
              if (side === 'after') required(inventory.components.at(-1)).violationOutcome = 'absent';
            }
            const text = selector.split('~')[1];
            if (text) {
              add(`${at}.${side}.qualifier.record-type`, (o) => {
                for (const c of o.toolCalls.filter((c) => match(c, selector)))
                  c.input = Object.assign([], record(c.input));
              });
              if (side === 'after') required(inventory.components.at(-1)).violationOutcome = 'absent';
              add(`${at}.${side}.qualifier.string-type`, (o) => {
                for (const c of o.toolCalls.filter((c) => match(c, selector))) {
                  const input = record(c.input);
                  const field = ['command', 'file_path', 'notebook_path', 'skill'].find(
                    (k) => typeof input[k] === 'string',
                  );
                  if (field) input[field] = [text];
                }
              });
              if (side === 'after') required(inventory.components.at(-1)).violationOutcome = 'absent';
              for (const variant of comparisonWitnesses(text)) {
                if (variant.value.includes(text)) continue;
                add(`${at}.${side}.qualifier.${variant.name}`, (o) => {
                  for (const c of o.toolCalls.filter((c) => match(c, selector))) {
                    const input = record(c.input);
                    const field = ['command', 'file_path', 'notebook_path', 'skill'].find(
                      (k) => typeof input[k] === 'string',
                    );
                    if (field) input[field] = variant.value;
                  }
                });
                if (side === 'after') required(inventory.components.at(-1)).violationOutcome = 'absent';
              }
            }
          }
          add(`${at}.every-after`, (o) => {
            const target = o.toolCalls.find((c) => match(c, after));
            if (target)
              o.toolCalls.unshift({
                ...structuredClone(target),
                id: `${target.id}-early`,
                startedAt: '2000-01-01T00:00:00.000Z',
              });
          });
          if (!after) gap(`${at}.after`);
        }
      } else if (channel === 'expect' && check === 'execution') {
        keys(['ran_code', 'exit_code', 'max_commands']);
        const command = (exitCode = 0): ExecutionRecord => ({ command: 'fixture-command', exitCode });
        const agentOnly: ExecutionRecord = { command: 'fixture-agent', role: 'agent', exitCode: 0 };
        // The commands that satisfy every asked clause at once: the evidence clause is judged against them.
        const satisfying = (): ExecutionRecord[] =>
          opts.ran_code === false
            ? []
            : typeof opts.max_commands === 'number' && opts.max_commands < 1
              ? []
              : [command(typeof opts.exit_code === 'number' ? opts.exit_code : 0)];
        add(
          'evidence.executions',
          (o) => {
            delete o.executions;
          },
          (o) => {
            o.executions = satisfying();
          },
        );
        required(inventory.components.at(-1)).violationOutcome = 'inconclusive';
        if (opts.ran_code === true) {
          add(
            'ran_code.none',
            (o) => {
              o.executions = [];
            },
            (o) => {
              o.executions = [command()];
            },
          );
          // The agent's own process is not a command it ran.
          add(
            'ran_code.agent-process',
            (o) => {
              o.executions = [agentOnly];
            },
            (o) => {
              o.executions = [agentOnly, command()];
            },
          );
        }
        if (opts.ran_code === false)
          add(
            'ran_code.some',
            (o) => {
              o.executions = [command()];
            },
            (o) => {
              o.executions = [];
            },
          );
        if (typeof opts.exit_code === 'number') {
          const want = opts.exit_code;
          add(
            'exit_code.value',
            (o) => {
              o.executions = [command(want + 1)];
            },
            (o) => {
              o.executions = [command(want)];
            },
          );
          // The last command decides, not an earlier one.
          add(
            'exit_code.last',
            (o) => {
              o.executions = [command(want), command(want + 1)];
            },
            (o) => {
              o.executions = [command(want + 1), command(want)];
            },
          );
        }
        if (typeof opts.max_commands === 'number') {
          const max = opts.max_commands;
          add(
            'max_commands.over',
            (o) => {
              o.executions = Array.from({ length: max + 1 }, () => command());
            },
            (o) => {
              o.executions = Array.from({ length: max }, () => command());
            },
          );
          add(
            'max_commands.agent-process',
            (o) => {
              o.executions = [agentOnly, ...Array.from({ length: max + 1 }, () => command())];
            },
            (o) => {
              o.executions = [agentOnly, ...Array.from({ length: max }, () => command())];
            },
          );
        }
      } else if (channel === 'custom' && check === 'some_call') {
        keys(['calls', 'label', 'input', 'count', 'block']);
        for (const [at, entry] of (Array.isArray(opts.calls) ? rows(opts.calls) : [opts]).entries()) {
          if (entry.block !== undefined && entry.block !== index) continue;
          const label = typeof entry.label === 'string' ? entry.label : undefined;
          const assertions = record(entry.input) as Record<string, Assertion>;
          if (label === undefined) {
            gap(`${at}.label`);
            continue;
          }
          const input: RecordValue = {};
          let witnessed = true;
          for (const [field, assertion] of Object.entries(assertions)) {
            const value = assertionWitness(assertion);
            if (value === undefined) {
              gap(`${at}.input.${field}.assertion-witness`);
              witnessed = false;
            } else input[field] = value;
          }
          if (!witnessed) continue;
          const matches = (c: ToolCall) =>
            c.label === label &&
            Object.entries(assertions).every(([field, assertion]) => {
              try {
                return matchAssertion(record(c.input)[field], assertion);
              } catch {
                return false;
              }
            });
          const sample = (): ToolCall =>
            ({ id: `witness-${at}`, label, input: structuredClone(input) }) as unknown as ToolCall;
          const resize = (o: Observed, n: number) => {
            const exemplar = o.toolCalls.find(matches) ?? sample();
            o.toolCalls = [
              ...o.toolCalls.filter((c) => !matches(c)),
              ...Array.from({ length: n }, (_, k) => ({
                ...structuredClone(exemplar),
                id: `${exemplar.id}-${k}`,
              })),
            ];
          };
          const count = entry.count ?? { min: 1 };
          const min = typeof count === 'number' ? count : Number(record(count).min ?? 0);
          const max = typeof count === 'number' ? count : Number(record(count).max ?? Infinity);
          if (min > 0) {
            add(
              `${at}.count.min`,
              (o) => resize(o, min - 1),
              (o) => resize(o, min),
            );
            // The calls that count are the ones of the label and the input, wherever they sit among others.
            add(
              `${at}.selection.all-entries`,
              (o) => resize(o, min - 1),
              (o) => {
                resize(o, min);
                const other = { ...sample(), label: foreign, id: 'witness-other' } as unknown as ToolCall;
                o.toolCalls = [other, ...o.toolCalls, structuredClone(other)];
              },
            );
            for (const variant of comparisonWitnesses(label)) {
              if (variant.value === label) continue;
              add(
                `${at}.label.${variant.name}`,
                (o) => {
                  resize(o, min);
                  for (const c of o.toolCalls.filter(matches)) c.label = variant.value;
                },
                (o) => resize(o, min),
              );
            }
            for (const [field, assertion] of Object.entries(assertions)) {
              const current = input[field];
              if (typeof current !== 'string') continue;
              for (const variant of comparisonWitnesses(current)) {
                try {
                  if (matchAssertion(variant.value, assertion)) continue;
                } catch {
                  continue;
                }
                add(
                  `${at}.input.${field}.${variant.name}`,
                  (o) => {
                    resize(o, min);
                    for (const c of o.toolCalls.filter(matches)) record(c.input)[field] = variant.value;
                  },
                  (o) => resize(o, min),
                );
              }
            }
          }
          if (Number.isFinite(max))
            add(
              `${at}.count.max`,
              (o) => resize(o, max + 1),
              (o) => resize(o, max),
            );
        }
      } else {
        gap('unsupported-check-structure');
      }
    };
    for (const [name, value] of Object.entries(block.expect ?? {})) visit('expect', name, value);
    for (const [name, value] of Object.entries(spec.rules?.custom ?? {})) {
      if (record(value).block === undefined || record(value).block === index) visit('custom', name, value);
    }
  });
  if (spec.blocks.length > 1) inventory.gaps.push('history:multi-block-component-isolation');
  return inventory;
}
/** An input value that satisfies an assertion, or undefined when the assertion has no witness this derives. */
function assertionWitness(assertion: Assertion): string | undefined {
  if (typeof assertion === 'string') return assertion;
  if (assertion === null || typeof assertion !== 'object' || Array.isArray(assertion)) return undefined;
  const a = assertion as Record<string, unknown>;
  if (typeof a.exact === 'string') return a.exact;
  if (typeof a.contains === 'string') return a.contains;
  if (Array.isArray(a.one_of) && typeof a.one_of[0] === 'string') return a.one_of[0];
  if (a.nonempty === true) return 'fixture';
  if (typeof a.regex === 'string') return regexWitness(a.regex);
  return undefined;
}

/**
 * A string a simple pattern matches: literals and escapes, character classes, counted and optional repeats. Anything
 * else (groups, alternation, lookarounds, negated classes) has no witness here and is a named gap.
 */
function regexWitness(pattern: string): string | undefined {
  let out = '';
  let at = 0;
  const atom = (): string | undefined => {
    const c = pattern[at] as string;
    if (c === '\\') {
      const next = pattern[at + 1] ?? '';
      at += 2;
      if (next === 'd') return '1';
      if (next === 'w') return 'a';
      if (next === 's') return ' ';
      if (next === 'b') return '';
      if (/[a-zA-Z]/.test(next)) return undefined;
      return next;
    }
    if (c === '[') {
      const end = pattern.indexOf(']', at + 1);
      const body = end < 0 ? '' : pattern.slice(at + 1, end);
      if (end < 0 || body.startsWith('^') || body === '') return undefined;
      at = end + 1;
      return body[0] === '\\' ? body[1] : body[0];
    }
    if (c === '(' || c === ')' || c === '|' || c === '*' || c === '+' || c === '?' || c === '{')
      return undefined;
    at += 1;
    return c === '.' ? 'a' : c;
  };
  while (at < pattern.length) {
    if (pattern[at] === '^' || pattern[at] === '$') {
      at += 1;
      continue;
    }
    const piece = atom();
    if (piece === undefined) return undefined;
    let times = 1;
    const rest = pattern.slice(at);
    const counted = /^\{(\d+)(?:,(\d*))?\}/.exec(rest);
    if (counted) {
      times = Number(counted[1]);
      at += counted[0].length;
    } else if (rest[0] === '+') {
      at += 1;
    } else if (rest[0] === '*' || rest[0] === '?') {
      times = 0;
      at += 1;
    }
    out += piece.repeat(times);
  }
  try {
    return new RegExp(pattern).test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}
function literalPattern(pattern: string): string | undefined {
  const literal = pattern.replace(/^\^|\$$/g, '').replace(/\\b/g, '');
  return /^[\w :.,-]+$/.test(literal) && new RegExp(pattern, 'm').test(literal) ? literal : undefined;
}
function ruleMatches(pattern: string, value: string): boolean {
  if (pattern.endsWith(':*')) return value.startsWith(pattern.slice(0, -2));
  return new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  ).test(value);
}

/** Near misses preserve the part a relaxed comparator would incorrectly accept. */
export function comparisonWitnesses(value: string): Array<{ name: string; value: string }> {
  const base = value.replace(/^\*\*\//, '');
  return [
    { name: 'foreign', value: foreign },
    { name: 'case', value: base === base.toUpperCase() ? base.toLowerCase() : base.toUpperCase() },
    { name: 'basename', value: `__other_directory__/${base.split('/').at(-1)}` },
    { name: 'prefix', value: `${base}_extra` },
    { name: 'substring', value: `extra_${base}_extra` },
    { name: 'truncated', value: base.slice(0, -1) },
  ].filter((v, i, all) => v.value !== value && all.findIndex((x) => x.value === v.value) === i);
}

/** Expected verdict identity comes from assertion structure, never from mutated output. */
function verdictIds(check: string, value: unknown, clause: string): string[] {
  const opts = record(value);
  const list = rows(value);
  const entry = Number(clause.split('.')[0]);
  const indexed = Number.isInteger(entry) && !clause.startsWith('evidence.');
  const keys = (names: string[]) =>
    names.map((name, i) => {
      const n = names.slice(0, i + 1).filter((x) => x === name).length;
      return n === 1 ? name : `${name}#${n}`;
    });
  if (['guards', 'references', 'skills', 'subagents', 'tools'].includes(check)) {
    const names = keys(
      list.map((e) =>
        check === 'references'
          ? String(e.path)
          : check === 'tools'
            ? String(e.label)
            : check === 'guards'
              ? `${e.name}.${e.verdict ?? 'any'}`
              : e.model
                ? `${e.name}.${e.model}`
                : String(e.name),
      ),
    );
    const ids = names.map((name, i) =>
      check === 'tools'
        ? list[i]?.count === 0
          ? `forbidden.${name}`
          : `tools.${name}.count`
        : `${check}.${name}`,
    );
    return indexed ? [required(ids[entry])] : ids;
  }
  if (check === 'workspace')
    return clause.startsWith('evidence.')
      ? Object.keys(opts).map((key) => `workspace.${key}`)
      : [`workspace.${clause.split('.')[0]}`];
  if (check === 'tools_offered') {
    const sides = ['include', 'exclude'];
    if (clause.startsWith('evidence.'))
      return sides.flatMap((side) => strings(opts[side]).map((v) => `tools_offered.${side}.${v}`));
    const [side, at] = clause.split('.');
    return [`tools_offered.${side}.${strings(opts[required(side)])[Number(at)]}`];
  }
  if (check === 'stage_seen')
    return [`custom.stage_seen.${String(opts.name).replace(/[^A-Za-z0-9_-]/g, '_')}`];
  if (check === 'guard_message')
    return [`custom.guard_message.${clause.includes('mustNot') ? 'rules' : 'present'}`];
  if (check === 'hazard_recovery')
    return [
      `custom.hazard_recovery.${clause.startsWith('reread.') ? clause.split('.').slice(0, 2).join('.') : clause.includes('collateral') ? 'collateral' : clause.split('.')[0]}`,
    ];
  if (check === 'permission') {
    const entries = Array.isArray(opts.rules) ? rows(opts.rules) : [opts];
    return [`custom.permission.${entries[entry]?.effect}`];
  }
  if (check === 'execution')
    return clause.startsWith('evidence.')
      ? ['ran_code', 'exit_code', 'max_commands']
          .filter((key) => opts[key] !== undefined)
          .map((key) => `execution.${key}`)
      : [`execution.${clause.split('.')[0]}`];
  if (check === 'some_call') return [`custom.some_call.${clause.split('.')[0]}`];
  if (check === 'ordered') {
    const pairs = Array.isArray(opts.pairs) ? rows(opts.pairs) : [opts];
    const pair = required(pairs[entry]);
    const safe = (v: unknown) => String(v).replace(/[^A-Za-z0-9_-]/g, '_');
    return [`custom.ordered.${safe(pair.before)}.${safe(pair.after)}`];
  }
  return [];
}

/** Project only the inspected check from actual product output. This prevents another
 * assertion from hiding its failure, and still detects an entirely missing check. */
export function componentSpec(actual: Spec, component: Component): Spec {
  const spec = structuredClone(actual);
  spec.rules = {
    custom:
      component.channel === 'custom' && actual.rules?.custom?.[component.check] !== undefined
        ? { [component.check]: actual.rules.custom[component.check] }
        : {},
  };
  for (const [index, block] of spec.blocks.entries()) {
    const expect = actual.blocks[index]?.expect as RecordValue | undefined;
    block.expect =
      component.channel === 'expect' && index === component.block && expect?.[component.check] !== undefined
        ? { [component.check]: expect[component.check] }
        : {};
  }
  return spec;
}
