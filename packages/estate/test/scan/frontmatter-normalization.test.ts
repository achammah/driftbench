import { describe, expect, it } from 'vitest';
import { readFrontmatter, tolerantFields } from '../../src/scan/text';

describe('frontmatter whitespace normalization', () => {
  it('reads invalid colon scalars with CRLF without losing sibling fields', () => {
    const lines = [
      '---',
      'name: parcels',
      'description: Use when: parcels arrive.',
      'tools: Read, Bash',
      '---',
      'Body',
    ];
    expect(readFrontmatter(lines.join('\r\n')).fields).toEqual(readFrontmatter(lines.join('\n')).fields);
    expect(readFrontmatter(lines.join('\r\n')).bodyLine).toBe(6);
    expect(tolerantFields(['name: parcels\r', 'description: Use when: parcels arrive.\r'])).toEqual({
      name: 'parcels',
      description: 'Use when: parcels arrive.',
    });
  });
  it('reads tabs used for list indentation while preserving tabs inside scalar content', () => {
    const text =
      '---\nname: parcels\ntools:\n\t- Read\n\t- Bash\nskills:\n\t- routing\nmessage: "left\\tright"\n---\nBody';
    expect(readFrontmatter(text).fields).toEqual({
      name: 'parcels',
      tools: ['Read', 'Bash'],
      skills: ['routing'],
      message: 'left\tright',
    });
  });
});
