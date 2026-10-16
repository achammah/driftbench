import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {
  applyRealizedTextPolicy,
  Campaign,
  canonicalJson,
  type LoadedSpec,
  RunResult,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import { describeCause, describeIssues, StoreError } from './errors';
import {
  isVersionPath,
  isVersionRecord,
  type RegistryFile,
  type RegistryVersion,
  sha256,
  versionHash,
} from './registry';
import { SCHEMA_VERSION } from './schema';
import { bindStoredSpec, isSpecObjectIdentities, recordedObjectsOfSpec } from './spec-objects';

/** The `format` every campaign bundle manifest carries. */
export const BUNDLE_FORMAT = 'driftbench-campaign';

const MANIFEST = 'manifest.json';
const CAMPAIGN = 'campaign.json';
const RUNS = 'runs';
const SPECS = 'specs';
const SOURCES = 'sources';
const VERSION = 'version.json';
const FILES = 'files';

/** The first file a reader opens. It is written last, so a bundle without one did not finish. */
export type BundleManifest = {
  format: typeof BUNDLE_FORMAT;
  schemaVersion: number;
  campaignId: string;
  /** `specs` and `sources` are there when the bundle carries any. */
  counts: { runs: number; blocks: number; specs?: number; sources?: number };
  /**
   * The SHA-256 of the canonical JSON of each record, by its path in the bundle. A record edited after the
   * export no longer matches and the bundle is refused. Bundles written before this field read as before.
   */
  hashes?: Record<string, string>;
};

function recordHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function isHashes(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((hash) => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))
  );
}

/** A registry version the campaign ran, with the exact bytes of its files. */
export type BundleSource = { version: RegistryVersion; files: RegistryFile[] };

/**
 * One campaign as a bundle holds it: with the specs it ran and the registry versions it records, so
 * another store can run it again.
 */
export type CampaignBundle = {
  manifest: BundleManifest;
  campaign: Campaign;
  runs: RunResult[];
  specs: LoadedSpec[];
  sources: BundleSource[];
};

/**
 * Writes `<dir>/<campaignId>/campaign.json`, `runs/<runId>.json` and `manifest.json`, and returns
 * the folder. Records are pretty printed for review and diff. The old manifest goes first and the new
 * one comes last, so an interrupted export leaves a folder that `readCampaignBundle` refuses.
 */
export async function writeCampaignBundle(
  dir: string,
  campaign: Campaign,
  runs: readonly RunResult[],
  carried: { specs?: readonly LoadedSpec[]; sources?: readonly BundleSource[] } = {},
): Promise<string> {
  runs = runs.map((run) =>
    applyRealizedTextPolicy(run, campaign.provenance?.realizedText === true, {
      fromRun: run.runId,
      fromCampaign: campaign.campaignId,
    }),
  );
  const specs = carried.specs ?? [];
  const sources = carried.sources ?? [];
  const folder = resolve(dir, fileName(campaign.campaignId));
  const names = new Map<string, string>();
  for (const run of runs) {
    const name = `${fileName(run.runId)}.json`;
    const clash = names.get(name.toLowerCase());
    if (clash !== undefined) {
      throw new StoreError(
        'BUNDLE_INVALID',
        `runs ${clash} and ${run.runId} would share one file name on a case-insensitive disk`,
      );
    }
    names.set(name.toLowerCase(), run.runId);
  }

  await mkdir(join(folder, RUNS), { recursive: true });
  await rm(join(folder, MANIFEST), { force: true });
  await writeJson(join(folder, CAMPAIGN), campaign);
  for (const run of runs) await writeJson(join(folder, RUNS, `${fileName(run.runId)}.json`), run);
  for (const spec of specs) {
    await mkdir(join(folder, SPECS), { recursive: true });
    const objects = recordedObjectsOfSpec(spec.spec);
    const record = {
      id: spec.spec.id,
      hash: spec.hash,
      path: spec.path,
      spec: spec.spec,
      ...(objects === undefined ? {} : { objects }),
    };
    await writeJson(join(folder, SPECS, `${fileName(spec.spec.id)}@${spec.hash}.json`), record);
  }
  for (const { version, files } of sources) {
    const home = join(folder, SOURCES, version.kind, `${fileName(version.name)}@${version.version}`);
    await mkdir(home, { recursive: true });
    await writeJson(join(home, VERSION), version);
    for (const file of files) {
      const path = join(home, FILES, ...file.path.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.bytes);
    }
  }
  const counts: BundleManifest['counts'] = {
    runs: runs.length,
    blocks: runs.reduce((total, run) => total + run.blocks.length, 0),
  };
  if (specs.length > 0) counts.specs = specs.length;
  if (sources.length > 0) counts.sources = sources.length;
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    campaignId: campaign.campaignId,
    counts,
    hashes: Object.fromEntries([
      [CAMPAIGN, recordHash(campaign)],
      ...runs.map((run) => [`${RUNS}/${fileName(run.runId)}.json`, recordHash(run)] as const),
    ]),
  };
  await writeJson(join(folder, MANIFEST), manifest);
  return folder;
}

/**
 * Reads a folder `exportCampaign` wrote, validating the manifest, the campaign and every run with
 * their schemas, and checking the counts against the manifest. Any gap raises `BUNDLE_INVALID`.
 */
export async function readCampaignBundle(folder: string): Promise<CampaignBundle> {
  const manifest = checkManifest(await readJson(join(folder, MANIFEST), folder), folder);

  const campaign = Campaign.safeParse(await readJson(join(folder, CAMPAIGN), folder));
  if (!campaign.success) {
    throw invalid(
      folder,
      `${CAMPAIGN} does not match the Campaign schema: ${describeIssues(campaign.error.issues)}`,
    );
  }
  if (campaign.data.campaignId !== manifest.campaignId) {
    throw invalid(
      folder,
      `${CAMPAIGN} holds campaign ${campaign.data.campaignId}, the manifest names ${manifest.campaignId}`,
    );
  }

  const expect = (path: string, value: unknown) => {
    const want = manifest.hashes?.[path];
    if (want !== undefined && want !== recordHash(value)) {
      throw invalid(
        folder,
        `${path} does not match the hash its manifest records: it changed after the export`,
      );
    }
  };
  expect(CAMPAIGN, campaign.data);

  const files = (await listJsonFiles(join(folder, RUNS))).sort();
  const runs: RunResult[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const parsed = RunResult.safeParse(await readJson(join(folder, RUNS, file), folder));
    if (!parsed.success) {
      throw invalid(
        folder,
        `${RUNS}/${file} does not match the RunResult schema: ${describeIssues(parsed.error.issues)}`,
      );
    }
    if (seen.has(parsed.data.runId)) throw invalid(folder, `run ${parsed.data.runId} appears in two files`);
    expect(`${RUNS}/${file}`, parsed.data);
    seen.add(parsed.data.runId);
    runs.push(parsed.data);
  }

  const blocks = runs.reduce((total, run) => total + run.blocks.length, 0);
  if (runs.length !== manifest.counts.runs || blocks !== manifest.counts.blocks) {
    throw invalid(
      folder,
      `it holds ${runs.length} runs and ${blocks} blocks, its manifest counts ${manifest.counts.runs} and ${manifest.counts.blocks}; export into an empty folder`,
    );
  }
  const specs = await readSpecs(folder);
  const sources = await readSources(folder);
  if (specs.length !== (manifest.counts.specs ?? 0) || sources.length !== (manifest.counts.sources ?? 0)) {
    throw invalid(
      folder,
      `it holds ${specs.length} specs and ${sources.length} sources, its manifest counts ${manifest.counts.specs ?? 0} and ${manifest.counts.sources ?? 0}`,
    );
  }
  return { manifest, campaign: campaign.data, runs, specs, sources };
}

async function readSpecs(folder: string): Promise<LoadedSpec[]> {
  const specs: LoadedSpec[] = [];
  for (const file of (await listJsonFiles(join(folder, SPECS))).sort()) {
    const record = (await readJson(join(folder, SPECS, file), folder)) as Record<string, unknown> | null;
    const path = typeof record?.path === 'string' ? record.path : '';
    const loaded = validateSpec(record?.spec, path, { resolveObjects: false });
    if (!loaded.ok || path === '' || loaded.hash !== record?.hash) {
      throw invalid(folder, `${SPECS}/${file} does not hold a valid spec with its hash`);
    }
    const objects = record?.objects;
    if (objects !== undefined && !isSpecObjectIdentities(objects)) {
      throw invalid(folder, `${SPECS}/${file} holds invalid object identities`);
    }
    specs.push(bindStoredSpec(loaded, objects));
  }
  return specs;
}

async function readSources(folder: string): Promise<BundleSource[]> {
  const sources: BundleSource[] = [];
  for (const kind of await listFolders(join(folder, SOURCES))) {
    for (const name of await listFolders(join(folder, SOURCES, kind))) {
      const home = join(folder, SOURCES, kind, name);
      const where = `${SOURCES}/${kind}/${name}`;
      const version = await readJson(join(home, VERSION), folder);
      if (!isVersionRecord(version) || version.kind !== kind || versionHash(version.files) !== version.hash) {
        throw invalid(folder, `${where}/${VERSION} is not a version record that matches its hash`);
      }
      const files: RegistryFile[] = [];
      // Checked before any read: a path with .. or a leading / would read, and store, a file outside it.
      const escaping = version.files.find((entry) => !isVersionPath(entry.path));
      if (escaping) {
        throw invalid(
          folder,
          `${where}/${VERSION} names the file path "${escaping.path}", which leaves the version`,
        );
      }
      for (const entry of version.files) {
        const bytes = new Uint8Array(
          await readFile(join(home, FILES, ...entry.path.split('/'))).catch((cause: unknown) => {
            throw invalid(
              folder,
              `cannot read ${where}/${FILES}/${entry.path}: ${describeCause(cause)}`,
              cause,
            );
          }),
        );
        if (sha256(bytes) !== entry.sha256) {
          throw invalid(folder, `${where}/${FILES}/${entry.path} does not hash to ${entry.sha256}`);
        }
        files.push({ path: entry.path, bytes });
      }
      sources.push({ version, files });
    }
  }
  return sources;
}

async function listFolders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
}

function checkManifest(value: unknown, folder: string): BundleManifest {
  const manifest = (value ?? {}) as Partial<Record<keyof BundleManifest, unknown>>;
  if (manifest.format !== BUNDLE_FORMAT) {
    throw invalid(folder, `${MANIFEST} is not a ${BUNDLE_FORMAT} manifest`);
  }
  const version = manifest.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw invalid(folder, `${MANIFEST} has no schema version`);
  }
  if (version > SCHEMA_VERSION) {
    throw new StoreError(
      'SCHEMA_VERSION',
      `the bundle at ${folder} has schema version ${version}; this version of driftbench reads ${SCHEMA_VERSION} and older`,
    );
  }
  const counts = (manifest.counts ?? {}) as Record<string, unknown>;
  if (
    typeof manifest.campaignId !== 'string' ||
    manifest.campaignId === '' ||
    !isCount(counts.runs) ||
    !isCount(counts.blocks)
  ) {
    throw invalid(folder, `${MANIFEST} needs a campaignId and whole counts of runs and blocks`);
  }
  for (const key of ['specs', 'sources']) {
    if (counts[key] !== undefined && !isCount(counts[key])) {
      throw invalid(folder, `${MANIFEST} counts ${key} with something that is not a whole number`);
    }
  }
  return {
    format: BUNDLE_FORMAT,
    schemaVersion: version,
    campaignId: manifest.campaignId,
    counts: {
      runs: counts.runs,
      blocks: counts.blocks,
      ...(isCount(counts.specs) ? { specs: counts.specs } : {}),
      ...(isCount(counts.sources) ? { sources: counts.sources } : {}),
    },
    ...(isHashes(manifest.hashes) ? { hashes: manifest.hashes } : {}),
  };
}

/**
 * An id as a file name: percent-encoded like a URI component, plus `*` and a leading dot, so no id
 * can name a parent folder, a hidden file or a path.
 */
function fileName(id: string): string {
  return encodeURIComponent(id).replace(/\*/g, '%2A').replace(/^\./, '%2E');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(path: string, folder: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw invalid(folder, `cannot read ${relative(folder, path)}: ${describeCause(cause)}`, cause);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw invalid(folder, `${relative(folder, path)} is not JSON: ${describeCause(cause)}`, cause);
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function invalid(folder: string, message: string, cause?: unknown): StoreError {
  return new StoreError(
    'BUNDLE_INVALID',
    `the bundle at ${folder} is invalid: ${message}`,
    cause === undefined ? undefined : { cause },
  );
}
