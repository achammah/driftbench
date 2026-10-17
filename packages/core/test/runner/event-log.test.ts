import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventLogSink, readEventLog } from '../../src/runner/event-log';

describe('the event log keeps every event written before an interruption', () => {
  it('each event is on disk as soon as it is reported, before the next one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'events-'));
    const path = join(dir, 'events.jsonl');
    const sink = eventLogSink(path);
    sink({ type: 'block_start', index: 0, at: 'a' });
    sink({ type: 'tool_call', index: 0, label: 'coverage.check', at: 'b' });
    // The run is killed here: nothing after this point is written.
    expect(readEventLog(path)).toEqual([
      { type: 'block_start', index: 0, at: 'a' },
      { type: 'tool_call', index: 0, label: 'coverage.check', at: 'b' },
    ]);
  });

  it('a line cut short by the interruption is skipped, the lines before it are kept', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'events-'));
    const path = join(dir, 'events.jsonl');
    await writeFile(path, '{"type":"block_start","index":0,"at":"a"}\n{"type":"block_end","ind');
    expect(readEventLog(path)).toEqual([{ type: 'block_start', index: 0, at: 'a' }]);
    expect(await readFile(path, 'utf8')).toContain('block_end');
  });
});

describe('the event log is part of the package surface', () => {
  it('core exports eventLogSink and readEventLog', async () => {
    const core = await import('../../src/index');
    expect(typeof core.eventLogSink).toBe('function');
    expect(typeof core.readEventLog).toBe('function');
  });
});
