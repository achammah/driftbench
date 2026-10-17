import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadSpecFile, type TargetRef, type UserDriver } from '@agent-nexus/driftbench-core';
import {
  createSimulatedUser,
  loadPersona,
  loadUserRecording,
  type Persona,
  personaOptions,
  SimulatedUserError,
  type UserModelPort,
  userRecordingPort,
} from '@agent-nexus/driftbench-users';
import { parse as parseYaml } from 'yaml';
import type { Io } from '../io';
import { isSituationalBlock, loadSituationalPersona } from './object-migrate';

/**
 * Where a simulated user speaks from, and the persona files a run plays: shared by `driftbench simulate`
 * and `driftbench campaign run --driver simulated`.
 */

export type UserSourceOptions = {
  model?: boolean;
  recording?: string[];
  agentFamily?: string;
  judgeFamily?: string[];
};

/** The agents this build reaches that are not a model: their family is `none`. */
const NOT_A_MODEL = new Set(['function:acme', 'function:acme-sales', 'process:acme-ops']);

/** The agent family a run declares: the flag, else `none` for a target this build knows is not a model. */
export function agentFamilyOf(target: TargetRef, given: string | undefined): string | undefined {
  if (given !== undefined) return given;
  const shown = target.agent === undefined ? target.adapter : `${target.adapter}:${target.agent}`;
  return NOT_A_MODEL.has(shown) ? 'none' : undefined;
}

/** True when the file parses as a situational block; an unreadable file is left to the persona loader. */
async function situational(path: string): Promise<boolean> {
  try {
    return isSituationalBlock(parseYaml(await readFile(path, 'utf8')));
  } catch {
    return false;
  }
}

/** A persona loaded from its file, with the spec it names resolved to the spec's id. */
export type LoadedPersona = { persona: Persona; path: string; specId?: string };

/**
 * Loads persona files; a persona's `spec` is read relative to its file. A file may also be the situational
 * block `object migrate persona` writes: its persona and scenario objects are composed back into the persona
 * the old file gave. Undefined (printed) on a bad file.
 */
export async function loadPersonas(paths: readonly string[], io: Io): Promise<LoadedPersona[] | undefined> {
  const loaded: LoadedPersona[] = [];
  for (const path of paths) {
    const absolute = resolve(io.cwd, path);
    let persona: Persona;
    try {
      persona = (await situational(absolute))
        ? await loadSituationalPersona(absolute)
        : await loadPersona(absolute);
    } catch (cause) {
      io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      return undefined;
    }
    let specId: string | undefined;
    if (persona.spec !== undefined) {
      const spec = await loadSpecFile(resolve(dirname(absolute), persona.spec));
      if (!spec.ok) {
        io.err(`The persona ${persona.id} plays ${persona.spec}, which does not load as a spec.\n`);
        return undefined;
      }
      specId = spec.spec.id;
    }
    loaded.push({ persona, path: absolute, ...(specId === undefined ? {} : { specId }) });
  }
  return loaded;
}

/** The ports a run speaks through: the model port, or one recording per persona id. */
export type UserSource =
  | { kind: 'model'; port: UserModelPort }
  | { kind: 'recording'; ports: Map<string, UserModelPort>; families: Map<string, string> };

/**
 * The source the flags name: `--model` (the model port the environment configures) or `--recording`
 * (answers written or recorded earlier, replayed by turn). Undefined, printed, on a usage error.
 */
export async function userSource(
  options: UserSourceOptions,
  modelPort: () => UserModelPort,
  io: Io,
): Promise<UserSource | undefined> {
  const recordings = options.recording ?? [];
  if (options.model && recordings.length > 0) {
    io.err('Give --model or --recording, not both.\n');
    return undefined;
  }
  if (!options.model && recordings.length === 0) {
    io.err('Name where the user speaks from: --model (the model port) or --recording <file>.\n');
    return undefined;
  }
  if (options.model) {
    try {
      return { kind: 'model', port: modelPort() };
    } catch (cause) {
      io.err(`The model port is not set up: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      return undefined;
    }
  }
  const ports = new Map<string, UserModelPort>();
  const families = new Map<string, string>();
  for (const path of recordings) {
    try {
      const recording = await loadUserRecording(resolve(io.cwd, path));
      ports.set(recording.persona, userRecordingPort(recording));
      families.set(recording.persona, recording.family);
    } catch (cause) {
      io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
      return undefined;
    }
  }
  return { kind: 'recording', ports, families };
}

/** The port a persona speaks through, or a message saying none does. */
export function portFor(source: UserSource, persona: Persona): UserModelPort | string {
  if (source.kind === 'model') return source.port;
  return source.ports.get(persona.id) ?? `No --recording holds the answers of the persona ${persona.id}.`;
}

/** How the source reads in a line of output: `model <family> <model>` or `recording <family>`. */
export function describeSource(source: UserSource, persona: Persona): string {
  if (source.kind === 'model') return `model ${source.port.family} ${source.port.model ?? 'unknown'}`;
  return `recording ${source.families.get(persona.id) ?? 'unknown'}`;
}

/**
 * A factory of simulated users for one persona: each call gives a fresh user for one run. It checks the
 * families at once, so a wrong port fails before anything runs: the error message says why.
 */
export function userFactory(
  persona: Persona,
  port: UserModelPort,
  agentFamily: string,
  judgeFamilies: readonly string[],
): (() => UserDriver) | string {
  const make = () =>
    createSimulatedUser({ ...personaOptions(persona), port, agentFamily, judgeFamilies: [...judgeFamilies] });
  try {
    make();
  } catch (cause) {
    if (cause instanceof SimulatedUserError) return cause.message;
    throw cause;
  }
  return make;
}
