---
title: How to read help
summary: How the help is organised, how to find the topic for a task, and how each topic's sections are meant to be read.
commands:
  - help
see_also:
  - core-getting-started
  - core-global-options
next:
  - core-global-options
---

## What it is

driftbench has two kinds of help:

* Command usage, from `driftbench <command> --help`: the exact arguments and options of one command, with
  their defaults, generated from the command itself. It ends with the ids of the help topics about it.
* Help topics, from `driftbench help`: one page per capability, written for a reader with no other context.
  A topic says what the capability is, when to use it, every option, the files it reads and writes, how to
  read its output, an example that runs, and the errors you will meet.

## When to use it

* You do not know which command does what you need: `driftbench help`, then read the summaries.
* You know the command: `driftbench <command> --help` for the options, then the topic it names.
* A command failed: the topic's `Common errors` section lists the messages and what to do.

## Commands and every option

* `driftbench help`: the overview, then the index. The overview says what driftbench is, gives the mental
  model (map, tests, run, checks and judges, results), lists every command grouped by task, and says where
  to start. Topics are grouped by area: `core` (this area: install, options, configuration, layout, exit
  codes), `recipes` (one goal end to end, such as testing a chat agent or gating CI), `authoring` (writing and generating specs), `running` (campaigns and
  run modes), `judging` (judges and labels), `results` (reports, comparison, CI gating), `validate` (the
  validators that prove driftbench works), `redteam` (adversarial runs). Each line is a topic id and its
  one line summary.
* `driftbench help <topic>`: one topic. Give the full id, such as `core-exit-codes`, or the part after the
  area, `exit-codes`, when no other area uses it.
* `driftbench help <area>`: the topics of one area, such as `driftbench help recipes`.
* `driftbench help search <words>`: the topics that hold every word, case blind, ranked; each with its
  first matching line.
* `driftbench help --list`: every command and subcommand with its one line description and the topic about it.
* `driftbench help <command>`: the usage of a top-level command, like `driftbench <command> --help`.
* `driftbench <command> [<subcommand>] --help`: the usage of any command or subcommand.
* `driftbench --help`: every top-level command with one line each.

## Inputs

The topics are the files `help/<area>-<slug>.md` of the installed package. They are read when help runs.

## Outputs and how to read them

A topic prints its title and summary, the commands it covers (`Commands:`), then seven sections in a fixed
order (a recipe has five instead: Goal, Before you start, Steps, What you have at the end, When a step
fails):

1. What it is: the idea, in plain words.
2. When to use it: the situations it is for.
3. Commands and every option: each command, each option, its default.
4. Inputs: the files and variables it reads.
5. Outputs and how to read them: what it prints or writes, and what each part means.
6. Worked example: commands that run on the Acme example, with no model call, and what they print.
   Lines in `text` blocks show output; `...` marks lines left out. A line ending `# exit <n>` exits n.
7. Common errors: the messages you will see, and the fix for each.

It ends with `See also:`, the ids of related topics, and `Next:`, the topic to read after it. Following
`Next:` from `core-getting-started` walks the core topics, then every recipe.

In a usage, `<x>` is a required argument, `[x]` an optional one, `x...` one or more, and an option
repeated in the synopsis, such as `--target <t>...`, may be given several times.

## Worked example

```sh
driftbench help
driftbench help core-exit-codes
driftbench help exit-codes
driftbench help recipes
driftbench help search exit code
driftbench campaign status --help
driftbench help campaign
driftbench help no-such-topic # exit 2
```

```text
driftbench: test an AI agent the way you unit test code
...
Help topics

Print a topic: driftbench help <topic>. Search them: driftbench help search <word>.
Every command with one line: driftbench help --list. One command: driftbench <command> --help.

core
  core-configuration    The project config driftbench.yaml and its six keys, ...
  core-exit-codes       What each driftbench exit code means, ...
...
driftbench: no help topic or command named "no-such-topic". List the topics: driftbench help. Search them: driftbench help search no-such-topic
```

## Common errors

* `no help topic or command named "<name>"` (exit 2): run `driftbench help` and copy an id from the index.
  Close ids are suggested when the name is part of one.
* `driftbench help campaign run` prints the usage of `campaign`, not of `run`: for a subcommand use
  `driftbench campaign run --help`.
* A topic shown as `(broken topic: ...)` in the index has a front matter error: report it; its text still
  prints.
