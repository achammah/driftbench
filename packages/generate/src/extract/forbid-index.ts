/**
 * The forbids of a list of constraints, found from a cell in time that does not grow with the list. A forbid is
 * a set of `dimension: value` picks; it holds in a cell when the cell has every one of them. The index groups
 * the forbids by their set of dimensions, so a cell is looked up once per set of dimensions it contains, where a
 * scan compares it with every forbid of the list. The answers are those of the scan, in list order.
 */
export class ForbidIndex {
  private readonly bySet = new Map<string, { dimensions: string[]; at: Map<string, number[]> }>();
  private size = 0;

  /** Adds the next forbid of the list; its position is the number of forbids added before it. */
  add(forbid: Readonly<Record<string, unknown>>): void {
    const dimensions = Object.keys(forbid).sort();
    const setKey = JSON.stringify(dimensions);
    let entry = this.bySet.get(setKey);
    if (!entry) {
      entry = { dimensions, at: new Map() };
      this.bySet.set(setKey, entry);
    }
    const valueKey = JSON.stringify(dimensions.map((dimension) => forbid[dimension]));
    const positions = entry.at.get(valueKey);
    if (positions) positions.push(this.size);
    else entry.at.set(valueKey, [this.size]);
    this.size += 1;
  }

  /** The positions, in list order, of every forbid the cell holds. */
  within(cell: Readonly<Record<string, unknown>>): number[] {
    const out: number[] = [];
    for (const { dimensions, at } of this.bySet.values()) {
      const key = this.keyIn(cell, dimensions);
      const positions = key === undefined ? undefined : at.get(key);
      if (positions) out.push(...positions);
    }
    return out.sort((a, b) => a - b);
  }

  /** Whether the cell holds any forbid of the list. */
  holds(cell: Readonly<Record<string, unknown>>): boolean {
    for (const { dimensions, at } of this.bySet.values()) {
      const key = this.keyIn(cell, dimensions);
      if (key !== undefined && at.has(key)) return true;
    }
    return false;
  }

  /** The cell's values on the dimensions, as the index keys them; undefined when the cell lacks one of them. */
  private keyIn(cell: Readonly<Record<string, unknown>>, dimensions: readonly string[]): string | undefined {
    const values: unknown[] = [];
    for (const dimension of dimensions) {
      if (!Object.hasOwn(cell, dimension) || cell[dimension] === undefined) return undefined;
      values.push(cell[dimension]);
    }
    return JSON.stringify(values);
  }
}
