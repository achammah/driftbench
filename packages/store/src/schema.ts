/**
 * The version of the store's tables, of the run records they hold and of the export bundle. Opening a
 * database or reading a bundle written by a newer version fails with a clear error; an older database is
 * upgraded on open. Schema 3 adds the `spec_objects` table, and its run records may hold the block verdicts not_run and blocked
 * (`status`, `notRun`, `blocked`) and the resolution fields (`by`, `resolved`, `diagnoses`), which an older
 * driftbench cannot read. The tables are created with IF NOT EXISTS, so a store at
 * this version gains a table a later build added without a new version number; the setup runs on an open only
 * when a table or index it creates is missing.
 */
export const SCHEMA_VERSION = 3;

/**
 * The tables each schema version added: schema 1's tables, the registry with 2, `spec_objects` with 3. A test checks that
 * together they are every table SCHEMA_SQL creates and that every version up to SCHEMA_VERSION is listed, so a
 * new table or a new version is written here with its number.
 */
export const TABLES_BY_VERSION: Readonly<Record<number, readonly string[]>> = {
  1: ['specs', 'campaigns', 'runs', 'blocks', 'cache', 'units'],
  2: ['blobs', 'versions'],
  3: ['spec_objects'],
};

/**
 * The tables. Each row keeps its record as JSON; the plain columns are copies of record fields, kept
 * for filters and for SQL read by hand. A run's blocks live in `blocks`, one row per block, and the
 * run's own JSON holds everything else. Times are ISO 8601 text in UTC.
 *
 * Runs are keyed by campaign and run id: a run id is a cell id, which leaves the campaign out, so the
 * same cell run in two campaigns gives two rows.
 *
 * `blobs` and `versions` are the registry of datasets and prompts (schema 2): each file once by its
 * SHA-256, and one row per immutable version, its record in `json`.
 *
 * `specs.yaml` holds the canonical JSON of the normalised spec, which any YAML 1.2 parser reads; its
 * SHA-256 starts with the spec hash.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS specs (
  id TEXT NOT NULL,
  hash TEXT NOT NULL,
  path TEXT NOT NULL,
  yaml TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, hash)
) STRICT;

CREATE TABLE IF NOT EXISTS spec_objects (
  spec_id TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (spec_id, spec_hash),
  FOREIGN KEY (spec_id, spec_hash) REFERENCES specs (id, hash) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS runs (
  campaign_id TEXT NOT NULL REFERENCES campaigns (id),
  run_id TEXT NOT NULL,
  spec_id TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  target_json TEXT NOT NULL,
  mode TEXT NOT NULL,
  repeat INTEGER NOT NULL,
  perturbation_id TEXT,
  status TEXT NOT NULL,
  cost REAL NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (campaign_id, run_id)
) STRICT;

CREATE INDEX IF NOT EXISTS runs_by_run_id ON runs (run_id);

CREATE TABLE IF NOT EXISTS blocks (
  campaign_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  given_hash TEXT NOT NULL,
  observed_json TEXT NOT NULL,
  verdicts_json TEXT NOT NULL,
  drift_json TEXT NOT NULL,
  pass INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (campaign_id, run_id, "index"),
  FOREIGN KEY (campaign_id, run_id) REFERENCES runs (campaign_id, run_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  observed_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS versions (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, name, version),
  UNIQUE (kind, name, hash)
) STRICT;

CREATE TABLE IF NOT EXISTS units (
  adapter TEXT NOT NULL,
  metric TEXT NOT NULL,
  usd REAL NOT NULL,
  samples INTEGER,
  measured_at TEXT NOT NULL,
  PRIMARY KEY (adapter, metric)
) STRICT;
`;
