import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { operationWitnesses } from '../../src/ladders/estate/operation-witnesses';
import { currentOperationSource, OPERATIONS_FIXTURE } from './operation-vocabulary';

describe('estate completion operation records', () => {
  it('pins the current product source without deriving a word recognizer', () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const records = JSON.parse(readFileSync(`${root}${OPERATIONS_FIXTURE}`, 'utf8'));
    expect(records.source).toEqual(currentOperationSource(root));
    expect(Object.keys(records).sort()).toEqual(['benign', 'gaps', 'harmful', 'source']);
  });

  it('preserves every baseline witness id, class, input and control condition', () => {
    const records = operationWitnesses();
    expect(records.harmful).toHaveLength(288);
    expect(records.benign).toHaveLength(654);
    expect(records.gaps).toEqual([]);
    expect(createHash('sha256').update(JSON.stringify(records)).digest('hex')).toBe(
      'df92e30ea03c38139fc11a89ddef976fcb18563e125bd7ce91ff179bc4f8c62d',
    );
    const ids = [...records.harmful, ...records.benign].map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not let a caller mutate the frozen witness records', () => {
    const first = operationWitnesses();
    first.harmful.splice(0);
    first.benign.splice(0);
    expect(operationWitnesses().harmful).toHaveLength(288);
    expect(operationWitnesses().benign).toHaveLength(654);
  });
});
