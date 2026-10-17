import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lastUser, observed, type Seen } from '../../blocks/harness';

/**
 * A scripted agent behind a local HTTP endpoint that answers after a delay and keeps a log of its requests (when they
 * began and ended, how many were in flight), so an item can watch how the command line spreads cells over the agent.
 * It speaks the http adapter's JSON (docs/adapters/http.md); nothing leaves 127.0.0.1.
 */

export type Request = {
  body: string;
  user: string;
  history: number;
  startedAt: number;
  endedAt: number;
  inFlight: number;
};

export type SlowAgent = {
  url: string;
  requests: Request[];
  maxInFlight(): number;
  close(): Promise<void>;
};

export type Reply = {
  text: string;
  calls?: { label: string; input?: Record<string, unknown> }[];
  usd?: number;
  latencyMs?: number;
  /** The whole Observed to send, in place of the one built from `text` and `calls`. */
  raw?: Record<string, unknown>;
};

export async function startAgent(
  reply: (user: string, messages: Seen[]) => Reply,
  delayMs: (user: string) => number = () => 0,
): Promise<SlowAgent> {
  const requests: Request[] = [];
  let inFlight = 0;
  let peak = 0;
  const started = Date.now();
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      let user = '';
      let messages: Seen[] = [];
      try {
        const parsed = JSON.parse(body || '{}') as { messages?: Seen[] };
        messages = (parsed.messages ?? []).map((message) => ({ ...message, content: message.content ?? '' }));
        user = lastUser(messages);
      } catch {
        // an unreadable request is answered below as any other
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const entry: Request = {
        body,
        user,
        history: messages.length,
        startedAt: Date.now() - started,
        endedAt: 0,
        inFlight,
      };
      requests.push(entry);
      setTimeout(() => {
        try {
          const wanted = reply(user, messages);
          const out = observed(
            wanted.text,
            (wanted.calls ?? []).map((call) => ({ label: call.label, input: call.input ?? {} })),
          );
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify(
              wanted.raw ?? { ...out, cost: { usd: wanted.usd ?? 0 }, latencyMs: wanted.latencyMs ?? 0 },
            ),
          );
        } catch (cause) {
          response.writeHead(400, { 'content-type': 'text/plain' });
          response.end(cause instanceof Error ? cause.message : String(cause));
        } finally {
          entry.endedAt = Date.now() - started;
          inFlight -= 1;
        }
      }, delayMs(user));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/turn`,
    requests,
    maxInFlight: () => peak,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
