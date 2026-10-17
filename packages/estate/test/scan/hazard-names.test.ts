import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function hazards(text: string) {
  const root = await estate({ 'CLAUDE.md': text });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms.filter((a) => a.kind === 'hazard').map((a) => a.fields?.hazard);
}

describe('runtime event names', () => {
  it.each([
    ['If the service answers 429, wait before retrying.', 'rate_wave'],
    ['An HTTP 429 response pauses the queue.', 'rate_wave'],
    ['If the machine reboots, reopen the task.', 'restart'],
    ['When the session is resumed, read the saved state.', 'session_boundary'],
    ['When we resume the session, read the saved state.', 'session_boundary'],
    ['A 429 error means the queue must wait.', 'rate_wave'],
    ['On Too Many Requests, back off.', 'rate_wave'],
    ['When a hook nudges the agent twice, stop and report.', 'nudge_storm'],
    ['After three nudges the guard blocks the call.', 'nudge_storm'],
  ])('reads %s', async (text, expected) => expect(await hazards(text)).toEqual([expected]));
  it.each([
    'Invoice 429 requires a receipt.',
    'Nudge the price up by one percent.',
    'Nudge the delivery date down a day if the client agrees.',
    'The printer reboots after maintenance.',
    'Resume the session of the training course.',
  ])('keeps domain work out: %s', async (text) => expect(await hazards(text)).toEqual([]));
});
