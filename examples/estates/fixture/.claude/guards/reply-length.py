#!/usr/bin/env python3
"""Nudges when the last reply is too long.

Verdict: deny
"""
import json
import sys

event = json.load(sys.stdin)
reply = event.get("last_assistant_message", "")
if len(reply) > 1200:
    print("Keep every reply under 1,200 characters unless the user asks for detail.", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
