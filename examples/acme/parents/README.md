# Parent blocks: Acme checkout

All names, prices and references are fictional. Run this deterministic function adapter from the repository root; it needs no key and makes no paid calls:

```sh
pnpm exec tsx examples/acme/parents/run.ts
pnpm exec tsx examples/acme/parents/run.ts --skip-confirmation
```

The first run passes six blocks. In the second, `recap` fails, `order` and `receipt` are blocked by that one cause, and `alternative` and `hours` still pass. `plans` runs once. Both branches read its actual `catalog.search` result in their history. The phone branch overrides its channel without changing the other branch.

The spec is [checkout.yaml](checkout.yaml); [run.ts](run.ts) is the fake agent and runner. See [Given, When, Then](../../../docs/concepts/given-when-then.md#parent-blocks) for inheritance and adapter snapshot behavior.
