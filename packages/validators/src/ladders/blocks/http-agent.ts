import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Behaviour, lastUser, type Seen } from './harness';

/**
 * A scripted agent behind a local HTTP endpoint that speaks the http adapter's JSON (docs/adapters/http.md):
 * the command line reaches it from a spec's `target.options`, so an item can run `driftbench campaign run`
 * on a fictional agent with no key and no network beyond 127.0.0.1.
 */
export type HttpAgent = { url: string; close(): Promise<void> };

export async function startHttpAgent(behave: Behaviour): Promise<HttpAgent> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}') as {
          messages?: Seen[];
          world?: Record<string, unknown>;
          vars?: Record<string, unknown>;
        };
        const messages = (parsed.messages ?? []).map((message) => ({
          ...message,
          content: message.content ?? '',
        }));
        const reply = behave({
          messages,
          world: parsed.world ?? {},
          vars: parsed.vars ?? {},
          user: lastUser(messages),
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(reply));
      } catch (cause) {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end(cause instanceof Error ? cause.message : String(cause));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/turn`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
