import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  type CheckContext,
  type Expect,
  type evidence,
  type Observed,
  parseObjectText,
  type Spec,
  type Verdict,
} from '@agent-nexus/driftbench-core';

/**
 * The evidence inputs of a block's failing verdicts, joined from what the run stored and what the spec and the
 * estate map say: the trace, the verdicts, the user turn, the expected tools and skills, the atoms the spec
 * enforces (`metadata.estate.atoms`, read from the map `metadata.estate.map` names) and any stored confirm
 * evidence. No agent call and no model call.
 */

/** The estate map's atoms and edges, read structurally. */
export type EstateMapView = { atoms: evidence.RuleAtom[]; edges: evidence.RuleEdge[] };

const mapCache = new Map<string, EstateMapView>();

/** Reads an estate map file once per process. */
export function readEstateMap(path: string): EstateMapView {
  const known = mapCache.get(path);
  if (known) return known;
  const raw = parseObjectText(readFileSync(path, 'utf8'), path).raw as {
    atoms?: evidence.RuleAtom[];
    edges?: evidence.RuleEdge[];
  };
  const view = { atoms: raw.atoms ?? [], edges: raw.edges ?? [] };
  mapCache.set(path, view);
  return view;
}

/** The estate part of a spec's metadata, when the spec was generated from an estate. */
export function estateMetadata(spec: Pick<Spec, 'metadata'>): {
  atoms: string[];
  map?: string;
  situation?: string;
  planRows?: evidence.EvidenceInput['planRows'];
} {
  const estate = (
    spec.metadata as
      | {
          estate?: {
            atoms?: unknown;
            map?: unknown;
            situation?: unknown;
            planRow?: unknown;
            testType?: unknown;
          };
        }
      | undefined
  )?.estate;
  const atoms = Array.isArray(estate?.atoms) ? estate.atoms.map(String) : [];
  return {
    atoms,
    ...(typeof estate?.planRow === 'string' && typeof estate.testType === 'string'
      ? { planRows: [{ atomIds: atoms, testType: estate.testType }] }
      : {}),
    ...(typeof estate?.map === 'string' ? { map: estate.map } : {}),
    ...(typeof estate?.situation === 'string' ? { situation: estate.situation } : {}),
  };
}

/** The labels and names a block expects: tools in order, routed skills. */
export function expectView(expect: Expect | undefined): evidence.BlockExpect {
  const tools = (expect?.tools ?? []).filter((tool) => tool.count !== 0).map((tool) => tool.label);
  const skills = (expect?.skills ?? []).map((skill) => skill.name);
  return { ...(tools.length > 0 ? { tools } : {}), ...(skills.length > 0 ? { skills } : {}) };
}

export type BlockInputSource = {
  observed: Observed;
  verdicts: readonly Verdict[];
  expect?: Expect;
  /** The user turn the agent received. */
  user?: string;
  spec?: Pick<Spec, 'metadata'>;
  /** The spec file, to resolve a relative map path; else the map path resolves from the working folder. */
  specPath?: string;
  map?: EstateMapView;
  /** Confirm evidence stored for this block, by verdict id. */
  confirm?: Readonly<Record<string, evidence.ConfirmEvidence>>;
  planRows?: evidence.EvidenceInput['planRows'];
  extra?: Partial<evidence.EvidenceInput>;
};

/** The evidence input of one failing verdict of a stored block. */
export function blockEvidenceInputs(source: BlockInputSource): (verdict: Verdict) => evidence.EvidenceInput {
  const meta = source.spec === undefined ? { atoms: [] as string[] } : estateMetadata(source.spec);
  let map = source.map;
  if (map === undefined && meta.map !== undefined) {
    const path =
      source.specPath === undefined ? resolve(meta.map) : resolve(dirname(source.specPath), meta.map);
    if (existsSync(path)) map = readEstateMap(path);
  }
  const planRows = source.planRows ?? meta.planRows;
  const expect = expectView(source.expect);
  if (meta.situation !== undefined) expect.situation = meta.situation;
  return (verdict) => ({
    block: { observed: source.observed, verdicts: [...source.verdicts] },
    verdict,
    ...(source.user === undefined ? {} : { user: source.user }),
    expect,
    ...(meta.atoms.length > 0 ? { ruleAtoms: meta.atoms } : {}),
    ...(map === undefined ? {} : { atoms: map.atoms, edges: map.edges }),
    ...(source.confirm?.[verdict.id] === undefined ? {} : { confirm: source.confirm[verdict.id] }),
    ...(planRows === undefined ? {} : { planRows }),
    ...source.extra,
  });
}

/** The same, from the context the checks ran with. */
export function checkEvidenceInputs(
  ctx: Pick<CheckContext, 'observed' | 'expect' | 'spec' | 'block' | 'stimulus'>,
  verdicts: readonly Verdict[],
  extra: Omit<BlockInputSource, 'observed' | 'verdicts' | 'expect' | 'spec' | 'user'> = {},
): (verdict: Verdict) => evidence.EvidenceInput {
  const stimulus = ctx.stimulus ?? ctx.block.when;
  const user = typeof stimulus === 'string' ? stimulus : (stimulus as { user?: unknown } | undefined)?.user;
  return blockEvidenceInputs({
    ...extra,
    observed: ctx.observed,
    verdicts,
    expect: ctx.expect,
    spec: ctx.spec,
    ...(typeof user === 'string' ? { user } : {}),
  });
}
