import { createHash } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseSpecText, type RunFilter } from '@agent-nexus/driftbench-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNodeVersion,
  MIN_NODE_VERSION,
  openStore,
  SCHEMA_VERSION,
  type SqliteStore,
  StoreError,
} from '../src/index';
import { SCHEMA_SQL, TABLES_BY_VERSION } from '../src/schema';
import { campaign, observed, run, storeError, tempDir } from './fixtures';

const ID = 'acme-2026-10-11';
const SPEC = ['id: acme-greeting', 'blocks:', '  - user: Hello', '    expect: { must: [Acme Telecom] }'].join(
  '\n',
);

let dir: string;
let path: string;
let store: SqliteStore;
/** A second connection to the same file, to read and damage rows behind the store's back. */
let raw: DatabaseSync;

beforeEach(async () => {
  dir = await tempDir();
  path = join(dir, 'nested', '.driftbench', 'store.db');
  store = openStore(path);
  raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = OFF');
});

afterEach(async () => {
  raw.close();
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

async function seed(): Promise<ReturnType<typeof run>> {
  const loaded = parseSpecText(SPEC, 'yaml', 'specs/acme-greeting.yaml');
  if (!loaded.ok) throw new Error('the inline spec does not load');
  await store.putSpec(loaded);
  await store.putCampaign(campaign());
  const stored = run();
  await store.putRun(ID, stored);
  await store.cachePut('cache-key-1', observed());
  return stored;
}

function damage(sql: string, ...params: (string | number)[]): void {
  const changes = raw.prepare(sql).run(...params).changes;
  if (Number(changes) !== 1) throw new Error(`the damage touched ${changes} rows: ${sql}`);
}

describe('a store on disk', () => {
  it('creates its parent folders and keeps every record across a reopen', async () => {
    const stored = await seed();
    await store.putUnit({
      adapter: 'function',
      metric: 'block',
      usd: 0.0015,
      measuredAt: '2026-10-11',
      samples: 2,
    });
    await store.close();
    expect((await stat(path)).isFile()).toBe(true);

    store = openStore(path);
    expect(await store.getCampaign(ID)).toStrictEqual(campaign());
    expect(await store.listCampaigns()).toStrictEqual([campaign()]);
    expect(await store.getRun(stored.runId)).toStrictEqual(stored);
    expect(await store.cacheGet('cache-key-1')).toStrictEqual(observed());
    expect(await store.listUnits()).toHaveLength(1);
    expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION);
  });

  it('writes the tables the brief names, one row per block, with query columns copied from the record', async () => {
    const stored = await seed();
    const tables = raw
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual([
      'blobs',
      'blocks',
      'cache',
      'campaigns',
      'runs',
      'spec_objects',
      'specs',
      'units',
      'versions',
    ]);
    expect({ ...raw.prepare('SELECT spec_id, mode, repeat, status, cost FROM runs').get() }).toEqual({
      spec_id: 'acme-new-customer-coverage',
      mode: 'F',
      repeat: 0,
      status: 'completed',
      cost: 0.003,
    });
    const blocks = raw.prepare('SELECT run_id, "index", given_hash, pass FROM blocks ORDER BY "index"').all();
    expect(blocks.map((row) => ({ ...row }))).toEqual([
      { run_id: stored.runId, index: 0, given_hash: 'given-0', pass: 1 },
      { run_id: stored.runId, index: 1, given_hash: 'given-1', pass: 1 },
    ]);
  });

  it('keeps the spec as YAML text whose SHA-256 starts with the spec hash', async () => {
    await seed();
    const row = raw.prepare('SELECT hash, yaml FROM specs').get();
    const text = String(row?.yaml);
    expect(createHash('sha256').update(text).digest('hex').startsWith(String(row?.hash))).toBe(true);
    const reloaded = parseSpecText(text, 'yaml', 'from-the-store.yaml');
    expect(reloaded.ok && reloaded.hash).toBe(row?.hash);
  });
});

describe('a run and its blocks are read in one transaction', () => {
  it('holds a writer off between the summary read and the blocks read, so a read is one whole version', async () => {
    const stored = await seed();
    const writer = new DatabaseSync(path);
    writer.exec('PRAGMA busy_timeout = 0');
    const sql = (store as unknown as { sql: { selectBlocks: { all: (...args: unknown[]) => unknown } } }).sql;
    const original = sql.selectBlocks.all.bind(sql.selectBlocks);
    let writerRefused = false;
    sql.selectBlocks.all = (...args: unknown[]) => {
      try {
        writer.prepare('UPDATE runs SET cost = cost + 1 WHERE run_id = ?').run(stored.runId);
      } catch {
        writerRefused = true;
      }
      return original(...args);
    };
    try {
      await store.getRun(stored.runId, ID);
      expect(writerRefused).toBe(true);
      writerRefused = false;
      await store.listRuns();
      expect(writerRefused).toBe(true);
    } finally {
      sql.selectBlocks.all = original;
      writer.close();
    }
  });
});

describe('a corrupt row raises a clear error', () => {
  it('for a run whose JSON does not parse', async () => {
    const stored = await seed();
    damage('UPDATE runs SET json = ? WHERE run_id = ?', '{"runId": ', stored.runId);
    const error = await storeError(() => store.getRun(stored.runId));
    expect(error).toBeInstanceOf(StoreError);
    expect(error.code).toBe('CORRUPT_ROW');
    expect(error.message).toBe(
      `store: the runs row ${ID}/${stored.runId} holds corrupt JSON in column json: ${jsonError('{"runId": ')}`,
    );
    expect((await storeError(() => store.listRuns())).code).toBe('CORRUPT_ROW');
  });

  it.each<[string, string, RunFilter]>([
    ['status', 'failed', { status: 'failed' }],
    ['spec_id', 's-other', { specId: 's-other' }],
    ['mode', 'T', { mode: 'T' }],
  ])(
    'for a run whose %s column was edited away from its record, so a filter never returns it',
    async (column, value, filter) => {
      const stored = await seed();
      damage(`UPDATE runs SET ${column} = ? WHERE run_id = ?`, value, stored.runId);
      const error = await storeError(() => store.listRuns(filter));
      expect(error.code).toBe('CORRUPT_ROW');
      expect(error.message).toContain(`the runs row ${ID}/${stored.runId}`);
    },
  );

  it('for a block whose observed JSON does not parse', async () => {
    const stored = await seed();
    damage('UPDATE blocks SET observed_json = ? WHERE "index" = 1', 'not json');
    const error = await storeError(() => store.getRun(stored.runId, ID));
    expect(error.code).toBe('CORRUPT_ROW');
    expect(error.message).toContain(
      `the blocks row ${ID}/${stored.runId}/1 holds corrupt JSON in column observed_json`,
    );
  });

  it('for a run whose JSON parses but breaks the schema', async () => {
    const stored = await seed();
    const json = JSON.parse(String(raw.prepare('SELECT json FROM runs').get()?.json));
    damage('UPDATE runs SET json = ? WHERE run_id = ?', JSON.stringify({ ...json, mode: 'X' }), stored.runId);
    const error = await storeError(() => store.getRun(stored.runId));
    expect(error.code).toBe('CORRUPT_ROW');
    expect(error.message).toContain(
      `the runs row ${ID}/${stored.runId} does not match the RunResult schema: mode`,
    );
  });

  it('for a run row that holds another run', async () => {
    const stored = await seed();
    damage('UPDATE runs SET run_id = ? WHERE run_id = ?', 'ffffffffffffffff', stored.runId);
    damage('UPDATE blocks SET run_id = ? WHERE "index" = 0', 'ffffffffffffffff');
    damage('UPDATE blocks SET run_id = ? WHERE "index" = 1', 'ffffffffffffffff');
    const error = await storeError(() => store.getRun('ffffffffffffffff'));
    expect(error.code).toBe('CORRUPT_ROW');
    expect(error.message).toContain(`holds run ${stored.runId}`);
  });

  it('for a campaign, a cache entry, a spec and a unit', async () => {
    await seed();
    await store.putUnit({ adapter: 'function', metric: 'block', usd: 0.0015, measuredAt: '2026-10-11' });
    damage('UPDATE campaigns SET json = ? WHERE id = ?', '[', ID);
    damage(
      'UPDATE cache SET observed_json = ? WHERE key = ?',
      JSON.stringify({ text: 'no segments' }),
      'cache-key-1',
    );
    const spec = JSON.parse(String(raw.prepare('SELECT yaml FROM specs').get()?.yaml));
    damage('UPDATE specs SET yaml = ?', JSON.stringify({ ...spec, title: 'edited behind the store' }));
    damage('UPDATE units SET usd = -1');

    const campaignError = await storeError(() => store.getCampaign(ID));
    expect(campaignError.message).toContain(`the campaigns row ${ID} holds corrupt JSON in column json`);
    const listError = await storeError(() => store.listCampaigns());
    expect(listError.message).toContain(`the campaigns row ${ID} holds corrupt JSON in column json`);
    const cacheError = await storeError(() => store.cacheGet('cache-key-1'));
    expect(cacheError.message).toContain('the cache row cache-key-1 does not match the Observed schema');
    const loaded = parseSpecText(SPEC, 'yaml');
    const specError = await storeError(() => store.getSpec('acme-greeting', loaded.ok ? loaded.hash : ''));
    expect(specError.message).toMatch(/the specs row acme-greeting@\w+ holds spec acme-greeting@\w+/);
    const unitError = await storeError(() => store.listUnits());
    expect(unitError.message).toContain('the units row function/block is invalid: usd');
    for (const error of [campaignError, listError, cacheError, specError, unitError])
      expect(error.code).toBe('CORRUPT_ROW');
  });
});

describe('opening a store', () => {
  it('refuses a database from a newer schema', async () => {
    await store.close();
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    const error = await storeError(() => openStore(path));
    expect(error.code).toBe('SCHEMA_VERSION');
    expect(error.message).toContain(`schema version ${SCHEMA_VERSION + 1}`);
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    store = openStore(path);
  });

  it('upgrades a schema 1 database: its records stay, the registry tables appear', async () => {
    const stored = await seed();
    await store.close();
    raw.exec('DROP TABLE versions; DROP TABLE blobs; PRAGMA user_version = 1');
    store = openStore(path);
    expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION);
    expect(await store.getRun(stored.runId)).toStrictEqual(stored);
    const pushed = await store.pushVersion('prompt', 'acme-sales', [
      { path: 'acme-sales.md', bytes: new TextEncoder().encode('You are the Acme sales assistant.\n') },
    ]);
    expect(pushed.version.version).toBe(1);
  });

  it('upgrades schema 2 without changing stored spec hashes or run records', async () => {
    const stored = await seed();
    await store.close();
    const before = raw.prepare('SELECT id, hash, yaml FROM specs ORDER BY id, hash').all();
    raw.exec('DROP TABLE spec_objects; PRAGMA user_version = 2');
    store = openStore(path);
    expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION);
    expect(raw.prepare('SELECT id, hash, yaml FROM specs ORDER BY id, hash').all()).toEqual(before);
    expect(raw.prepare('SELECT count(*) AS count FROM spec_objects').get()?.count).toBe(0);
    expect(await store.getRun(stored.runId)).toStrictEqual(stored);
  });

  it('adds a table the current schema holds to a store already at the current version', async () => {
    const stored = await seed();
    await store.close();
    // A store a build wrote at this version before spec_objects existed: the version number says current.
    raw.exec(`DROP TABLE spec_objects; PRAGMA user_version = ${SCHEMA_VERSION}`);
    store = openStore(path);
    expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION);
    expect(raw.prepare('SELECT count(*) AS count FROM spec_objects').get()?.count).toBe(0);
    expect(await store.getRun(stored.runId)).toStrictEqual(stored);
  });

  it('opens a store that holds every table of the current schema while another connection holds the write lock', async () => {
    await seed();
    await store.close();
    // An open that took a write lock to run the schema again would wait here, then fail as locked.
    raw.exec('BEGIN IMMEDIATE');
    try {
      const started = Date.now();
      store = openStore(path);
      expect(Date.now() - started).toBeLessThan(2000);
      await store.close();
    } finally {
      raw.exec('ROLLBACK');
    }
    store = openStore(path);
  });

  it('lists every table SCHEMA_SQL creates under the version that added it, and every version', () => {
    const created = [...SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1]);
    expect(Object.values(TABLES_BY_VERSION).flat().sort()).toEqual(created.sort());
    expect(Object.keys(TABLES_BY_VERSION).map(Number)).toEqual(
      Array.from({ length: SCHEMA_VERSION }, (_, index) => index + 1),
    );
  });

  it('upgrades every older schema to the current one, whatever the current number', async () => {
    for (let version = 1; version < SCHEMA_VERSION; version += 1) {
      const stored = await seed();
      await store.close();
      // The tables the versions after this one added, from the schema's own list.
      const dropped = Object.entries(TABLES_BY_VERSION)
        .filter(([since]) => Number(since) > version)
        .flatMap(([, tables]) => tables);
      raw.exec(
        [...dropped.map((table) => `DROP TABLE ${table}`), `PRAGMA user_version = ${version}`].join('; '),
      );
      store = openStore(path);
      expect(raw.prepare('PRAGMA user_version').get()?.user_version, `from schema ${version}`).toBe(
        SCHEMA_VERSION,
      );
      expect(await store.getRun(stored.runId), `from schema ${version}`).toStrictEqual(stored);
      await store.pushVersion('dataset', `from-${version}`, [
        { path: 'a.yaml', bytes: new TextEncoder().encode('a\n') },
      ]);
    }
  });

  it('refuses a file that is not a database', async () => {
    const text = join(dir, 'notes.db');
    await writeFile(text, 'Acme Telecom meeting notes, not a database.\n'.repeat(20));
    const error = await storeError(() => openStore(text));
    expect(error.code).toBe('OPEN_FAILED');
    expect(error.message).toContain(`cannot open the store at ${text}`);
  });
});

describe('the Node.js check', () => {
  it('refuses Node.js older than 22.13 with the version it needs and the one it found', async () => {
    for (const version of ['22.12.0', '22.5.1', '20.18.1', '18.20.4']) {
      const error = await storeError(() => assertNodeVersion(version));
      expect(error.code).toBe('NODE_VERSION');
      expect(error.message).toBe(
        `store: the store needs Node.js ${MIN_NODE_VERSION} or newer for node:sqlite; this is Node.js ${version}`,
      );
    }
  });

  it('accepts 22.13 and every newer line', () => {
    for (const version of ['22.13.0', '22.20.1', '23.4.0', '24.18.0', '26.0.0']) {
      expect(() => assertNodeVersion(version)).not.toThrow();
    }
    expect(() => assertNodeVersion()).not.toThrow();
  });
});

function jsonError(text: string): string {
  try {
    JSON.parse(text);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the text parses');
}
