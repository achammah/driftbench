import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import {
  applyRealizedTextPolicy,
  blockStatus,
  Campaign,
  type CostUnit,
  canonicalJson,
  type LoadedSpec,
  Observed,
  objectContextOfSpec,
  type RunFilter,
  RunResult,
  type Store,
  shippedObjectContext,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { type BundleSource, type CampaignBundle, readCampaignBundle, writeCampaignBundle } from './bundle';
import { describeCause, describeIssues, StoreError } from './errors';
import {
  checkName,
  entriesOf,
  isVersionPath,
  isVersionRecord,
  REGISTRY_KINDS,
  type RegistryFile,
  type RegistryKind,
  type RegistryVersion,
  sha256,
  versionHash,
} from './registry';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import {
  bindStoredSpec,
  isSpecObjectIdentities,
  recordedObjectsOfSpec,
  specObjectIdentities,
} from './spec-objects';
import { loadSqlite } from './sqlite';
import { unitProblems } from './units';

type Row = Record<string, unknown>;

/** The latest moment a JavaScript Date can hold, in milliseconds. */
const MAX_DATE_MS = 8.64e15;

/**
 * Opens (or creates) the store at a file path, creating the parent folder when it is missing.
 * Needs Node.js 22.13 or newer for `node:sqlite`; an older Node.js gets a `NODE_VERSION` error.
 */
export function openStore(path: string): SqliteStore {
  const { DatabaseSync } = loadSqlite();
  let db: DatabaseSync | undefined;
  try {
    if (path !== ':memory:' && !path.startsWith('file:')) mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    setUp(db, path);
    return new SqliteStore(db, path);
  } catch (cause) {
    closeQuietly(db);
    if (cause instanceof StoreError) throw cause;
    throw new StoreError('OPEN_FAILED', `cannot open the store at ${path}: ${describeCause(cause)}`, {
      cause,
    });
  }
}

/** A store held in memory, with the same tables and the same behaviour. Its content goes with `close`. */
export function openMemoryStore(): SqliteStore {
  return openStore(':memory:');
}

function setUp(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      'SCHEMA_VERSION',
      `the store at ${path} has schema version ${version}; this version of driftbench reads ${SCHEMA_VERSION} and older`,
    );
  }
  // Every statement of SCHEMA_SQL is idempotent. A store older than this version runs it; a store at this
  // version runs it only when a table or index it creates is missing (one written before a table of the
  // current schema existed), so an open that finds everything writes nothing and the version stays.
  if (version >= SCHEMA_VERSION && schemaObjectsMissing(db).length === 0) return;
  transaction(db, () => {
    db.exec(SCHEMA_SQL);
    if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

/** The tables and indexes SCHEMA_SQL creates that the database does not hold. */
function schemaObjectsMissing(db: DatabaseSync): string[] {
  const wanted = [...SCHEMA_SQL.matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS (\w+)/g)].map(
    (match) => match[1] as string,
  );
  const held = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")
      .all()
      .map((row) => String(row.name)),
  );
  return wanted.filter((name) => !held.has(name));
}

/** Closes a database that failed to set up. The setup error is the one the caller reports. */
function closeQuietly(db: DatabaseSync | undefined): void {
  try {
    db?.close();
  } catch {
    // Already closed, or never opened: nothing is left to release.
  }
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = work();
    db.exec('COMMIT');
    return out;
  } catch (cause) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite already rolled back on its own; the error worth reporting is the one that caused it.
    }
    throw cause;
  }
}

/** Runs reads in one transaction, so they all see one version of the file. A writer waits until it ends. */
function readTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN');
  try {
    return work();
  } finally {
    try {
      db.exec('COMMIT');
    } catch {
      // SQLite already ended it; the error worth reporting is the one the work raised.
    }
  }
}

function statements(db: DatabaseSync) {
  return {
    upsertSpec: db.prepare(
      `INSERT INTO specs (id, hash, path, yaml, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id, hash) DO UPDATE SET path = excluded.path, yaml = excluded.yaml`,
    ),
    selectSpec: db.prepare('SELECT path, yaml FROM specs WHERE id = ? AND hash = ?'),
    upsertSpecObjects: db.prepare(
      `INSERT INTO spec_objects (spec_id, spec_hash, json) VALUES (?, ?, ?)
       ON CONFLICT (spec_id, spec_hash) DO UPDATE SET json = excluded.json`,
    ),
    selectSpecObjects: db.prepare('SELECT json FROM spec_objects WHERE spec_id = ? AND spec_hash = ?'),
    insertCampaignIfNew: db.prepare(
      'INSERT INTO campaigns (id, json, created_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING',
    ),
    selectCampaign: db.prepare('SELECT id, json FROM campaigns WHERE id = ?'),
    selectCampaigns: db.prepare('SELECT id, json FROM campaigns'),
    deleteBlocks: db.prepare('DELETE FROM blocks WHERE campaign_id = ? AND run_id = ?'),
    deleteRun: db.prepare('DELETE FROM runs WHERE campaign_id = ? AND run_id = ?'),
    insertRun: db.prepare(
      `INSERT INTO runs (campaign_id, run_id, spec_id, spec_hash, target_json, mode, repeat, perturbation_id,
         status, cost, started_at, finished_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertBlock: db.prepare(
      `INSERT INTO blocks (campaign_id, run_id, "index", given_hash, observed_json, verdicts_json, drift_json,
         pass, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    selectRun: db.prepare(
      'SELECT campaign_id, run_id, spec_id, mode, status, json FROM runs WHERE campaign_id = ? AND run_id = ?',
    ),
    selectRunsById: db.prepare(
      'SELECT campaign_id, run_id, spec_id, mode, status, json FROM runs WHERE run_id = ? ORDER BY campaign_id',
    ),
    selectBlocks: db.prepare(
      `SELECT "index", observed_json, verdicts_json, drift_json, json FROM blocks
       WHERE campaign_id = ? AND run_id = ? ORDER BY "index"`,
    ),
    upsertCache: db.prepare(
      `INSERT INTO cache (key, observed_json, created_at, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET observed_json = excluded.observed_json, created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
    ),
    selectCache: db.prepare('SELECT observed_json, expires_at FROM cache WHERE key = ?'),
    /** Deletes the entry only while it still holds the expiry that was read: a fresher put stays. */
    deleteExpiredCache: db.prepare('DELETE FROM cache WHERE key = ? AND expires_at = ?'),
    upsertUnit: db.prepare(
      `INSERT INTO units (adapter, metric, usd, samples, measured_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (adapter, metric) DO UPDATE SET usd = excluded.usd, samples = excluded.samples,
         measured_at = excluded.measured_at
       WHERE julianday(excluded.measured_at) >= julianday(units.measured_at)
         OR julianday(units.measured_at) IS NULL`,
    ),
    selectUnits: db.prepare(
      'SELECT adapter, metric, usd, samples, measured_at FROM units ORDER BY adapter, metric',
    ),
    selectUnitsOf: db.prepare(
      'SELECT adapter, metric, usd, samples, measured_at FROM units WHERE adapter = ? ORDER BY metric',
    ),
  } satisfies Record<string, StatementSync>;
}

/**
 * The SQLite store. Every write validates its record before it touches a table; every read
 * validates the record it rebuilt, so a corrupt row raises a `CORRUPT_ROW` error, never a bad value.
 */
export class SqliteStore implements Store {
  /** The database path, or `:memory:`. */
  readonly path: string;
  private readonly db: DatabaseSync;
  private readonly sql: ReturnType<typeof statements>;
  private closed = false;
  // Run writes need only this policy. Keep one validated row, not the full campaign per run.
  // Compare the current database bytes on every write so other connections' changes are still checked.
  private runCampaignPolicy?: { id: string; json: string; realizedText: boolean };

  constructor(db: DatabaseSync, path: string) {
    this.db = db;
    this.path = path;
    this.sql = statements(db);
  }

  async putSpec(spec: LoadedSpec): Promise<void> {
    this.live();
    if (spec?.ok !== true) throw new StoreError('INVALID_RECORD', 'putSpec takes a spec the loader accepted');
    const checked = validateSpec(spec.spec, spec.path, { objects: objectContextOfSpec(spec.spec) });
    if (!checked.ok) {
      const errors = checked.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`);
      throw new StoreError('INVALID_RECORD', `putSpec refused an invalid spec: ${errors.join('; ')}`);
    }
    if (checked.hash !== spec.hash) {
      throw new StoreError(
        'INVALID_RECORD',
        `putSpec refused spec ${checked.spec.id}: its hash says ${spec.hash} but its content hashes to ${checked.hash}`,
      );
    }
    const objects = specObjectIdentities(
      checked.spec,
      objectContextOfSpec(checked.spec) ?? shippedObjectContext(),
    );
    transaction(this.db, () => {
      this.sql.upsertSpec.run(checked.spec.id, checked.hash, spec.path, canonicalJson(checked.spec), now());
      this.sql.upsertSpecObjects.run(checked.spec.id, checked.hash, canonicalJson(objects));
    });
  }

  async getSpec(id: string, hash: string): Promise<LoadedSpec | undefined> {
    this.live();
    const row = this.sql.selectSpec.get(id, hash);
    if (row === undefined) return undefined;
    const where = `the specs row ${id}@${hash}`;
    const loaded = validateSpec(parseColumn(row, 'yaml', where), text(row, 'path', where), {
      resolveObjects: false,
    });
    if (!loaded.ok) {
      const errors = loaded.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`);
      throw corrupt(`${where} does not hold a valid spec: ${errors.join('; ')}`);
    }
    if (loaded.spec.id !== id || loaded.hash !== hash) {
      throw corrupt(`${where} holds spec ${loaded.spec.id}@${loaded.hash}`);
    }
    const objectsRow = this.sql.selectSpecObjects.get(id, hash);
    const identities = objectsRow === undefined ? undefined : parseColumn(objectsRow, 'json', where);
    if (identities !== undefined && !isSpecObjectIdentities(identities)) {
      throw corrupt(`${where} holds invalid object identities`);
    }
    return bindStoredSpec(loaded, identities);
  }

  async putCampaign(campaign: Campaign): Promise<void> {
    this.live();
    this.putCampaignNow(campaign);
  }

  async getCampaign(campaignId: string): Promise<Campaign | undefined> {
    this.live();
    const row = this.sql.selectCampaign.get(campaignId);
    return row === undefined ? undefined : readCampaign(row);
  }

  /**
   * Every campaign, newest first by the `createdAt` of its record, then by id. Times compare as dates, so
   * `...55.649Z` is later than `...55Z`; a time that is not a date comes after the dates. The row's own
   * insert time plays no part: an imported campaign keeps the time it was made.
   */
  async listCampaigns(): Promise<Campaign[]> {
    this.live();
    return this.sql.selectCampaigns.all().map(readCampaign).sort(newestFirst);
  }

  /** Stores a run under a campaign. A run put again under the same campaign and run id replaces the first. */
  async putRun(campaignId: string, run: RunResult): Promise<void> {
    this.live();
    transaction(this.db, () => this.putRunNow(campaignId, run));
  }

  /**
   * Reads one run. A run id is a cell id, so two campaigns can hold the same one: pass the campaign
   * id to pick, or the call raises `RUN_AMBIGUOUS` when the id is in more than one campaign.
   */
  async getRun(runId: string, campaignId?: string): Promise<RunResult | undefined> {
    this.live();
    if (campaignId !== undefined) {
      return readTransaction(this.db, () => {
        const row = this.sql.selectRun.get(campaignId, runId);
        return row === undefined ? undefined : this.readRun(row);
      });
    }
    return readTransaction(this.db, () => this.getRunById(runId));
  }

  private getRunById(runId: string): RunResult | undefined {
    const rows = this.sql.selectRunsById.all(runId);
    const [row] = rows;
    if (row === undefined) return undefined;
    if (rows.length > 1) {
      const campaigns = rows.map((each) => String(each.campaign_id)).join(', ');
      throw new StoreError(
        'RUN_AMBIGUOUS',
        `run ${runId} is in ${rows.length} campaigns (${campaigns}); pass the campaign id to getRun, or list one campaign's runs`,
      );
    }
    return this.readRun(row);
  }

  /** Lists runs, oldest start first, filtered by campaign, spec, mode and status when the filter sets them. */
  async listRuns(filter: RunFilter = {}): Promise<RunResult[]> {
    this.live();
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    for (const [column, value] of [
      ['campaign_id', filter.campaignId],
      ['spec_id', filter.specId],
      ['mode', filter.mode],
      ['status', filter.status],
    ] as const) {
      if (value === undefined) continue;
      clauses.push(`${column} = ?`);
      params.push(value);
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    return readTransaction(this.db, () => {
      const rows = this.db
        .prepare(
          `SELECT campaign_id, run_id, spec_id, mode, status, json FROM runs${where} ORDER BY started_at, campaign_id, run_id`,
        )
        .all(...params);
      return rows.map((row) => this.readRun(row));
    });
  }

  async cacheGet(key: string): Promise<Observed | undefined> {
    this.live();
    const row = this.sql.selectCache.get(key);
    if (row === undefined) return undefined;
    const where = `the cache row ${key}`;
    if (row.expires_at !== null) {
      const expiresAt = Date.parse(text(row, 'expires_at', where));
      if (Number.isNaN(expiresAt)) throw corrupt(`${where} holds an expiry that is not a date`);
      if (Date.now() >= expiresAt) {
        this.sql.deleteExpiredCache.run(key, text(row, 'expires_at', where));
        return undefined;
      }
    }
    const parsed = Observed.safeParse(parseColumn(row, 'observed_json', where));
    if (!parsed.success) {
      throw corrupt(`${where} does not match the Observed schema: ${describeIssues(parsed.error.issues)}`);
    }
    return parsed.data;
  }

  /** Caches an Observed. Without a ttl the entry stays until replaced; with one it is gone `ttlMs` after the put. */
  async cachePut(key: string, observed: Observed, ttlMs?: number): Promise<void> {
    this.live();
    if (typeof key !== 'string' || key === '') throw new StoreError('INVALID_RECORD', 'cachePut needs a key');
    const parsed = Observed.safeParse(observed);
    if (!parsed.success) {
      throw new StoreError(
        'INVALID_RECORD',
        `cachePut refused an invalid Observed: ${describeIssues(parsed.error.issues)}`,
      );
    }
    const at = Date.now();
    let expiresAt: string | null = null;
    if (ttlMs !== undefined) {
      if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs < 0 || at + ttlMs > MAX_DATE_MS) {
        throw new StoreError(
          'INVALID_RECORD',
          `cachePut needs a ttl of 0 or more milliseconds within the date range, or none to keep the entry; got ${ttlMs}`,
        );
      }
      expiresAt = new Date(at + ttlMs).toISOString();
    }
    this.sql.upsertCache.run(
      key,
      toJson(parsed.data, `the Observed for cache key ${key}`),
      new Date(at).toISOString(),
      expiresAt,
    );
  }

  /** Keeps one unit per adapter and metric: a new measurement replaces the old one. */
  async putUnit(unit: CostUnit): Promise<void> {
    this.live();
    const problems = unitProblems(unit);
    if (problems.length > 0) {
      throw new StoreError('INVALID_RECORD', `putUnit refused an invalid unit: ${problems.join('; ')}`);
    }
    this.sql.upsertUnit.run(unit.adapter, unit.metric, unit.usd, unit.samples ?? null, unit.measuredAt);
  }

  /** Lists units sorted by adapter and metric, for one adapter when it is given. */
  async listUnits(adapter?: string): Promise<CostUnit[]> {
    this.live();
    const rows = adapter === undefined ? this.sql.selectUnits.all() : this.sql.selectUnitsOf.all(adapter);
    return rows.map((row) => {
      const unit: Row = {
        adapter: row.adapter,
        metric: row.metric,
        usd: row.usd,
        measuredAt: row.measured_at,
      };
      if (row.samples !== null) unit.samples = row.samples;
      const problems = unitProblems(unit);
      if (problems.length > 0) {
        throw corrupt(
          `the units row ${String(row.adapter)}/${String(row.metric)} is invalid: ${problems.join('; ')}`,
        );
      }
      return unit as CostUnit;
    });
  }

  /**
   * Writes `<dir>/<campaignId>/` with `campaign.json`, `runs/<runId>.json` and `manifest.json`, and
   * returns that folder. Ids that are not plain file names are percent-encoded.
   */
  async exportCampaign(campaignId: string, dir: string): Promise<string> {
    this.live();
    const campaign = await this.getCampaign(campaignId);
    if (campaign === undefined) {
      throw new StoreError('CAMPAIGN_MISSING', `exportCampaign: campaign ${campaignId} is not in the store`);
    }
    const specs: LoadedSpec[] = [];
    for (const { id, hash } of campaign.specs) {
      const spec = await this.getSpec(id, hash);
      if (spec !== undefined && !specs.some((each) => each.spec.id === id && each.hash === hash))
        specs.push(spec);
    }
    const sources: BundleSource[] = [];
    for (const source of campaign.sources ?? []) {
      const version = await this.getVersion(source.kind, source.name, String(source.version));
      if (version === undefined || version.hash !== source.hash) {
        throw new StoreError(
          'BUNDLE_INVALID',
          `campaign ${campaignId} records ${source.kind} ${source.name}@${source.version}, which this store does not hold`,
        );
      }
      sources.push({ version, files: await this.readVersionFiles(version) });
    }
    return writeCampaignBundle(dir, campaign, await this.listRuns({ campaignId }), { specs, sources });
  }

  /**
   * Reads a folder `exportCampaign` wrote and stores its campaign and runs, all or nothing. The
   * campaign must be new to this store or equal to the one it holds. Returns the stored runs
   * after applying its text policy, alongside the verified source manifest.
   */
  async importCampaign(folder: string): Promise<CampaignBundle> {
    this.live();
    const bundle = await readCampaignBundle(folder);
    bundle.runs = bundle.runs.map((run) =>
      applyRealizedTextPolicy(run, bundle.campaign.provenance?.realizedText === true, {
        fromRun: run.runId,
        fromCampaign: bundle.campaign.campaignId,
      }),
    );
    this.live();
    transaction(this.db, () => {
      for (const source of bundle.sources) this.importVersionNow(source.version, source.files);
      for (const spec of bundle.specs) {
        this.sql.upsertSpec.run(spec.spec.id, spec.hash, spec.path, canonicalJson(spec.spec), now());
        const objects = recordedObjectsOfSpec(spec.spec);
        if (objects !== undefined)
          this.sql.upsertSpecObjects.run(spec.spec.id, spec.hash, canonicalJson(objects));
      }
      this.putCampaignNow(bundle.campaign);
      for (const run of bundle.runs) this.putRunNow(bundle.campaign.campaignId, run);
    });
    return bundle;
  }

  /**
   * Stores a set of files as the next version of a dataset or prompt. Content the name already holds
   * gives back that version, with `created: false`: a version never changes once pushed.
   */
  async pushVersion(
    kind: RegistryKind,
    name: string,
    files: readonly RegistryFile[],
    meta: { source?: string; single?: boolean; note?: string } = {},
  ): Promise<{ version: RegistryVersion; created: boolean }> {
    this.live();
    checkKind(kind);
    checkName(name);
    const entries = entriesOf(files);
    const hash = versionHash(entries);
    const held = this.db
      .prepare('SELECT json FROM versions WHERE kind = ? AND name = ? AND hash = ?')
      .get(kind, name, hash);
    if (held !== undefined) return { version: readVersion(held, `${kind} ${name}`), created: false };
    return transaction(this.db, () => {
      // Checked again under the write lock: the same content pushed by another process in between is
      // given back, not inserted twice.
      const committed = this.db
        .prepare('SELECT json FROM versions WHERE kind = ? AND name = ? AND hash = ?')
        .get(kind, name, hash);
      if (committed !== undefined) {
        return { version: readVersion(committed, `${kind} ${name}`), created: false };
      }
      const insertBlob = this.db.prepare(
        'INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)',
      );
      for (const file of files) insertBlob.run(sha256(file.bytes), file.bytes.byteLength, file.bytes);
      const last = this.db
        .prepare('SELECT max(version) AS last FROM versions WHERE kind = ? AND name = ?')
        .get(kind, name);
      const version: RegistryVersion = {
        kind,
        name,
        version: Number(last?.last ?? 0) + 1,
        hash,
        files: entries,
        ...(meta.source === undefined ? {} : { source: meta.source }),
        ...(meta.single === true ? { single: true } : {}),
        ...(meta.note === undefined ? {} : { note: meta.note }),
        createdAt: now(),
      };
      this.db
        .prepare(
          'INSERT INTO versions (kind, name, version, hash, json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(kind, name, version.version, hash, JSON.stringify(version), version.createdAt);
      return { version, created: true };
    });
  }

  /** The versions of one kind, for one name when it is given, by name then version. */
  async listVersions(kind: RegistryKind, name?: string): Promise<RegistryVersion[]> {
    this.live();
    checkKind(kind);
    const rows =
      name === undefined
        ? this.db.prepare('SELECT json FROM versions WHERE kind = ? ORDER BY name, version').all(kind)
        : this.db
            .prepare('SELECT json FROM versions WHERE kind = ? AND name = ? ORDER BY version')
            .all(kind, name);
    return rows.map((row) => readVersion(row, `${kind} ${name ?? ''}`.trim()));
  }

  /**
   * One version: by number (`3`), by a prefix of its hash of 6 or more characters, or the latest
   * when the ref is absent or `latest`.
   */
  async getVersion(kind: RegistryKind, name: string, ref?: string): Promise<RegistryVersion | undefined> {
    const versions = await this.listVersions(kind, name);
    if (ref === undefined || ref === 'latest') return versions.at(-1);
    if (/^\d+$/.test(ref)) {
      const numbered = versions.find((each) => each.version === Number(ref));
      if (numbered || ref.length < 6 || ref.length > 64) return numbered;
    }
    if (/^[0-9a-f]{6,64}$/.test(ref)) {
      const found = versions.filter((each) => each.hash.startsWith(ref));
      if (found.length > 1) {
        throw new StoreError(
          'INVALID_RECORD',
          `${kind} ${name}@${ref} matches versions ${found.map((each) => each.version).join(', ')}; give more of the hash`,
        );
      }
      return found[0];
    }
    throw new StoreError(
      'INVALID_RECORD',
      `"${ref}" is not a version: give a number, latest, or 6 or more hex characters of the hash`,
    );
  }

  /** The bytes of every file of a version, in path order, each checked against its hash. */
  async readVersionFiles(version: RegistryVersion): Promise<RegistryFile[]> {
    this.live();
    const select = this.db.prepare('SELECT bytes FROM blobs WHERE sha256 = ?');
    const label = `${version.kind} ${version.name}@${version.version}`;
    return version.files.map((entry) => {
      const row = select.get(entry.sha256);
      const bytes = row?.bytes;
      if (!(bytes instanceof Uint8Array)) {
        throw corrupt(`the blobs row for ${entry.path} of ${label} is missing`);
      }
      if (sha256(bytes) !== entry.sha256) {
        throw corrupt(`the file ${entry.path} of ${label} no longer hashes to ${entry.sha256}`);
      }
      return { path: entry.path, bytes: new Uint8Array(bytes) };
    });
  }

  /**
   * Stores a version read from a bundle under its own number. The same content already held is left;
   * other content under that number raises `VERSION_CONFLICT`. The caller has checked every file hash.
   */
  private importVersionNow(version: RegistryVersion, files: readonly RegistryFile[]): void {
    checkKind(version.kind);
    checkName(version.name);
    const label = `${version.kind} ${version.name}@${version.version}`;
    const escaping = [...version.files.map((entry) => entry.path), ...files.map((file) => file.path)].find(
      (path) => !isVersionPath(path),
    );
    if (escaping !== undefined) {
      throw new StoreError(
        'BUNDLE_INVALID',
        `${label} names the file path "${escaping}", which leaves the version`,
      );
    }
    const held = this.db
      .prepare('SELECT hash FROM versions WHERE kind = ? AND name = ? AND (hash = ? OR version = ?)')
      .all(version.kind, version.name, version.hash, version.version);
    if (held.some((row) => row.hash === version.hash)) return;
    if (held.length > 0) {
      throw new StoreError(
        'VERSION_CONFLICT',
        `${label} in this store holds other content than the bundle's; import into another store`,
      );
    }
    const insertBlob = this.db.prepare('INSERT OR IGNORE INTO blobs (sha256, size, bytes) VALUES (?, ?, ?)');
    for (const file of files) insertBlob.run(sha256(file.bytes), file.bytes.byteLength, file.bytes);
    this.db
      .prepare('INSERT INTO versions (kind, name, version, hash, json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        version.kind,
        version.name,
        version.version,
        version.hash,
        JSON.stringify(version),
        version.createdAt,
      );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.runCampaignPolicy = undefined;
    this.db.close();
  }

  private live(): void {
    if (this.closed) throw new StoreError('CLOSED', `the store at ${this.path} is closed`);
  }

  private putCampaignNow(campaign: Campaign): void {
    const parsed = Campaign.safeParse(campaign);
    if (!parsed.success) {
      throw new StoreError(
        'INVALID_RECORD',
        `putCampaign refused an invalid Campaign: ${describeIssues(parsed.error.issues)}`,
      );
    }
    const { campaignId } = parsed.data;
    // Insert first, compare after: one statement, so a campaign another process commits between a check and
    // the write is compared, never hit as a raw constraint error.
    const inserted = this.sql.insertCampaignIfNew.run(
      campaignId,
      toJson(parsed.data, `campaign ${campaignId}`),
      now(),
    );
    if (Number(inserted.changes) > 0) return;
    const row = this.sql.selectCampaign.get(campaignId);
    if (row !== undefined && canonicalJson(readCampaign(row)) === canonicalJson(parsed.data)) return;
    throw new StoreError(
      'CAMPAIGN_CONFLICT',
      `campaign ${campaignId} is already stored with other content; a campaign is immutable, so a re-run takes a new campaign id`,
    );
  }

  private putRunNow(campaignId: string, run: RunResult): void {
    const parsed = RunResult.safeParse(run);
    if (!parsed.success) {
      throw new StoreError(
        'INVALID_RECORD',
        `putRun refused an invalid RunResult: ${describeIssues(parsed.error.issues)}`,
      );
    }
    const campaignRow = this.sql.selectCampaign.get(campaignId);
    if (campaignRow === undefined) {
      throw new StoreError(
        'CAMPAIGN_MISSING',
        `putRun: campaign ${campaignId} is not in the store; put the campaign before its runs`,
      );
    }
    const campaignJson = text(campaignRow, 'json', `the campaigns row ${campaignId}`);
    let policy = this.runCampaignPolicy;
    if (policy?.id !== campaignId || policy.json !== campaignJson) {
      const campaign = readCampaign(campaignRow);
      policy = {
        id: campaignId,
        json: campaignJson,
        realizedText: campaign.provenance?.realizedText === true,
      };
      this.runCampaignPolicy = policy;
    }
    const { blocks, ...summary } = applyRealizedTextPolicy(parsed.data, policy.realizedText);
    const what = `run ${summary.runId}`;
    let previous = -1;
    for (const block of blocks) {
      if (block.index <= previous) {
        throw new StoreError(
          'INVALID_RECORD',
          `putRun refused ${what}: block indexes must rise strictly, in order`,
        );
      }
      previous = block.index;
    }
    const rows = blocks.map((block) => {
      const { observed, verdicts, drift, ...rest } = block;
      const label = `${what} block ${block.index}`;
      return [
        campaignId,
        summary.runId,
        block.index,
        block.givenHash,
        toJson(observed, label),
        toJson(verdicts, label),
        toJson(drift, label),
        blockStatus(block) === 'pass' ? 1 : 0,
        toJson(rest, label),
      ] satisfies SQLInputValue[];
    });
    const runJson = toJson(summary, what);

    this.sql.deleteBlocks.run(campaignId, summary.runId);
    this.sql.deleteRun.run(campaignId, summary.runId);
    this.sql.insertRun.run(
      campaignId,
      summary.runId,
      summary.specId,
      summary.specHash,
      canonicalJson(summary.target),
      summary.mode,
      summary.repeat,
      summary.perturbationId ?? null,
      summary.status,
      summary.cost,
      summary.startedAt,
      summary.finishedAt,
      runJson,
    );
    for (const values of rows) this.sql.insertBlock.run(...values);
  }

  private readRun(row: Row): RunResult {
    const campaignId = String(row.campaign_id);
    const runId = String(row.run_id);
    const where = `the runs row ${campaignId}/${runId}`;
    const summary = parseObject(row, 'json', where);
    const blockRows = this.sql.selectBlocks.all(campaignId, runId);
    const blocks = blockRows.map((blockRow) => {
      const blockWhere = `the blocks row ${campaignId}/${runId}/${String(blockRow.index)}`;
      return {
        ...parseObject(blockRow, 'json', blockWhere),
        observed: parseColumn(blockRow, 'observed_json', blockWhere),
        verdicts: parseColumn(blockRow, 'verdicts_json', blockWhere),
        drift: parseColumn(blockRow, 'drift_json', blockWhere),
      };
    });
    const parsed = RunResult.safeParse({ ...summary, blocks });
    if (!parsed.success) {
      throw corrupt(`${where} does not match the RunResult schema: ${describeIssues(parsed.error.issues)}`);
    }
    if (parsed.data.runId !== runId) throw corrupt(`${where} holds run ${parsed.data.runId}`);
    // The columns a filter reads must agree with the record, or a filter returns a run it does not match.
    for (const [column, held] of [
      ['spec_id', parsed.data.specId],
      ['mode', parsed.data.mode],
      ['status', parsed.data.status],
    ] as const) {
      if (row[column] !== undefined && row[column] !== held) {
        throw corrupt(`${where} has ${column} ${String(row[column])}, its record holds ${held}`);
      }
    }
    parsed.data.blocks.forEach((block, i) => {
      if (block.index !== blockRows[i]?.index) {
        throw corrupt(`${where} has block row ${String(blockRows[i]?.index)} holding block ${block.index}`);
      }
    });
    return parsed.data;
  }
}

function readCampaign(row: Row): Campaign {
  const where = `the campaigns row ${String(row.id)}`;
  const parsed = Campaign.safeParse(parseColumn(row, 'json', where));
  if (!parsed.success) {
    throw corrupt(`${where} does not match the Campaign schema: ${describeIssues(parsed.error.issues)}`);
  }
  if (parsed.data.campaignId !== row.id) throw corrupt(`${where} holds campaign ${parsed.data.campaignId}`);
  return parsed.data;
}

/**
 * Newest `createdAt` first, read as a date. A time that is not a date comes after every one that is, last
 * text first, so the order stays total. Equal times sort by campaign id.
 */
function newestFirst(a: Campaign, b: Campaign): number {
  const left = Date.parse(a.createdAt);
  const right = Date.parse(b.createdAt);
  let byTime: number;
  if (!Number.isNaN(left) && !Number.isNaN(right)) byTime = right - left;
  else if (Number.isNaN(left) !== Number.isNaN(right)) byTime = Number.isNaN(left) ? 1 : -1;
  else byTime = textOrder(b.createdAt, a.createdAt);
  return byTime !== 0 ? byTime : textOrder(a.campaignId, b.campaignId);
}

/** Code-unit order, the same on every machine and locale. */
function textOrder(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function checkKind(kind: string): asserts kind is RegistryKind {
  if (!REGISTRY_KINDS.includes(kind as RegistryKind)) {
    throw new StoreError('INVALID_RECORD', `the registry holds ${REGISTRY_KINDS.join(' and ')}, not ${kind}`);
  }
}

/** A versions row as a record, checked field by field. */
function readVersion(row: Row, label: string): RegistryVersion {
  const where = `the versions row of ${label}`;
  const value = parseObject(row, 'json', where);
  if (!isVersionRecord(value)) throw corrupt(`${where} is not a version record`);
  if (versionHash(value.files) !== value.hash) {
    throw corrupt(`${where} lists files that no longer hash to ${value.hash}`);
  }
  return value;
}

function corrupt(message: string): StoreError {
  return new StoreError('CORRUPT_ROW', message);
}

function text(row: Row, column: string, where: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw corrupt(`${where} holds no text in column ${column}`);
  return value;
}

function parseColumn(row: Row, column: string, where: string): unknown {
  const value = text(row, column, where);
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new StoreError(
      'CORRUPT_ROW',
      `${where} holds corrupt JSON in column ${column}: ${describeCause(cause)}`,
      {
        cause,
      },
    );
  }
}

function parseObject(row: Row, column: string, where: string): Row {
  const value = parseColumn(row, column, where);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw corrupt(`${where} holds no JSON object in column ${column}`);
  }
  return value as Row;
}

function toJson(value: unknown, what: string): string {
  try {
    return JSON.stringify(value);
  } catch (cause) {
    throw new StoreError('INVALID_RECORD', `${what} cannot be written as JSON: ${describeCause(cause)}`, {
      cause,
    });
  }
}

function now(): string {
  return new Date().toISOString();
}
