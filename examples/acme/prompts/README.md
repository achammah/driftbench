# Acme prompt sections

`acme-sales.md` is the system prompt of the live Acme sales stand-in the block redesign research ran on
(research/block-links, experiments H5 and H7): 30 sections, 4 of them global. The deterministic Acme agent in
`../src` follows the same rules in code. `acme-sales.sections.yaml` is its section registry: stable section
ids, UTF-16 spans, hashes, anchors, scope and the `references` edges between sections.

`linked/` holds three small specs whose blocks link to those sections in `metadata.links`. They show the
link format, `spec lint --sections` and the advisory section selection of `radius --sections`.

```sh
pnpm driftbench radius sections check examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md
pnpm driftbench spec lint examples/acme/prompts/linked --sections examples/acme/prompts/acme-sales.sections.yaml
```

See `driftbench help authoring-prompt-sections`.
