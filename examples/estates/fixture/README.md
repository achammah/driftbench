# Fixture estate: the Northwind ops assistant

A small Claude Code estate written by hand for the estate scanner's tests. Northwind Traders, its suppliers
and its rules are invented. Nothing here comes from a real estate.

What it holds:

- `CLAUDE.md`: 17 numbered rules, a routing table, a process paragraph and output rules.
- `.claude/memory/`: two memory files.
- `.claude/skills/`: four skills. `invoice-reconcile` has references and a script; `shipment-tracker` has
  its own guard in its frontmatter; `supplier-email` is prose only; `weekly-report` names a template and a
  reference that does not exist.
- `.claude/agents/`: three helper agents with frontmatter.
- `.claude/settings.json`: a model, permissions (allow, deny, ask), environment keys and guards on four
  events.
- `.claude/guards/`: five guard scripts and a check registry.
- `.claude/steps.json`: the step list (plan, do, verify, report, and a note step allowed at any time).
- `driftbench.estate.yaml`: the estate configuration the unit runner reads. It declares a local stand-in
  executor for each helper agent (a command that follows the instructions of the helper's current body on the
  task and reports what it did to the workspace) and, for the two scripts, the usage line and fixtures with
  their expected exit codes and outputs, written from the script's public contract and not from its source.

Findings planted on purpose, so the lint has something to find:

- `references/old-tolerances.md` is named by nothing: an orphan.
- `weekly-report` names `references/kpi-definitions.md`, which does not exist.
- the `inbox-triager` agent is in no routing table and no skill dispatches it: unreachable from the
  standing instructions.
- the `ledger-guard.py` guard is called by a relative path, not anchored on the project folder.
- `reply-length.py` has no row in the check registry, and the registry's row G6 names a guard that does not
  exist.

The scan of this estate, with the recorded answers in `answers.yaml`, is `map.yaml`; the approved map is
`approved.yaml` and its space map is `space.yaml`.
