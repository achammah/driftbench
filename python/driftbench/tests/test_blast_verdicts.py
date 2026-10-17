"""Blast-radius audit of the not_run and blocked verdicts (PR 428) in the Python client: the JSON of
`campaign run --json` with a cell not run and a cell blocked."""

import json

from driftbench import CampaignResult
from driftbench.pytest_plugin import describe

from conftest import FIXTURES

NOT_RUN = {
    "kind": "unsupported",
    "layer": "5 world",
    "check": "capability",
    "expected": "the adapter applies forced tool results (lookup) (toolStubs)",
    "got": "process declares toolStubs false: the agent would never see it",
}


def report():
    """The fixture report with two cells, one not run and one blocked, as the CLI of PR 428 prints them."""
    doc = json.loads((FIXTURES / "report.json").read_text())
    [cell] = doc["cells"]
    passing = dict(cell["blocks"][0])
    not_run = {
        **cell,
        "cellId": "c-not-run",
        "state": "not_run",
        "failing": ["block 1 not_run capability"],
        "blocks": [passing, {"index": 1, "pass": False, "status": "not_run", "notRun": NOT_RUN, "verdicts": []}],
    }
    blocked = {
        **cell,
        "cellId": "c-blocked",
        "repeat": 1,
        "state": "blocked",
        "failing": ["block 1 blocked by block 0"],
        "blocks": [
            passing,
            {"index": 1, "pass": False, "status": "blocked", "blocked": {"by": "block 0", "root": "block 0"}, "verdicts": []},
        ],
    }
    doc["cells"] = [not_run, blocked]
    doc["summary"] = {"cells": 2, "pass": 0, "fail": 0, "notRun": 1, "blocked": 1, "failed": 0}
    return doc


def test_the_new_states_parse_and_never_pass():
    result = CampaignResult.from_json(report(), exit_code=1)
    assert [cell.state for cell in result.cells] == ["not_run", "blocked"]
    assert not any(cell.passed for cell in result.cells)
    assert not result.passed
    assert [block.passed for block in result.cells[0].blocks] == [True, False]
    # A block not run holds no verdict: nothing is listed as failing.
    assert result.cells[0].blocks[1].failing == ()


def test_the_summary_counts_add_up_to_the_cells():
    summary = CampaignResult.from_json(report(), exit_code=1).summary
    counted = (
        summary.passed
        + summary.failed_checks
        + summary.failed
        + summary.stopped_by_budget
        + summary.pending
        + getattr(summary, "not_run", 0)
        + getattr(summary, "blocked", 0)
    )
    assert counted == summary.cells


def test_the_plugin_names_a_block_not_run_and_why():
    text = describe(CampaignResult.from_json(report(), exit_code=1))
    assert "block 1 failed" not in text
    assert "not run" in text
    assert "toolStubs" in text
