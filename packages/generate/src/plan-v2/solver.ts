import type { View } from './view';

/**
 * Which partial rows can be completed into a row no constraint forbids. A partial row is one value index per
 * variable, -1 where the variable is not set. Constraints are the impossible combinations of the view: a row is
 * forbidden when it holds every entry of one of them. Only variables that some constraint names can make a
 * completion fail, so the search runs over those and leaves the others free.
 */

/** The most search steps one question may take before the planner gives up and says so. */
export const MAX_SOLVER_STEPS = 500_000;

export class Solver {
  readonly constrained: number[];
  private readonly byVariable: number[][];
  private steps = 0;

  constructor(private readonly view: View) {
    this.byVariable = view.variables.map(() => []);
    view.constraints.forEach((constraint, at) => {
      for (const variable of constraint.variables) this.byVariable[variable]?.push(at);
    });
    this.constrained = this.byVariable.flatMap((list, at) => (list.length > 0 ? [at] : []));
  }

  /** Whether the row, as far as it is set, already holds every entry of a constraint. */
  violates(row: Int16Array): boolean {
    return this.view.constraints.some((_, at) => this.fires(at, row));
  }

  private fires(at: number, row: Int16Array): boolean {
    const constraint = this.view.constraints[at];
    if (!constraint) return false;
    return constraint.variables.every((variable, position) => row[variable] === constraint.values[position]);
  }

  /** The values of an unset variable that no constraint turns impossible, given the values already set. */
  allowed(row: Int16Array, variable: number): number[] {
    const count = this.view.variables[variable]?.values.length ?? 0;
    const blocked = new Set<number>();
    for (const at of this.byVariable[variable] ?? []) {
      const constraint = this.view.constraints[at];
      if (!constraint) continue;
      let value = -1;
      let others = true;
      constraint.variables.forEach((other, position) => {
        if (other === variable) value = constraint.values[position] as number;
        else if (row[other] !== constraint.values[position]) others = false;
      });
      if (others && value >= 0) blocked.add(value);
    }
    return Array.from({ length: count }, (_, at) => at).filter((at) => !blocked.has(at));
  }

  /** Whether the partial row can be completed into a row that breaks no constraint. */
  canComplete(partial: Int16Array): boolean {
    if (this.violates(partial)) return false;
    const row = Int16Array.from(partial);
    this.steps = 0;
    return this.search(
      row,
      this.constrained.filter((variable) => row[variable] === -1),
    );
  }

  private search(row: Int16Array, unset: number[]): boolean {
    if (unset.length === 0) return true;
    this.steps += 1;
    if (this.steps > MAX_SOLVER_STEPS)
      throw new RangeError(
        `the constraints are too tangled to complete a row within ${MAX_SOLVER_STEPS} steps: forbid fewer combinations`,
      );
    // The variable with the fewest values left decides first, so a dead end shows early.
    let pick = -1;
    let options: number[] = [];
    for (const variable of unset) {
      const values = this.allowed(row, variable);
      if (values.length === 0) return false;
      if (pick === -1 || values.length < options.length) {
        pick = variable;
        options = values;
      }
    }
    const rest = unset.filter((variable) => variable !== pick);
    for (const value of options) {
      row[pick] = value;
      if (this.search(row, rest)) {
        row[pick] = -1;
        return true;
      }
    }
    row[pick] = -1;
    return false;
  }
}
