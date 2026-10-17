import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelPort } from '@agent-nexus/driftbench-generate';
import { PROSE_SYSTEM_PROMPT, type ProseAnswer, parseProseAnswer } from './prose';
import type { ProseChunk } from './reader';
import { sha256 } from './text';

/** Private model answers, addressed by content and the extraction contract. Never commit this folder. */
export interface ProseCache {
  get(key: string): Promise<ProseAnswer | undefined>;
  put(key: string, answer: ProseAnswer): Promise<void>;
}
export class FileProseCache implements ProseCache {
  constructor(readonly directory: string) {}
  async get(key: string): Promise<ProseAnswer | undefined> {
    try {
      const parsed = parseProseAnswer('cached', await readFile(join(this.directory, `${key}.json`), 'utf8'));
      return parsed.ok ? parsed.answer : undefined;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw cause;
    }
  }
  async put(key: string, answer: ProseAnswer): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, `${key}.json`), JSON.stringify({ ...answer, chunk: 'cached' }), {
      mode: 0o600,
    });
  }
}
export function proseCacheKey(chunk: ProseChunk, port: ModelPort, maxTokens?: number): string {
  return sha256(
    JSON.stringify({
      version: 2,
      prompt: PROSE_SYSTEM_PROMPT,
      family: port.family,
      model: port.model,
      maxTokens,
      file: chunk.file,
      text: chunk.text,
      routing: chunk.ambiguousRouting?.map(({ targets, dispatch }) => ({ targets, dispatch })),
    }),
  );
}
export type ProseEstimate = {
  chunks: number;
  characters: number;
  cachedChunks: number;
  cachedCharacters: number;
  pendingChunks: number;
  pendingCharacters: number;
};
export function proseEstimateLine(estimate: ProseEstimate): string {
  return `Model pass estimate: ${estimate.pendingChunks} chunks, ${estimate.pendingCharacters} characters to send; ${estimate.cachedChunks} chunks, ${estimate.cachedCharacters} characters cached (${estimate.chunks} chunks, ${estimate.characters} characters total).\n`;
}
