import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type PointerScanOptions, pointer, type ScanEstateResult } from '@agent-nexus/driftbench-estate';
import { exists, reason, show, writeOut } from '../files';
import type { Io } from '../io';

/** The scan options that switch the pointer reader on. */
export type EstatePointerOptions = {
  pointer?: boolean;
  /** A YAML file of label sets; without it the shipped agent-rules set is used. */
  labels?: string;
  cassette?: string;
  /** Call the labeler on a cassette miss and write the answer. Without it a miss is an error. */
  record?: boolean;
  labeler?: string;
  labelerModel?: string;
  labelerThreshold?: string;
  ledger?: string;
  ledgerCheck?: boolean;
};

export type PointerHandle = {
  scan: PointerScanOptions;
  /** After the scan: write the cassette and the ledger, or check the ledger. Returns an exit code. */
  finish(result: ScanEstateResult): Promise<number>;
};

const LABELERS = ['haiku', 'jev', 'jev-unit'] as const;

/** Reads the label sets, the cassette and the last ledger. Undefined after telling the user what is wrong. */
export async function openPointer(
  options: EstatePointerOptions,
  io: Io,
  env: Record<string, string | undefined>,
): Promise<PointerHandle | undefined> {
  if (!options.cassette) {
    io.err('error: --pointer needs --cassette <file>: the file that holds the recorded answers\n');
    return undefined;
  }
  const name = options.labeler ?? 'haiku';
  if (!(LABELERS as readonly string[]).includes(name)) {
    io.err(`error: unknown labeler "${name}": use ${LABELERS.join(', ')}\n`);
    return undefined;
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
  const parsed = pointer.parseLabelSets(setsText);
  if (!parsed.ok) {
    io.err(`Cannot use the label sets${options.labels ? ` in ${options.labels}` : ''}: ${parsed.message}\n`);
    return undefined;
  }
  let threshold: number | undefined;
  if (options.labelerThreshold !== undefined) {
    threshold = Number(options.labelerThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      io.err('error: --labeler-threshold is a probability from 0 to 1\n');
      return undefined;
    }
  }
  const record = options.record === true;
  const labeler = pointer.labelerByName(name, {
    record,
    env,
    ...(options.labelerModel ? { model: options.labelerModel } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
  });
  if (!labeler) return undefined;
  if (record && !labeler.call) {
    io.err(
      name === 'haiku'
        ? 'error: --record needs ANTHROPIC_API_KEY in the environment\n'
        : 'error: --record needs JEV_API_KEY and JEV_URL (or JEV_ROUTE) in the environment\n',
    );
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
  return {
    scan: {
      sets: parsed.sets,
      labeler,
      cassette,
      mode: record ? 'record' : 'replay',
      ...(previous ? { previous } : {}),
    },
    async finish(result) {
      const done = result.pointer;
      if (!done) return 0;
      if (record && done.recorded > 0 && !(await writeOut(cassettePath, cassette.render(), io))) return 2;
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

/** The lines a scan prints about the pointer reader. */
export function pointerLines(result: ScanEstateResult): string[] {
  const done = result.pointer;
  if (!done) return [];
  const units = done.ledger.entries.filter((entry) => entry.status === 'live').length;
  const lines = [
    `  Pointer reader: ${units} units in ${done.cuts.size} files, ${done.windows} windows labelled, ${done.carried} carried without a call, ${done.calls} model calls, ${done.recorded} answers recorded, ${done.unlabeled} units unlabeled, ${done.atoms} atoms.`,
  ];
  if (done.usage.input + done.usage.output > 0) {
    lines.push(`  Tokens: ${done.usage.input} in, ${done.usage.output} out.`);
  }
  const events = Object.entries(done.events).filter(([, count]) => count > 0 && true);
  lines.push(
    `  Units since the last ledger: ${events.map(([event, count]) => `${event} ${count}`).join(', ')}.`,
  );
  for (const failure of done.failed) lines.push(`    window failed: ${failure}`);
  for (const refusal of [...done.refusals, ...done.atomRefusals]) lines.push(`    refused: ${refusal}`);
  return lines;
}
