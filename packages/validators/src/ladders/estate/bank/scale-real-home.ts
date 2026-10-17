import { mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeEstate } from '../pipeline';
import type { RealHome } from './scale-real-estate';

/**
 * The planted user-level skill layer of a real-size estate, written to a home folder of its own. The layer is
 * opt-in for the reader: it reads a user skill folder only when it is named, so the validator names it the way a
 * user passes `--user-skills`, and never lets the reader find it through the platform's home.
 */

/** Writes the planted home, then its links: `project:` targets lead into the estate at `root`, the others into the home. */
export async function plantHome(home: RealHome, root: string): Promise<string> {
  const folder = await writeEstate(home.files);
  for (const link of home.links) {
    const target = link.target.startsWith('project:')
      ? join(root, link.target.slice(8))
      : join(folder, link.target);
    await mkdir(dirname(join(folder, link.path)), { recursive: true });
    await symlink(target, join(folder, link.path));
  }
  return folder;
}

/** The folder of the user-level skill layer inside a planted home. */
export function userSkillsFolder(home: string): string {
  return join(home, '.claude', 'skills');
}
