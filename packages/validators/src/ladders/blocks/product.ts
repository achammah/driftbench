import * as adapters from '@agent-nexus/driftbench-adapters';
import * as artifacts from '@agent-nexus/driftbench-artifacts';
import * as checks from '@agent-nexus/driftbench-checks';
import * as core from '@agent-nexus/driftbench-core';
import * as report from '@agent-nexus/driftbench-report';
import * as sandbox from '@agent-nexus/driftbench-sandbox';
import * as stats from '@agent-nexus/driftbench-stats';
import * as store from '@agent-nexus/driftbench-store';
import * as users from '@agent-nexus/driftbench-users';

/**
 * The product the blocks bank measures, as the packages it exports and its command line. Items reach the
 * product only through this record, never by importing a package themselves, so a test can hand the bank a
 * product that cheats (every block passes, nothing runs, everything is in the blast radius) and see the items
 * fail. A capability that is not on the product yet is an export or a command it does not have: `need` turns
 * that into a failure that names the missing export.
 */

export type Module = Readonly<Record<string, unknown>>;

export type CliResult = { code: number; out: string; err: string };

export type BlocksProduct = {
  /** `real`, or the name of a cheating product in the tests. */
  name: string;
  core: Module;
  checks: Module;
  stats: Module;
  report: Module;
  users: Module;
  adapters: Module;
  store: Module;
  sandbox: Module;
  artifacts: Module;
  /** The command line `driftbench <argv>`, run in this process with `cwd` as its working folder. */
  cli(argv: readonly string[], cwd: string): Promise<CliResult>;
};

/** An export the product lacks: the item fails and says which. */
export class Missing extends Error {}

/** The export `name` of the package `pkg`, or a throw naming it. */
export function need<T>(mod: Module, pkg: string, name: string): T {
  const value = mod[name];
  if (value === undefined) throw new Missing(`the product has no export ${name} in ${pkg}`);
  return value as T;
}

/** The export `name` of the package `pkg`, or undefined: for a capability an item checks the absence of. */
export function maybe<T>(mod: Module, name: string): T | undefined {
  return mod[name] as T | undefined;
}

async function realCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const { main } = (await import('../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const code = await main([...argv], {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd,
  });
  return { code, out, err };
}

/** The product as it is in this repository. */
export function realProduct(): BlocksProduct {
  return {
    name: 'real',
    core: core as Module,
    checks: checks as Module,
    stats: stats as Module,
    report: report as Module,
    users: users as Module,
    adapters: adapters as Module,
    store: store as Module,
    sandbox: sandbox as Module,
    artifacts: artifacts as Module,
    cli: realCli,
  };
}

export type ProductPatch = {
  name: string;
  core?: Record<string, unknown>;
  checks?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  report?: Record<string, unknown>;
  users?: Record<string, unknown>;
  adapters?: Record<string, unknown>;
  store?: Record<string, unknown>;
  sandbox?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  cli?: BlocksProduct['cli'];
};

/** A product that is `base` with some exports, or its command line, replaced. */
export function patched(base: BlocksProduct, patch: ProductPatch): BlocksProduct {
  return {
    name: patch.name,
    core: { ...base.core, ...patch.core },
    checks: { ...base.checks, ...patch.checks },
    stats: { ...base.stats, ...patch.stats },
    report: { ...base.report, ...patch.report },
    users: { ...base.users, ...patch.users },
    adapters: { ...base.adapters, ...patch.adapters },
    store: { ...base.store, ...patch.store },
    sandbox: { ...base.sandbox, ...patch.sandbox },
    artifacts: { ...base.artifacts, ...patch.artifacts },
    cli: patch.cli ?? base.cli,
  };
}
