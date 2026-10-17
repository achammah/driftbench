import { describe, expect, it } from 'vitest';
import { scriptOf } from '../../src/index';
import { dispatcherFormCases } from './dispatcher-forms-corpus';

describe('script dispatch follows argument flow into executed files', () => {
  for (const row of dispatcherFormCases) {
    it(`${row.kind}: ${row.name}`, () => {
      const wrapper = '.claude/hooks/lib/entry.py';
      const command = ['python3', wrapper, ...row.args.map((argument) => JSON.stringify(argument))].join(' ');
      const files = new Set([wrapper, ...(row.target ? [`.claude/hooks/${row.target}`] : [])]);
      const result = scriptOf(command, files, new Map([[wrapper, row.source]]));
      if (row.target)
        expect(result).toEqual({
          script: `.claude/hooks/${row.target}`,
          anchored: false,
          dispatcher: wrapper,
        });
      else expect(result).toEqual({ script: wrapper, anchored: false });
    });
  }
});
