import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  clearObjectContexts,
  ObjectError,
  objectContextFor,
  PROJECT_OBJECTS_DIR,
  type ResolvedObject,
} from '@agent-nexus/driftbench-core';
import { type Persona, SimulatedUserError } from '@agent-nexus/driftbench-users';
import { parse as parseYaml, stringify } from 'yaml';

/**
 * `driftbench object migrate persona`: an old persona bundle (one file with who the person is, the goal, the
 * facts and their ask patterns) split into the three parts of the simulated user model. Who the person is
 * goes to a `persona` object and what they want to a `scenario` object, both project objects under
 * `driftbench/`; the facts they give only when asked go to the situational block, which a spec block owns.
 * The situational block names the persona and the scenario by id and they resolve through the project layer,
 * as every object does. `simulate --persona` and `campaign run --driver simulated --persona` play the block, composed back into
 * exactly the persona the old file gave, so a migrated file plays the same conversation, request for request.
 */

/** One fact the user holds in this block, given once an agent reply matches one of its ask patterns. */
type Holds = { slot: string; value: string; reveal: 'on_request'; asked_by: string[] };

/** The situational block a migration writes: the spec it plays and the `simulated_user` of its block. */
export type SituationalBlock = {
  spec?: string;
  simulated_user: { scenario: string; personas: [string]; situational: { holds: Holds[] } };
};

/** The folder, under the project folder, the situational blocks go to. */
export const SITUATIONAL_DIR = 'situational';

/** The files of one migrated persona: paths relative to the project folder, and their YAML text. */
export type MigratedFiles = {
  persona: string;
  scenario: string;
  situational: string;
  texts: Map<string, string>;
};

/**
 * The three files of one old persona. `from` is the old file (for its spec path and the header comment), `out`
 * the project folder: `driftbench/persona/<id>.yaml`, `driftbench/scenario/<id>.yaml` and
 * `situational/<id>.yaml` under it.
 */
export function migratePersona(persona: Persona, from: string, out: string): MigratedFiles {
  const paths = {
    persona: join(PROJECT_OBJECTS_DIR, 'persona', `${persona.id}.yaml`),
    scenario: join(PROJECT_OBJECTS_DIR, 'scenario', `${persona.id}.yaml`),
    situational: join(SITUATIONAL_DIR, `${persona.id}.yaml`),
  };
  const header = (what: string) =>
    `# ${what} of ${persona.id}, written by driftbench object migrate persona from ${basename(from)}.\n`;
  // The persona and the scenario kinds hold no fields of their own yet: the migrated values sit in params,
  // under the names of the old file, until the persona model gives them their own fields.
  const personaObject = {
    kind: 'persona',
    id: persona.id,
    description: `${persona.name}, migrated from ${basename(from)}.`,
    params: { name: persona.name, persona: persona.persona, stop_token: persona.stop_token },
  };
  const scenario = {
    kind: 'scenario',
    id: persona.id,
    description: `What ${persona.name} wants, migrated from ${basename(from)}.`,
    params: { goal: persona.goal },
  };
  const holds: Holds[] = Object.entries(persona.facts).map(([slot, value]) => ({
    slot,
    value,
    reveal: 'on_request',
    asked_by: [...(persona.reveal_when_asked[slot] ?? [])],
  }));
  const block: SituationalBlock = {
    ...(persona.spec === undefined
      ? {}
      : {
          spec: posix(relative(dirname(join(out, paths.situational)), resolve(dirname(from), persona.spec))),
        }),
    simulated_user: { scenario: persona.id, personas: [persona.id], situational: { holds } },
  };
  const yaml = (value: unknown) => stringify(value, { lineWidth: 0 });
  return {
    ...paths,
    texts: new Map([
      [paths.persona, header('The persona') + yaml(personaObject)],
      [paths.scenario, header('The scenario') + yaml(scenario)],
      [
        paths.situational,
        `${header('The situational block')}# Its simulated_user goes under the block's when; simulate --persona plays this file.\n${yaml(block)}`,
      ],
    ]),
  };
}

/** True when a parsed persona file is a situational block rather than an old persona bundle. */
export function isSituationalBlock(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'simulated_user' in raw;
}

/**
 * The persona a situational block plays: its persona and scenario objects, resolved through the objects the
 * block's folder sees (the project layer of the nearest `driftbench.yaml`), composed back into the old shape.
 */
export async function loadSituationalPersona(path: string): Promise<Persona> {
  const block = asSituationalBlock(await readYaml(path), path);
  const { scenario: scenarioId, personas, situational } = block.simulated_user;
  clearObjectContexts();
  const { store, problems } = objectContextFor(path);
  const resolveObject = (kind: string, id: string): ResolvedObject => {
    try {
      return store.resolve(kind, id);
    } catch (cause) {
      const problem = problems[0];
      const why = cause instanceof ObjectError && problem !== undefined ? ` (${problem.message})` : '';
      throw new SimulatedUserError(
        `${path}: ${cause instanceof Error ? cause.message : String(cause)}${why}`,
      );
    }
  };
  const person = resolveObject('persona', personas[0]);
  const scenario = resolveObject('scenario', scenarioId);
  const { name, persona: prose, stop_token: stop } = person.params;
  const { goal } = scenario.params;
  for (const [what, value] of [
    [`persona ${person.id} params.name`, name],
    [`persona ${person.id} params.persona`, prose],
    [`persona ${person.id} params.stop_token`, stop],
    [`scenario ${scenario.id} params.goal`, goal],
  ] as const) {
    if (typeof value !== 'string' || value === '') {
      throw new SimulatedUserError(`${path}: the ${what} must be a non-empty string to play the block`);
    }
  }
  const facts: Record<string, string> = {};
  const reveal: Record<string, string[]> = {};
  for (const fact of situational.holds) {
    if (fact.slot in facts) throw new SimulatedUserError(`${path}: the slot ${fact.slot} is held twice`);
    facts[fact.slot] = fact.value;
    reveal[fact.slot] = [...fact.asked_by];
  }
  return {
    id: person.id,
    name: name as string,
    persona: prose as string,
    goal: goal as string,
    facts,
    reveal_when_asked: reveal,
    stop_token: stop as string,
    ...(block.spec === undefined ? {} : { spec: block.spec }),
  };
}

async function readYaml(path: string): Promise<unknown> {
  try {
    return parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    throw new SimulatedUserError(
      `${path}: ${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)}`,
    );
  }
}

type Fields = Record<string, unknown>;

function refuse(path: string, what: string): never {
  throw new SimulatedUserError(`${path}: ${what}`);
}

/** A map with exactly the keys named (the optional ones may be absent), else refused with the first odd key. */
function fields(
  raw: unknown,
  path: string,
  where: string,
  required: string[],
  optional: string[] = [],
): Fields {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) refuse(path, `${where} must be a map`);
  const value = raw as Fields;
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key))
      refuse(path, `${where} has the unknown key ${key}`);
  }
  for (const key of required) if (!(key in value)) refuse(path, `${where} needs ${key}`);
  return value;
}

function text(value: unknown, path: string, where: string): string {
  if (typeof value !== 'string' || value === '') refuse(path, `${where} must be a non-empty string`);
  return value;
}

function asSituationalBlock(raw: unknown, path: string): SituationalBlock {
  const value = fields(raw, path, '(file)', ['simulated_user'], ['spec']);
  const user = fields(value.simulated_user, path, 'simulated_user', ['scenario', 'personas', 'situational']);
  const personas = user.personas;
  if (!Array.isArray(personas) || personas.length !== 1) {
    refuse(
      path,
      'simulated_user.personas must name one persona: a migrated block plays the persona it came from',
    );
  }
  const situational = fields(user.situational, path, 'simulated_user.situational', ['holds']);
  if (!Array.isArray(situational.holds)) refuse(path, 'simulated_user.situational.holds must be a list');
  const holds = situational.holds.map((entry, index) => {
    const where = `simulated_user.situational.holds.${index}`;
    const fact = fields(entry, path, where, ['slot', 'value', 'reveal', 'asked_by']);
    if (fact.reveal !== 'on_request') refuse(path, `${where}.reveal must be on_request`);
    const asked = fact.asked_by;
    if (!Array.isArray(asked) || asked.length === 0) refuse(path, `${where}.asked_by must list ask patterns`);
    return {
      slot: text(fact.slot, path, `${where}.slot`),
      value: text(fact.value, path, `${where}.value`),
      reveal: 'on_request' as const,
      asked_by: asked.map((pattern, at) => text(pattern, path, `${where}.asked_by.${at}`)),
    };
  });
  return {
    ...(value.spec === undefined ? {} : { spec: text(value.spec, path, 'spec') }),
    simulated_user: {
      scenario: text(user.scenario, path, 'simulated_user.scenario'),
      personas: [text(personas[0], path, 'simulated_user.personas.0')],
      situational: { holds },
    },
  };
}

function posix(path: string): string {
  return path.split(sep).join('/');
}
