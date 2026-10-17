---
name: shipment-tracker
description: Look up where a shipment is and whether it is late. Use when the user asks about a delivery, a tracking number or a late shipment.
allowed-tools: Read, Bash(./scripts/track.sh *)
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: "$CLAUDE_PROJECT_DIR/.claude/skills/shipment-tracker/scripts/check-carrier.sh"
---

# Shipment tracker

- Ask for the tracking number when the user gives none.
- Always pass the carrier code to track.sh, as in `./scripts/track.sh NWX 123`.
- A shipment is late when its promised date is past and no delivery scan exists.
- When the carrier answers with an error, say so and give the carrier's own tracking page; never guess a status.

The local carrier table is `data/shipments.txt`.
