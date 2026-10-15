import { describe, expect, it } from 'vitest';
import { formulaPattern } from '../../src/families/compile';

/**
 * Blast radius of the commuted family formula: the regex `formulaPattern` writes reaches every formula
 * check of a family spec. A swap is allowed for one * or + between two plain operands only, written with
 * or without spaces and with decimals; absolute references, longer chains and other operators keep the
 * order written, and the swapped form never accepts a different value.
 */

const accepts = (formula: string, written: string) => new RegExp(formulaPattern(formula)).test(written);

describe('formulaPattern beyond the cases of the change', () => {
  it('swaps a decimal operand and a spaced template, both ways round', () => {
    expect(accepts('=C2*1.5', '=1.5*C2')).toBe(true);
    expect(accepts('=C2 * 12', '=12*C2')).toBe(true);
    expect(accepts('=C2 * 12', '=12 * C2')).toBe(true);
    expect(accepts('=AB12+C3', '=C3 + AB12')).toBe(true);
  });

  it('never swaps an absolute reference, a chain or a division, and never takes another value', () => {
    expect(accepts('=$C$2*12', '=12*$C$2')).toBe(false);
    expect(accepts('=C2*12*2', '=2*12*C2')).toBe(false);
    expect(accepts('=C2/12', '=12/C2')).toBe(false);
    expect(accepts('=C2*12', '=12*C3')).toBe(false);
    expect(accepts('=C2*12', '=13*C2')).toBe(false);
    expect(accepts('=C2*1.5', '=15*C2')).toBe(false);
    expect(accepts('=C2+12', '=12*C2')).toBe(false);
  });
});
