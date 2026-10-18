import { appendFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { type PointerScanOptions, pointer, type ScanEstateResult } from '@agent-nexus/driftbench-estate';
import type { FetchLike } from '@agent-nexus/driftbench-generate';
import { exists, reason, show, writeOut } from '../files';
import type { Io } from '../io';

/** The scan options that switch the pointer reader on. */
export type EstatePointerOptions = {
  pointer?: boolean;
  /** A YAML file of label sets; without it the shipped agent-rules set is used. */
  labels?: string;
  cassette?: string;
  /** Call the labelers on a cassette miss and write the answer. Without it a miss is an error. */
  record?: boolean;
  /** `<class>:<client>[:<model>]`, once or repeated. Without any, the default stack. */
  labeler?: string[];
  labelerThreshold?: string;
  labelerPassAt?: string;
  labelerFailAt?: string;
  labelerMarginCut?: string;
  /** The name of the environment variable that holds the bearer token of an http labeler. */
  labelerKey?: string;
  jobs?: string;
  ledger?: string;
  ledgerCheck?: boolean;
};

export type PointerHandle = {
  scan: PointerScanOptions;
  /** The classes and clients that read the prose, in one line. */
  describe: string;
  /** After the scan: write the cassette and the ledger, or check the ledger. Returns an exit code. */
  finish(result: ScanEstateResult): Promise<number>;
};

/** The default number of requests in flight at once. */
export const DEFAULT_JOBS = 4;

function fraction(value: string | undefined, flag: string, io: Io): number | undefined | null {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (value.trim() === '' || !Number.isFinite(number) || number < 0 || number > 1) {
    io.err(`error: ${flag} is a number from 0 to 1, not "${value}"\n`);
    return null;
  }
  return number;
}

/** Writes a file whole or not at all: to a neighbour, then a rename. */
async function writeAtomic(path: string, text: string, io: Io): Promise<boolean> {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, text);
    await rename(temporary, path);
    return true;
  } catch (cause) {
    io.err(`Cannot write ${show(path, io)}: ${reason(cause)}\n`);
    return false;
  }
}

/** Reads the label sets, the labelers, the cassette and the last ledger. Undefined after telling the user what is wrong. */
export async function openPointer(
  options: EstatePointerOptions,
  io: Io,
  env: Record<string, string | undefined>,
  fetch?: FetchLike,
): Promise<PointerHandle | undefined> {
  if (!options.cassette) {
    io.err('error: --pointer needs --cassette <file>: the file that holds the recorded answers\n');
    return undefined;
  }
  const specs: pointer.LabelerSpec[] = [];
  for (const text of options.labeler?.length ? options.labeler : pointer.DEFAULT_LABELER_SPECS) {
    const parsed = pointer.parseLabelerSpec(text);
    if (!parsed.ok) {
      io.err(`error: --labeler ${parsed.message}\n`);
      return undefined;
    }
    specs.push(parsed.spec);
  }
  const threshold = fraction(options.labelerThreshold, '--labeler-threshold', io);
  const passAt = fraction(options.labelerPassAt, '--labeler-pass-at', io);
  const failAt = fraction(options.labelerFailAt, '--labeler-fail-at', io);
  const marginCut = fraction(options.labelerMarginCut, '--labeler-margin-cut', io);
  if (threshold === null || passAt === null || failAt === null || marginCut === null) return undefined;
  let jobs = DEFAULT_JOBS;
  if (options.jobs !== undefined) {
    jobs = Number(options.jobs);
    if (!Number.isInteger(jobs) || jobs < 1 || jobs > 64) {
      io.err(`error: --jobs is a whole number from 1 to 64, not "${options.jobs}"\n`);
      return undefined;
    }
  }
  let setsText = pointer.AGENT_RULES_SET;
  if (options.labels) {
    const path = resolve(io.cwd, options.labels);
    try {
      setsText = await readFile(path, 'utf8');
    } catch (cause) {
      io.err(`Cannot read the label sets ${show(path, io)}: ${reason(cause)}\n`);
      return undefined;
    }
  }
  const sets = pointer.parseLabelSets(setsText);
  if (!sets.ok) {
    io.err(`Cannot use the label sets${options.labels ? ` in ${options.labels}` : ''}: ${sets.message}\n`);
    return undefined;
  }
  const record = options.record === true;
  const built = await pointer.buildLabelling(specs, {
    env,
    record,
    cwd: io.cwd,
    ...(threshold === undefined ? {} : { threshold }),
    ...(passAt === undefined ? {} : { passAt }),
    ...(failAt === undefined ? {} : { failAt }),
    ...(marginCut === undefined ? {} : { marginCut }),
    ...(options.labelerKey ? { keyVariable: options.labelerKey } : {}),
    ...(fetch ? { fetch } : {}),
  });
  if (!built.ok) {
    io.err(`error: ${built.message}\n`);
    return undefined;
  }
  const cassettePath = resolve(io.cwd, options.cassette);
  let cassette = new pointer.Cassette();
  if (await exists(cassettePath)) {
    try {
      cassette = pointer.Cassette.parse(await readFile(cassettePath, 'utf8'));
    } catch (cause) {
      io.err(`Cannot use the cassette ${show(cassettePath, io)}: ${reason(cause)}\n`);
      return undefined;
    }
  } else if (!record) {
    io.err(`Cannot find the cassette ${show(cassettePath, io)}: record it with --record\n`);
    return undefined;
  }
  if (record) {
    // Each answer is appended as it arrives, so a run that stops keeps what it paid for.
    await mkdir(dirname(cassettePath), { recursive: true });
    cassette.onPut = (entry) => appendFileSync(cassettePath, `${pointer.canonical(entry)}\n`);
  }
  const ledgerPath = options.ledger ? resolve(io.cwd, options.ledger) : undefined;
  let previous: pointer.Ledger | undefined;
  let previousText: string | undefined;
  if (ledgerPath && (await exists(ledgerPath))) {
    previousText = await readFile(ledgerPath, 'utf8');
    previous = pointer.parseLedger(previousText);
    if (!previous) {
      io.err(`Cannot use the ledger ${show(ledgerPath, io)}: it is not a ledger\n`);
      return undefined;
    }
  }
  if (options.ledgerCheck && !ledgerPath) {
    io.err('error: --ledger-check needs --ledger <file>\n');
    return undefined;
  }
  const labelling = built.labelling;
  return {
    describe: labelling.describe,
    scan: {
      sets: sets.sets,
      labelling,
      cassette,
      mode: record ? 'record' : 'replay',
      jobs,
      onPlan: (plan) => {
        if (!record || plan.members.every((member) => member.windows === member.cached)) return;
        io.out(
          `Pointer plan: ${plan.units} units in ${plan.files} files, ${plan.carried} already labelled by the ledger.\n`,
        );
        for (const member of plan.members) {
          io.out(
            `  ${className(member.cls)} ${member.id} ${member.model}: ${member.windows} requests, ${member.cached} in the cassette, ${member.characters} characters to send.\n`,
          );
        }
      },
      ...(previous ? { previous } : {}),
    },
    async finish(result) {
      const done = result.pointer;
      if (!done) return 0;
      // The cassette on disk holds the appended answers in the order they arrived; rewrite it sorted.
      if (record && done.recorded > 0 && !(await writeAtomic(cassettePath, cassette.render(), io))) return 2;
      if (!ledgerPath) return 0;
      const text = pointer.renderLedger(done.ledger);
      if (options.ledgerCheck) {
        if (text === previousText) return 0;
        io.err(`The ledger ${show(ledgerPath, io)} is out of date: rescan with --ledger and commit it\n`);
        return 1;
      }
      return (await writeOut(ledgerPath, text, io)) ? 0 : 2;
    },
  };
}

const className = (cls: pointer.LabelerClass): string => (cls === 'system1' ? 'system 1' : 'system 2');

/** The lines a scan prints about the pointer reader: counts and tokens, never a unit. */
export function pointerLines(result: ScanEstateResult, describe: string): string[] {
  const done = result.pointer;
  if (!done) return [];
  const live = done.ledger.entries.filter((entry) => entry.status === 'live').length;
  const lines = [
    `  Pointer reader: ${describe}.`,
    `  Units: ${live} in ${done.cuts.size} files; ${done.carried} kept from the ledger, ${done.decided} labelled by this run (${done.decidedBy.system1} by system 1, ${done.decidedBy.system2} by system 2${done.fellBack > 0 ? `, ${done.fellBack} of them because the other labeler gave no opinion` : ''}), ${done.unlabeled} unlabeled; ${done.atoms} atoms.`,
    `  Requests: ${done.windows} answered, ${done.calls} sent, ${done.recorded} recorded.`,
  ];
  for (const entry of done.usage) {
    if (entry.input + entry.output === 0 && entry.calls === 0) continue;
    lines.push(
      `  Tokens, ${className(entry.cls)} ${entry.id} ${entry.model}: ${entry.input} in, ${entry.output} out, ${entry.calls} requests sent.`,
    );
  }
  const events = Object.entries(done.events).filter(([, count]) => count > 0);
  lines.push(
    `  Units since the last ledger: ${events.map(([event, count]) => `${event} ${count}`).join(', ')}.`,
  );
  for (const failure of done.failed) lines.push(`    window failed: ${failure}`);
  for (const refusal of [...done.refusals, ...done.atomRefusals]) lines.push(`    refused: ${refusal}`);
  return lines;
}
