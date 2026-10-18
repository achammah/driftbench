import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Identity of the statistics bank, not the product being improved by the pilot. Hash relative names and
 * bytes in sorted order, including item source, fixture inputs and the shared scoring frame. Deliberately
 * exclude product source, tests, journals, gate bars and audit reports: those change during the pilot.
 * A missing source/fixture tree is an error, never evidence that an old journal describes the live bank.
 */
export function statsBankHash(root: string): string {
  const files: string[] = [];
  const visit = (relative: string, keep: (name: string) => boolean): void => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path, keep);
      else if (entry.isFile() && keep(entry.name)) files.push(path);
      else if (entry.isSymbolicLink()) throw new Error(`bank fingerprint refuses a symlink: ${path}`);
    }
  };
  visit('packages/validators/src/ladders/stats', (name) => name.endsWith('.ts'));
  visit('packages/validators/fixtures/stats', (name) => name.endsWith('.json'));
  visit('packages/stats/test/reference', (name) => name.endsWith('.json'));
  files.push(...['bank.ts', 'ladder.ts', 'seeds.ts'].map((name) => `packages/validators/src/${name}`));
  const hash = createHash('sha256').update('driftbench-stats-bank-v1\0');
  for (const path of files.sort()) {
    const bytes = readFileSync(join(root, path));
    hash
      .update(JSON.stringify([path, bytes.length]))
      .update('\0')
      .update(bytes);
  }
  return hash.digest('hex');
}
