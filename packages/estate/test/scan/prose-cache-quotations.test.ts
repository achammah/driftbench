import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, FileProseCache, scanAtoms } from '../../src/index';
import { answer, estate } from '../support';

const QUOTE = 'Archive the signed form.';
/** A hand-written file whose last chunk repeats one sentence three times, so only the line tells them apart. */
function document(blankLinesAbove: number): string {
  const background = Array.from(
    { length: 12 },
    (_, index) => `Background paragraph ${index} describes the archive.`,
  ).join('\n\n');
  return `${'\n'.repeat(blankLinesAbove)}${background}\n\n## Handling\n\n${QUOTE}\n\nNote one.\n\n${QUOTE}\n\nNote two.\n\n${QUOTE}\n`;
}

/** A model that picks the given file lines for the repeated sentence in the chunk that holds it. */
const modelPicking = (lines: number[]) => ({
  family: 'test',
  model: 'offline',
  async complete(request: { user: string }) {
    return answer(
      request.user.split('\n')[0]!.slice(7),
      (request.user.includes(QUOTE) ? lines : []).map((line) => ({
        kind: 'instruction',
        title: `Archive at line ${line}`,
        quote: QUOTE,
        line,
        evidence: [{ type: 'custom', name: 'archived' }],
      })),
    );
  },
});

const scan = async (root: string, lines: number[], cache: FileProseCache) => {
  const raw = await new ClaudeCodeReader({ chunkCharacters: 400 }).read(root);
  const result = await scanAtoms(raw, { port: modelPicking(lines), cache });
  const chosen = result.builder.atoms
    .filter((atom) => atom.producedBy === 'model')
    .map((atom) => atom.provenance.startLine)
    .sort((a, b) => a - b);
  return { raw, result, chosen };
};

/** The chunk holding the repeats starts mid-file and its text does not change when the lines above it do. */
const repeatsChunkWasCached = (result: Awaited<ReturnType<typeof scanAtoms>>) =>
  result.chunks.filter((run) => run.cached).map((run) => run.chunk);

const occurrencesIn = (text: string) =>
  text.split('\n').flatMap((line, index) => (line === QUOTE ? [index + 1] : []));

describe('a cached answer keeps the occurrence the model chose', () => {
  it.each([
    ['down', 4, 9],
    ['up', 9, 4],
  ])('for identical quotations in a mid-file chunk that moves %s', async (_direction, before, after) => {
    const cache = new FileProseCache(await mkdtemp(join(tmpdir(), 'prose-cache-mid-')));
    const root = await estate({ 'CLAUDE.md': document(before) });
    const layout = await new ClaudeCodeReader({ chunkCharacters: 400 }).read(root);
    const occurrences = occurrencesIn(layout.files[0]!.text);
    expect(occurrences).toHaveLength(3);
    const chunk = layout.prose.find(
      (entry) => entry.startLine <= occurrences[0]! && occurrences[2]! <= entry.endLine,
    );
    expect(chunk?.startLine).toBeGreaterThan(1);

    const fresh = await scan(root, [occurrences[1]!], cache);
    expect(fresh.chosen).toEqual([occurrences[1]]);
    await writeFile(join(root, 'CLAUDE.md'), document(after));
    const cached = await scan(root, [], cache);
    expect(repeatsChunkWasCached(cached.result)).toEqual(['CLAUDE.md#2']);
    expect(cached.chosen).toEqual([occurrences[1]! + after - before]);
  });

  it('keeps two chosen repeats apart on a cache hit', async () => {
    const cache = new FileProseCache(await mkdtemp(join(tmpdir(), 'prose-cache-two-')));
    const root = await estate({ 'CLAUDE.md': document(0) });
    const layout = await new ClaudeCodeReader({ chunkCharacters: 400 }).read(root);
    const occurrences = occurrencesIn(layout.files[0]!.text);
    const picked = [occurrences[0]!, occurrences[2]!];
    expect((await scan(root, picked, cache)).chosen).toEqual(picked);
    await writeFile(join(root, 'CLAUDE.md'), document(5));
    const cached = await scan(root, [], cache);
    expect(repeatsChunkWasCached(cached.result)).toEqual(['CLAUDE.md#2']);
    expect(cached.chosen).toEqual(picked.map((line) => line + 5));
  });
});
