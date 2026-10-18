import type { LabelDef, WindowMode } from '../../../src/ladders/pointer/sut/port';
import type { NewUnit } from './anchor';
import type { ParsedSet } from './labelset';

/** About 100,000 tokens at four characters a token. */
export const WINDOW_CHARS = 400_000;

export type PlanUnit = {
  n: number;
  /** The index of the unit in its file. */
  index: number;
  mode: WindowMode;
  text: string;
  container: string;
  path: string[];
};

export type WindowPlan = { id: string; file: string; path: string[]; units: PlanUnit[] };

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/** What a labeller is shown for one unit: its text on one line; an opaque unit shows its kind and first line. */
export function displayText(unit: NewUnit, opaque: boolean): string {
  if (opaque) {
    const first = unit.text.split(/\r?\n/)[0] ?? '';
    return `(${unit.container}) ${first.trim()}`;
  }
  return flat(unit.text);
}

/** Splits a file's units into heading-bounded windows under the size bound and keeps those holding a unit to label. */
export function planWindows(
  file: string,
  units: readonly NewUnit[],
  dirty: ReadonlySet<number>,
  read: ReadonlySet<number>,
): WindowPlan[] {
  const sections: number[][] = [];
  let current: number[] = [];
  units.forEach((unit, index) => {
    if (unit.container === 'heading' && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(index);
  });
  if (current.length > 0) sections.push(current);
  const size = (indices: number[]) => indices.reduce((sum, i) => sum + (units[i] as NewUnit).text.length, 0);
  const groups: number[][] = [];
  let group: number[] = [];
  let groupSize = 0;
  for (const section of sections) {
    const sectionSize = size(section);
    if (group.length > 0 && groupSize + sectionSize > WINDOW_CHARS) {
      groups.push(group);
      group = [];
      groupSize = 0;
    }
    if (sectionSize > WINDOW_CHARS) {
      // a section with no heading to split at: cut it between units
      let part: number[] = [];
      let partSize = 0;
      for (const i of section) {
        const len = (units[i] as NewUnit).text.length;
        if (part.length > 0 && partSize + len > WINDOW_CHARS) {
          groups.push(part);
          part = [];
          partSize = 0;
        }
        part.push(i);
        partSize += len;
      }
      if (part.length > 0) groups.push(part);
      continue;
    }
    group.push(...section);
    groupSize += sectionSize;
  }
  if (group.length > 0) groups.push(group);
  const plans: WindowPlan[] = [];
  groups.forEach((indices, k) => {
    const first = units[indices[0] as number] as NewUnit;
    const planUnits: PlanUnit[] = indices.map((index, at) => {
      const unit = units[index] as NewUnit;
      const opaque = unit.container === 'fence' || unit.container === 'comment';
      const mode: WindowMode = opaque
        ? 'opaque'
        : read.has(index)
          ? 'read'
          : dirty.has(index)
            ? 'label'
            : 'context';
      return {
        n: at + 1,
        index,
        mode,
        text: displayText(unit, opaque),
        container: unit.container,
        path: unit.sectionPath,
      };
    });
    if (planUnits.some((u) => u.mode === 'label')) {
      plans.push({
        id: `${file}#${k + 1}`,
        file,
        path:
          first.container === 'heading'
            ? [...first.sectionPath, first.text.replace(/\s+/g, ' ').trim()]
            : first.sectionPath,
        units: planUnits,
      });
    }
  });
  return plans;
}

/** The generic text around the set: no word of any domain. */
export const SYSTEM_TEXT =
  'You assign exactly one label from a closed list to each numbered line of a window. ' +
  'Reply with one JSON object only: {"window": "<window id>", "set": "<set name>", "labels": [{"units": "<number or first-last>", "label": "<name>"}]}. ' +
  'Use none when no label applies. Lines marked (context) or in brackets after the number are shown for reading only.';

/** The window as the model is shown it. Every unit is one numbered line, whatever its text holds. */
export function windowLines(plan: WindowPlan): string[] {
  return plan.units.map((u) => {
    const marker =
      u.mode === 'label' ? '' : u.mode === 'context' ? '(context) ' : u.mode === 'read' ? '(read) ' : '';
    return `[${u.n}] ${marker}${u.text}`;
  });
}

export function userText(set: ParsedSet, plan: WindowPlan): string {
  const names = [...set.labels.map((l) => l.name), 'none'].join(' | ');
  const labelLines = set.labels.map((l: LabelDef) => {
    const examples = (l.examples ?? [])
      .slice(0, 3)
      .map((e) => JSON.stringify(e))
      .join(' | ');
    return `- ${l.name}: ${l.description}${examples ? ` Examples: ${examples}` : ''}${l.target === 'required' ? ' Names a target line.' : ''}`;
  });
  const header = `WINDOW ${plan.id}  path: ${plan.path.join(' > ')}`;
  return [
    `SET ${set.set}`,
    set.description,
    `LABELS ${names}`,
    ...labelLines,
    header,
    ...windowLines(plan),
  ].join('\n');
}
