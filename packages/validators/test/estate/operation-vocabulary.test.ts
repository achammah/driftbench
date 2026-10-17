import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { currentOperationVocabulary, OPERATIONS_FIXTURE } from './operation-vocabulary';

describe('estate completion operation vocabulary', () => {
  it('matches the vocabulary derived from the current product operations source', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    expect(JSON.parse(readFileSync(`${root}${OPERATIONS_FIXTURE}`, 'utf8'))).toEqual(
      currentOperationVocabulary(root),
    );
  });
});
