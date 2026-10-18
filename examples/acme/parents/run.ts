import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { blockStatus, loadSpecFile, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

/** A deterministic fictional agent: the example and its regression test make no model calls. */
export async function runAcmeParents(skipConfirmation = false) {
  const loaded = await loadSpecFile(fileURLToPath(new URL('./checkout.yaml', import.meta.url)));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  const calls: string[] = [];
  const adapter = functionAdapter({
    deterministic: true,
    respond(history) {
      const user = history.at(-1)?.content ?? '';
      calls.push(user);
      const prior = history.flatMap((message) => message.tool_calls ?? []);
      const plan = prior.find((call) => call.label === 'catalog.search')?.output;
      let text = 'Acme opens at 09:00.';
      const toolCalls = [];
      if (user === 'Show Acme plans.') {
        text = 'Acme Basic costs 30 EUR per month.';
        toolCalls.push({
          id: 'plans-1',
          label: 'catalog.search',
          input: {},
          output: { plan: 'Basic', monthly: 30 },
        });
      } else if (user === 'I choose Basic.') {
        text = plan
          ? skipConfirmation
            ? 'Order placed.'
            : 'Basic: 30 EUR per month. Reply CONFIRM to order.'
          : 'Which plan?';
      } else if (user === 'CONFIRM') {
        text = plan ? 'Your order is ACME-42.' : 'Which plan?';
        if (plan)
          toolCalls.push({
            id: 'order-1',
            label: 'order.create',
            input: { plan: 'Basic' },
            output: { reference: 'ACME-42' },
          });
      } else if (user === 'My receipt, please.') {
        text = prior.some((call) => call.label === 'order.create') ? 'Receipt for ACME-42.' : 'No order yet.';
      } else if (user === 'Can I call Acme instead?') {
        text = 'Call Acme at +1 202 555 0142.';
      }
      return { segments: [], text, toolCalls, cost: {}, latencyMs: 0 };
    },
  });
  const run = await runSpec(loaded.spec, {
    adapter,
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode: 'T',
    repeat: 0,
  });
  return { run, calls };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { run } = await runAcmeParents(process.argv.includes('--skip-confirmation'));
  console.log(
    run.blocks
      .map(
        (block) =>
          `${block.blockId}: ${blockStatus(block)}${block.blocked ? ` (root: ${block.blocked.root})` : ''}`,
      )
      .join('\n'),
  );
}
