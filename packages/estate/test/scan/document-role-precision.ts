import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeReader, INFORMATION, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { roleEstateFiles } from './document-role-estate';

/** Independent truth belongs to this hand-written fixture, never to the validator bank. */
export async function documentRolePrecision() {
  const root = await estate(roleEstateFiles());
  try {
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const findings = lintEstate(map, raw).findings.filter((finding) => !INFORMATION.has(finding.code));
    const defects = findings.filter(
      (finding) =>
        finding.code === 'MISSING_REFERENCE' &&
        /references\/missing\.md|missing-live\/guide\.md|\/unlocated\.md/.test(finding.message),
    );
    const hazards = map.atoms.filter((atom) => atom.kind === 'hazard');
    const realHazards = hazards.filter(
      (atom) => atom.provenance.file === '.claude/skills/editor/SKILL.md' && atom.provenance.startLine === 7,
    );
    return {
      lint: {
        truePositive: defects.length,
        reported: findings.length,
        precision: findings.length ? defects.length / findings.length : null,
      },
      hazards: {
        truePositive: realHazards.length,
        reported: hazards.length,
        precision: hazards.length ? realHazards.length / hazards.length : null,
      },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await documentRolePrecision(), null, 2));
