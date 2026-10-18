# Variable store examples

Three worked examples of the [variable store](../../docs/variables.md), one for each kind of agent. Everything in them is invented for testing: the shop, the owner's words, the dates, the counts and the ledger ids. The quotes are copied from files of this repository, and the tests check each one.

| File | Agent | It quotes |
|---|---|---|
| [`acme.yaml`](acme.yaml) | the Acme sales assistant, a prompt | [`../acme/prompts/acme-sales.md`](../acme/prompts/acme-sales.md), [`../acme/inventory.yaml`](../acme/inventory.yaml), [`../acme/src/policy.ts`](../acme/src/policy.ts) |
| [`northwind.yaml`](northwind.yaml) | the Northwind operations assistant, an estate | [`../estates/fixture/CLAUDE.md`](../estates/fixture/CLAUDE.md) and two of its skills |
| [`tidewater.yaml`](tidewater.yaml) | the Tidewater Cycles booking assistant, a prompt with one tab per channel | [`tidewater-prompt.md`](tidewater-prompt.md), written for this example |

A quote path is relative to the folder of the store file. The conversations they count do not exist: each `set_hash` is the SHA-256 of a stand-in text, such as `tidewater-example-conversations`.

Check them:

```
pnpm vitest run packages/space/test/variables-examples.test.ts packages/generate/test/extract/variables.test.ts
```
