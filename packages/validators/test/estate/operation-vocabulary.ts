import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const OPERATIONS_SOURCE = 'packages/checks/src/support/operations.ts';
export const OPERATIONS_FIXTURE = 'packages/validators/fixtures/estate/operation-vocabulary.json';

/** Source identity binds the preclassified records to the implementation they cover.
 * This helper hashes bytes; it never learns words or classifies witness text. */
export function currentOperationSource(root: string) {
  return {
    path: OPERATIONS_SOURCE,
    sha256: createHash('sha256')
      .update(readFileSync(join(root, OPERATIONS_SOURCE)))
      .digest('hex'),
  };
}
