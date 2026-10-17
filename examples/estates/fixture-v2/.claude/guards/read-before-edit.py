#!/usr/bin/env python3
"""Blocks an Edit or a Write on a file the session has not read. Enforces: R3, R5"""
import json
import os
import sys

# The runtime sends the session's transcript path, not the files read: the reads are the Read calls in it.
event = json.load(sys.stdin)
cwd = event.get("cwd") or os.getcwd()
path = event.get("tool_input", {}).get("file_path", "")


def absolute(value):
    return os.path.realpath(os.path.join(cwd, value))


read = set()
try:
    with open(event.get("transcript_path", ""), encoding="utf-8") as transcript:
        for line in transcript:
            try:
                record = json.loads(line)
            except ValueError:
                continue
            content = (record.get("message") or {}).get("content")
            for block in content if isinstance(content, list) else []:
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "Read":
                    read.add(absolute((block.get("input") or {}).get("file_path", "")))
except OSError:
    pass

# A new file has nothing to read first.
if path and os.path.exists(absolute(path)) and absolute(path) not in read:
    print("Read a file before you edit it.", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
