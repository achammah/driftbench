import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CatchList } from './bank';
import { loopFolder } from './journal';

/**
 * The pinned catch list of a validator (docs/validators.md section 12.4): `validators/<component>/catch.json`,
 * `{ "items": [{ "id": "...", "guards": "bug:B03" }] }`. `guards` names what the item guards: a planted bug
 * (`bug:`), a cheat channel (`cheat:`), a shortcut (`shortcut:`) or a scale budget (`budget:`), followed by its
 * name. The file is reviewed like any validator change; an item counts as catch only when it is listed here.
 */
export const CatchFileSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().min(1),
            guards: z.string().regex(/^(bug|cheat|shortcut|budget):[A-Za-z0-9._/#-]+$/),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.items.forEach((item, index) => {
      if (seen.has(item.id))
        ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: `${item.id} is listed twice` });
      seen.add(item.id);
    });
  });

export function catchFile(component: string): string {
  return `${loopFolder(component)}/catch.json`;
}

/** The pinned catch list of a validator, or undefined when it has none. Throws on a file that does not parse. */
export function readCatchList(root: string, component: string): CatchList | undefined {
  const path = join(root, catchFile(component));
  if (!existsSync(path)) return undefined;
  const parsed = CatchFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success)
    throw new Error(
      `${catchFile(component)}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return new Map(parsed.data.items.map((item) => [item.id, item.guards]));
}
