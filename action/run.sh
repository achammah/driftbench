#!/usr/bin/env bash
# The body of the driftbench ci composite action. It reads its inputs from INPUT_* variables, runs
# `driftbench ci`, writes the verdict and the report path to $GITHUB_OUTPUT and exits with the CLI's code:
# 0 parity, 1 regression, gating flag, failing aggregate or incomplete run, 2 bad input, 3 blocks not run.
set -uo pipefail

: "${INPUT_SPECS:?the specs input is required}"
: "${INPUT_TARGET:?the target input is required}"
: "${INPUT_BASELINE:?the baseline input is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set: run this inside a GitHub Actions step}"

store="${INPUT_STORE:-.driftbench/ci.db}"
report="${INPUT_REPORT_PATH:-driftbench-ci.json}"

read -r -a cli <<< "${INPUT_DRIFTBENCH:-pnpm -s driftbench}"
args=(
  ci
  --specs "$INPUT_SPECS"
  --target "$INPUT_TARGET"
  --baseline "$INPUT_BASELINE"
  --store "$store"
  --margin "${INPUT_MARGIN:-auto}"
  --min-goldens "${INPUT_MIN_GOLDENS:-30}"
  --repeats "${INPUT_REPEATS:-1}"
  --mode "${INPUT_MODE:-F}"
  --out "$report"
)
if [ -n "${INPUT_BUDGET_USD:-}" ]; then args+=(--budget-usd "$INPUT_BUDGET_USD"); fi
if [ -n "${INPUT_FAULTS:-}" ]; then args+=(--faults "$INPUT_FAULTS"); fi
if [ "${INPUT_STRICT:-false}" = "true" ]; then args+=(--strict); fi
if [ -n "${INPUT_PROCESS_COMMAND:-}" ]; then args+=(--process-command "$INPUT_PROCESS_COMMAND"); fi
if [ -n "${INPUT_CHANGE:-}" ]; then args+=(--change "$INPUT_CHANGE"); fi
if [ -n "${INPUT_AGENT_VERSION:-}" ]; then args+=(--agent-version "$INPUT_AGENT_VERSION"); fi
if [ -n "${INPUT_AUDIT:-}" ]; then args+=(--audit "$INPUT_AUDIT"); fi
if [ -n "${INPUT_MAX_NOT_RUN:-}" ]; then args+=(--max-not-run "$INPUT_MAX_NOT_RUN"); fi
while IFS= read -r line; do
  if [ -n "$line" ]; then args+=(--aggregate "$line"); fi
done <<< "${INPUT_AGGREGATE:-}"
while IFS= read -r line; do
  if [ -n "$line" ]; then args+=(--route "$line"); fi
done <<< "${INPUT_ROUTE:-}"

code=0
"${cli[@]}" "${args[@]}" || code=$?

verdict=input-error
if [ "$code" -ne 2 ] && [ -f "$report" ]; then
  verdict=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).verdict))' "$report")
  node_code=$?
  if [ "$node_code" -ne 0 ]; then
    echo "driftbench ci action: cannot read the verdict from $report (exit $node_code)" >&2
    exit "$node_code"
  fi
fi

{
  echo "verdict=$verdict"
  echo "report-path=$report"
} >> "$GITHUB_OUTPUT"

if [ "$code" -ne 2 ] && [ -f "$report" ]; then
  node -e '
    const fs = require("node:fs");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const margin = s.marginAuto ? `auto, limited by ${s.marginAuto.limitedBy}` : "given";
    const lines = [`Margin ${s.marginPoints} points (${margin}).`];
    for (const u of s.underpowered ?? []) {
      lines.push(`Underpowered: ${u.criterion} is decided on ${u.goldens} goldens and is left out of the parity test.`);
    }
    if (s.radius) {
      const total = s.radius.blocks.sent + s.radius.blocks.carried;
      lines.push(`Blast radius: ${s.radius.fresh} cells fresh, ${s.radius.carried} carried from ${s.radius.from}; ${s.radius.blocks.sent} of ${total} blocks sent.`);
      if (s.radius.audit) lines.push(`Audit: ${s.radius.audit.sampled} cells, ${s.radius.audit.misses} misses.`);
    }
    for (const n of s.notRun?.specs ?? []) {
      const over = s.notRun.over.includes(n.specId) ? ", over the threshold" : "";
      lines.push(`Not run: ${n.specId}, ${n.notRun} of ${n.blocks} blocks${over} (${n.first}).`);
    }
    for (const a of s.aggregates ?? []) {
      const state = a.passed === undefined ? "no runs" : a.passed ? "passes" : "fails";
      const planned = a.decided !== false || a.runsNeeded === undefined ? ""
        : a.goldensNeeded !== undefined ? `, undecided: ${a.goldensNeeded} goldens like these (${a.runsNeeded} runs) would decide it`
        : `, undecided: ${a.runsNeeded} runs at this rate would decide it`;
      lines.push(`Aggregate ${a.name} ${state}${planned}.`);
    }
    console.log(lines.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.map((line) => `- ${line}`).join("\n") + "\n");
    }
  ' "$report" || true
fi
echo "driftbench ci: verdict $verdict, exit $code, summary $report"
exit "$code"
