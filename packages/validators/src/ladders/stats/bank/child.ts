/**
 * The bank's child process: runs the items of the statistics bank on one seed, in bank order, from a start index,
 * and writes one JSON line before and after each item. The parent (isolate.ts) kills it when an item runs past
 * its budget, so an endless loop in the statistics package fails one item instead of hanging the validator.
 * Usage: node --import tsx child.ts <seed> <root> <start>, with the item ids to run as a JSON array on stdin.
 * DRIFTBENCH_STATS_IMPL, when set, is the path of another build of the statistics package's index to test (a
 * planted bug, or the package at an earlier commit, to measure a recorded row); unset, the package itself.
 * Build this entry separately from the public index. A joint build can hoist the index's target imports into
 * shared bootstrap chunks, before run-child installs the trap. Keep this entry free of target or bank imports.
 */
import { statsBankChild } from './run-child';

await statsBankChild(process.argv.slice(2));
