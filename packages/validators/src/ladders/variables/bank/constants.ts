/**
 * Constants the oracles rest on where the specification is ambiguous. A ruling changes one of them here, in a
 * commit of its own (docs/validators.md 12.3).
 */

/**
 * "Traffic weight orders rows" (assumption A1, ruled by the lead on 2026-10-17): after the seed rows the new rows
 * run most common first, and a budget keeps the common head, so the rarest rows are cut first. 'last' is the
 * opposite reading (rarest first, the rare rows cut last), kept so a ruling can flip it in one place.
 */
export const RARE_ROWS_CUT: 'last' | 'first' = 'first';

/** The factor on the greedy row bound that the items accept. */
export const BOUND_FACTOR = 1.25;

/** The day the bank gives the owner's entries (docs/variables.md: an owner entry holds the words and the day). */
export const OWNER_DATE = '2026-10-17';

/** A SHA-256-shaped hash for stores the bank writes by hand. */
export const BANK_SET_HASH = 'b4c0f5f2e2a7d3a1c9e8f7d6b5a4938271605f4e3d2c1b0a99887766554433aa';
