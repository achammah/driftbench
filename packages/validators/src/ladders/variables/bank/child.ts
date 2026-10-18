import { variablesBankChild } from './run-child';

/** The entry point of a bank child process: `node --import tsx child.ts <seed> <root> <start>` with ids on stdin. */
await variablesBankChild(process.argv.slice(2));
