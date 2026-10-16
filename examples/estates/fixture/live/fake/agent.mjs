/**
 * The fake's default agent: a stream derived by code from the estate it
 * is given, nothing else. It reads the copy in its working folder (the standing file, the skills, the helpers,
 * the settings and the step list), routes the ask by the words it shares with a routing row or a unit's
 * description, and does what the unit and the estate say: load the skill, read the files its body names,
 * dispatch the helpers it names, run the command its body names and the command the ask spells out, read a
 * file before editing it when a standing rule says so, edit the file the ask names, walk the step list, and run every hook the settings
 * declare on each of its tool calls. This deterministic stand-in implements a limited instruction syntax;
 * it is not a model or a complete Claude Code simulator. It knows nothing of any test, plan row or mutant:
 * what changes its stream is only what the copy says. No model, no cost, fictional data only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, matchesGlob, relative, resolve } from 'node:path';

const STOP = new Set(
  'the and for with that this from into your you are can what which when where who how please just tell give make sure about them they their there here have has had will would could should than then also only each every some any one two all not but our its it'.split(
    ' ',
  ),
);

const words = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP.has(word))
      // One stem for a word and its plural or third person: sort, sorts.
      .map((word) => (word.length > 4 ? word.replace(/(?:es|s)$/, '') : word)),
  );

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

/** A frontmatter's top-level scalar fields and the body after it. */
function frontmatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return { fields: {}, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return { fields: {}, body: text };
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function readEstate(cwd) {
  const standing = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']
    .map((path) => read(join(cwd, path)) ?? '')
    .join('\n');
  const skills = [];
  const skillsDir = join(cwd, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    for (const folder of readdirSync(skillsDir).sort()) {
      const text = read(join(skillsDir, folder, 'SKILL.md'));
      if (text === undefined) continue;
      const { fields, body } = frontmatter(text);
      skills.push({
        kind: 'skill',
        name: folder,
        folder: `.claude/skills/${folder}`,
        description: fields.description ?? '',
        tools: fields['allowed-tools'],
        body,
      });
    }
  }
  const helpers = [];
  const agentsDir = join(cwd, '.claude', 'agents');
  if (existsSync(agentsDir)) {
    for (const file of readdirSync(agentsDir).sort()) {
      if (!file.endsWith('.md')) continue;
      const { fields, body } = frontmatter(read(join(agentsDir, file)) ?? '');
      // Project helper files require both fields; unnamed files are adjacent documentation.
      if (!fields.name || !fields.description) continue;
      helpers.push({
        kind: 'helper',
        name: fields.name,
        description: fields.description,
        tools: fields.tools,
        body,
      });
    }
  }
  let settings = {};
  try {
    settings = JSON.parse(read(join(cwd, '.claude', 'settings.json')) ?? '{}');
  } catch {
    settings = {};
  }
  let steps = [];
  try {
    steps = JSON.parse(read(join(cwd, '.claude', 'steps.json')) ?? '{}').steps ?? [];
  } catch {
    steps = [];
  }
  return { standing, skills, helpers, settings, steps };
}

/** Rows of the standing file's tables that name a unit: the ask cell and the unit. */
function routingRows(standing, units) {
  const rows = [];
  for (const line of standing.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '');
    if (cells.length < 2) continue;
    for (const unit of units) {
      const named = cells.findIndex((cell) => cell.replace(/[`*]/g, '').includes(unit.name));
      if (named < 0) continue;
      const ask = cells.filter((_, index) => index !== named).join(' ');
      if (/\b(never|not)\b/i.test(cells[named] ?? '')) continue;
      rows.push({ unit, ask });
    }
  }
  return rows;
}

/** The unit an ask goes to: the most words shared with a routing row or a description, at least two. */
function route(ask, estate) {
  const units = [...estate.skills, ...estate.helpers];
  // The user's naming of a unit ("use the supplier email skill") is not what the ask is about: the route decides by
  // the work asked for, never by the unit the words name.
  const named = units.map((unit) => `${unit.name.replace(/[-_]+/g, ' ')}(?:\\s+(?:skill|agent|helper))?`);
  const asked = words(ask.replace(new RegExp(`\\b(?:${named.join('|')})\\b`, 'gi'), ' '));
  const shared = (text) => [...words(text)].filter((word) => asked.has(word)).length;
  let best;
  let score = 1;
  for (const unit of units) {
    const own = Math.max(
      shared(unit.description),
      ...routingRows(estate.standing, units)
        .filter((row) => row.unit === unit)
        .map((row) => shared(row.ask)),
    );
    if (own > score) {
      best = unit;
      score = own;
    }
  }
  if (best) return best;
  // One shared word is enough when it sits in a routing row of the standing file and only one unit's row has it.
  const rowHits = units
    .map((unit) => ({
      unit,
      score: Math.max(
        0,
        ...routingRows(estate.standing, units)
          .filter((row) => row.unit === unit)
          .map((row) => shared(row.ask)),
      ),
    }))
    .filter((hit) => hit.score >= 1)
    .sort((a, b) => b.score - a.score);
  return rowHits.length === 1 || (rowHits.length > 1 && rowHits[0].score > rowHits[1].score)
    ? rowHits[0].unit
    : undefined;
}

/** The step list in its order: from the stage no next enters, along the first next; anytime steps last. */
function walk(steps) {
  const flow = steps.filter((step) => step && !step.anytime && typeof step.id === 'string');
  const targets = new Set(flow.flatMap((step) => step.next ?? []));
  const order = [];
  let at = flow.find((step) => !targets.has(step.id)) ?? flow[0];
  while (at && !order.includes(at.id)) {
    order.push(at.id);
    const next = (at.next ?? []).find((id) => !order.includes(id));
    at = flow.find((step) => step.id === next);
  }
  for (const step of flow) if (!order.includes(step.id)) order.push(step.id);
  const anytime = steps.filter((step) => step?.anytime && typeof step.id === 'string').map((step) => step.id);
  // A check step can send the flow back to an earlier step: the step list itself says the work may fail there.
  const checks = new Set(
    flow
      .filter((step) =>
        (step.next ?? []).some((id) => order.indexOf(id) >= 0 && order.indexOf(id) < order.indexOf(step.id)),
      )
      .map((step) => step.id),
  );
  return { order, anytime, checks };
}

/** Whether a settings matcher covers a tool, as the runtime reads it: a pattern over the tool name. */
function covers(matcher, tool) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
}

/** Whether a permission rule of the settings denies a call. */
function denied(settings, tool, input) {
  const rules = settings?.permissions?.deny ?? [];
  return rules.some((rule) => {
    const match = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(rule);
    if (!match || match[1] !== tool) return false;
    if (match[2] === undefined) return true;
    const pattern = match[2].replace(/:\*$/, '').replace(/\*$/, '');
    return typeof input.command === 'string' && input.command.trim().startsWith(pattern);
  });
}

// Sentence boundaries outside code spans only: dots in filenames and commands are not punctuation.
function statementsOf(body) {
  const statements = [];
  let sentence = '';
  for (const token of body.match(/`[^`]*`|[.!?\n]|[^`.!?\n]+/g) ?? []) {
    if (/^[.!?\n]$/.test(token)) {
      if (sentence.trim()) statements.push(sentence.trim().replace(/^[-*\d.)\s]+/, ''));
      sentence = '';
    } else sentence += token;
  }
  if (sentence.trim()) statements.push(sentence.trim());
  return statements.filter((line) => !line.startsWith('#'));
}

const negative = (clause) =>
  /\b(never|do not|don't|must not|forbidden)\b/i.test(
    clause.replace(/`[^`]*`/g, '').replace(/\bnot forbidden\b/gi, ''),
  );

function masked(line) {
  const spans = [];
  const prose = line.replace(/`[^`]*`/g, (span) => `\uE000${spans.push(span) - 1}\uE000`);
  const restore = (clause) => clause.replace(/\uE000(\d+)\uE000/g, (_, index) => spans[Number(index)]);
  return { prose, restore };
}

// Skill paths are local to that skill; explicit .claude/ and absolute paths are estate-wide.
function fileTarget(literal, cwd, folder) {
  return resolve(cwd, isAbsolute(literal) || literal.startsWith('.claude/') ? '' : folder, literal);
}

function commandTarget(literal, cwd, folder) {
  return literal
    .trim()
    .split(/\s+/)
    .map((token) =>
      token.includes('/') || existsSync(fileTarget(token, cwd, folder))
        ? fileTarget(token, cwd, folder)
        : token,
    )
    .join(' ');
}

/** The same current-turn parser supplies candidates and evidence for asked/requested conditions. */
function requestedActions(ask) {
  const { prose, restore } = masked(ask);
  // Quoted targets are opaque; a dot within an unquoted filename is not a sentence boundary.
  return prose.split(/[\n;]+|[.!?](?:\s+|$)/).flatMap((clause) => {
    const request =
      /^(?:please\s+)?(?:(?:can|could|will|would)\s+you\s+|i\s+(?:want|need|ask)\s+you\s+to\s+)?(?:please\s+)?(run|execute|read|edit|dispatch|call|delegate)\s*:?[ \t]+(.+)$/i.exec(
        clause.trim(),
      );
    if (!request) return [];
    const requestedKind = /^(run|execute)$/i.test(request[1])
      ? 'Bash'
      : /^read$/i.test(request[1])
        ? 'Read'
        : /^edit$/i.test(request[1])
          ? 'Edit'
          : 'Agent';
    const named = restore(
      request[2].replace(/^(?:(?:this|the|following)\s+)?(?:exact\s+)?(?:command|file|helper)\s*:\s*/i, ''),
    ).trim();
    const literal = /^`[^`]+`$/.test(named) ? named.slice(1, -1) : named;
    return [{ kind: requestedKind, literal }];
  });
}

function actionTarget(kind, literal, cwd, folder) {
  return kind === 'Bash'
    ? commandTarget(literal, cwd, folder)
    : kind === 'Read' || kind === 'Edit'
      ? fileTarget(literal, cwd, folder)
      : literal;
}

/** Match the governed target, never the prohibition's glob or just a word shared with its name. */
function requestedAction(ask, kind, target, cwd, folder) {
  return requestedActions(ask).some(
    (action) =>
      action.kind === kind &&
      ['', folder].some((scope) => actionTarget(kind, action.literal, cwd, scope) === target),
  );
}

function askedCondition(condition) {
  const words = condition
    .toLowerCase()
    .replace(/\b(?:explicitly|specifically|directly)\s*/g, '')
    .trim();
  const passive =
    /^(?:you (?:are|were|have been) )?(?:asked|requested)(?: by (?:the )?user)?(?: to do (?:so|it|this|that))?(?: by (?:the )?user)?$/;
  const active =
    /^(?:the )?user (?:has )?(?:asks|requests|asked|requested)(?: (?:for )?(?:it|this|that)|(?: you)? to do (?:so|it|this|that))?$/;
  return passive.test(words) || active.test(words);
}

/**
 * Prohibitions are retained for the whole run, independently of positive action collection. Read/edit
 * targets are paths and run targets are complete commands; shell-style globs match those same targets.
 * Standing rules cover the stated action target in any skill as well as its estate-relative path;
 * skill rules resolve targets within their own folder. All standing files
 * and the routed unit are collected before the first action, so placement never overrides a ban.
 *
 * Conditional syntax: if/when/unless FILE exists, does not exist, is present or is missing. Conditions
 * are checked at the governed call, not once at planning. Asked/requested (including "the user asks",
 * "asked by the user", and explicit/specific requests) tests only the CURRENT turn for an imperative,
 * polite question or "I want you to" request naming that action and exact target. Mentions, negations,
 * other targets, and earlier turns do not count. Targets may be backticked or unquoted; commands use
 * their complete input. This exception never clears an unconditional prohibition, even if a later
 * instruction says "you may now". Every other unknown condition still stops the matching action
 * with a diagnostic; they are never silently treated as unconditional bans or permission. Temporal
 * before/until gates in skills remain dependency edges below, rather than permanent prohibitions.
 */
function prohibitions(estate, unit, cwd, ask) {
  const sources = [{ body: estate.standing, folder: '' }, ...(unit ? [unit] : [])];
  const rules = [];
  for (const source of sources) {
    for (const line of statementsOf(source.body)) {
      if (!negative(line)) continue;
      const { prose, restore } = masked(line);
      const prefix = /^(if|when|unless)\s+(.+?)[,;]\s*(.+)$/i.exec(prose);
      const suffix = /^(.+?)\s+(if|when|unless)\s+(.+)$/i.exec(prose);
      const condition = prefix ? prefix[2] : suffix?.[3];
      const connective = (prefix ? prefix[1] : suffix?.[2])?.toLowerCase();
      const action = prefix ? prefix[3] : suffix ? suffix[1] : prose;
      // These clauses have a conditional temporal meaning, not an unconditional ban.
      if (/\b(before|after|until)\b/i.test(action)) continue;
      const verb =
        /\b(read(?:ing)?|run(?:ning)?|execut(?:e|ing)|edit(?:ing)?|dispatch(?:ing)?|call(?:ing)?|delegat(?:e|ing))\b/i.exec(
          action,
        );
      if (!verb) continue;
      const kind = /^read/i.test(verb[1])
        ? 'Read'
        : /^(run|execut)/i.test(verb[1])
          ? 'Bash'
          : /^edit/i.test(verb[1])
            ? 'Edit'
            : 'Agent';
      const folder = source.folder ?? '';
      const holds = (calledTarget) => {
        if (!condition) {
          // A condition outside the supported grammar still must not become an unconditional ban.
          return /\b(if|when|unless|without|except|while)\b/i.test(action) ? undefined : true;
        }
        if (askedCondition(restore(condition))) {
          const value = requestedAction(ask, kind, calledTarget, cwd, unit?.folder ?? '');
          return connective === 'unless' ? !value : value;
        }
        const match = /^`([^`]+)`\s+(exists|does not exist|is present|is missing)$/i.exec(restore(condition));
        if (!match) return undefined;
        const exists = existsSync(fileTarget(match[1], cwd, folder));
        const value = /^(exists|is present)$/i.test(match[2]) ? exists : !exists;
        return connective === 'unless' ? !value : value;
      };
      for (const match of restore(action).matchAll(/`([^`]+)`/g)) {
        const literal = match[1].trim();
        const target =
          kind === 'Bash'
            ? commandTarget(literal, cwd, folder)
            : kind === 'Read' || kind === 'Edit'
              ? fileTarget(literal, cwd, folder)
              : literal;
        rules.push({ kind, target, literal, inherited: source === sources[0], holds });
      }
    }
  }
  return (tool, input, literal) => {
    const target =
      tool === 'Bash'
        ? commandTarget(input.command, cwd, '')
        : tool === 'Read' || tool === 'Edit'
          ? input.file_path
          : input.subagent_type;
    for (const rule of rules) {
      if (rule.kind !== tool || typeof target !== 'string') continue;
      if (
        !matchesGlob(target, rule.target) &&
        !(rule.inherited && literal !== undefined && matchesGlob(literal, rule.literal))
      )
        continue;
      const applies = rule.holds(target);
      if (applies === true)
        return 'An estate prohibition forbids this action; I stopped before the tool call.';
      if (applies === undefined)
        return 'The condition of an estate prohibition cannot be resolved; I stopped before the tool call.';
    }
    return undefined;
  };
}

/**
 * Collect the whole skill and current-turn requests before acting. Requests supply candidate actions
 * even when the skill contains only a prohibition. Append new requests in turn order after estate
 * candidates; the same action and normalized target execute once. All candidates share the existing
 * prerequisite graph and permission/prohibition checks. Explicit before/after/first/until clauses become dependency
 * edges, including clauses in later sections. Repeated mentions identify the same action. Without an
 * ordering clause, choose the earliest first mention among ready actions (source order, then code-span
 * order). A clause never orders an action against itself: a described part that names only the action the other
 * part quotes is unresolved, not a cycle. Unresolved relations and cycles stop the skill; they never silently fall
 * back to prose order.
 * This small grammar uses backticked paths/commands/helper names, or an unambiguous action description.
 */
function skillActions(unit, estate, requested, cwd, ask = '') {
  const statements = statementsOf(unit.body);
  const active = statements.filter(
    (line) => !negative(line) || /\b(before|after|until)\b/i.test(line.replace(/`[^`]*`/g, '')),
  );
  const actions = [];
  const add = (kind, literal, folder = unit.folder) => {
    const target = actionTarget(kind, literal, cwd, folder);
    if (!actions.some((action) => action.kind === kind && action.target === target))
      actions.push({ kind, literal, target, folder, needs: new Set() });
  };
  for (const line of active) {
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const literal = match[1].trim();
      // A path with an unfilled placeholder (`reports/<year>-W<week>.md`) names a file to write, not one to read.
      if (/^[^\s]+\.(?:md|txt|json|csv)$/.test(literal) && !/<[^>]+>/.test(literal)) add('Read', literal);
      else if (/\s/.test(literal) && /\b(run(?:ning)?|execut(?:e|ing))\b/i.test(line)) add('Bash', literal);
      else if (
        estate.helpers.some((helper) => helper.name === literal) &&
        /\b(dispatch(?:ing)?|call(?:ing)?|delegat(?:e|ing)|hand)\b/i.test(line)
      )
        add('Agent', literal);
    }
  }

  const lookup = scriptLookup(unit, ask, cwd);
  if (lookup) add('Bash', lookup);

  for (const action of requested) {
    // Current-turn file paths name an existing workspace file before falling back to a skill-local file.
    const folder =
      (action.kind === 'Read' || action.kind === 'Edit') && existsSync(fileTarget(action.literal, cwd, ''))
        ? ''
        : unit.folder;
    add(action.kind, action.literal, folder);
  }

  const noise = new Set(
    'before after first then only until run running execute executing command read reading file dispatch dispatching call calling do done must been have has you the a an of is it to'.split(
      ' ',
    ),
  );
  const terms = (text) => [...words(text)].filter((word) => !noise.has(word));
  // `except` holds the actions a clause may not name: the earlier part of an ordering clause cannot also be what
  // the later part describes, whatever word the two share. Only a description is read that way; a quoted action
  // is named on purpose, so a clause that quotes one action on both sides stays a contradiction.
  const matchActions = (clause, except = []) => {
    const prose = masked(clause).prose;
    const kind = /\bread(?:ing)?\b/i.test(prose)
      ? 'Read'
      : /\b(run(?:ning)?|execut(?:e|ing)|command)\b/i.test(prose)
        ? 'Bash'
        : /\bedit(?:ing)?\b/i.test(prose)
          ? 'Edit'
          : /\b(dispatch(?:ing)?|call(?:ing)?|delegat(?:e|ing))\b/i.test(prose)
            ? 'Agent'
            : undefined;
    const listed = actions.filter((action) => !kind || action.kind === kind);
    const quoted = [...clause.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
    if (quoted.length) {
      const matches = (action, literal) =>
        action.target === actionTarget(action.kind, literal, cwd, unit.folder);
      const found = listed.filter((action) => quoted.some((literal) => matches(action, literal)));
      return quoted.every((literal) => found.some((action) => matches(action, literal))) ? found : [];
    }
    const candidates = listed.filter((action) => !except.includes(action));
    const named = terms(clause);
    if (!named.length) return candidates.length === 1 ? candidates : [];
    // Names come from the action's own input, including a script's basename, never from a fixture table.
    const scores = candidates.map((action) => {
      const labels = words(action.literal.replace(/[./_-]/g, ' '));
      return { action, score: named.filter((word) => labels.has(word)).length };
    });
    const best = Math.max(0, ...scores.map(({ score }) => score));
    const found = scores.filter(({ score }) => score === best && score > 0);
    return found.length === 1 ? found.map(({ action }) => action) : [];
  };
  // Whether a clause names work the unit does: a content word of the clause starts like one of the unit's own words,
  // so "matching" is the work of a unit that matches.
  const ownWords = [...words(`${(unit.name ?? '').replace(/[-_]+/g, ' ')} ${unit.description ?? ''}`)];
  const describesOwnWork = (clause) =>
    terms(clause).some((word) =>
      ownWords.some(
        (own) => Math.min(word.length, own.length) >= 4 && (word.startsWith(own) || own.startsWith(word)),
      ),
    );
  let unresolved = false;
  const relate = (before, after) => {
    const quotes = (clause) => /`[^`]+`/.test(clause);
    const predecessors = matchActions(before, quotes(after) ? matchActions(after) : []);
    let successors = matchActions(after, quotes(before) ? matchActions(before) : []);
    // A later part that describes the unit's own work ("before matching any line", in a unit that matches lines) is not
    // an action the agent performs: the obligation orders every other action after the earlier part, and holds
    // vacuously when the unit does none. A later part that describes nothing the unit does stays unresolved, as does
    // an earlier part that names no action.
    let vacuous = false;
    if (predecessors.length && !successors.length && !quotes(after) && describesOwnWork(after)) {
      successors = actions.filter((action) => action.kind !== 'Read' && !predecessors.includes(action));
      vacuous = true;
    }
    // Two described parts that name one action do not order it: the words do not tell the parts apart.
    const same = successors.some((action) => predecessors.includes(action));
    if (
      !predecessors.length ||
      (!successors.length && !vacuous) ||
      (same && !(quotes(before) && quotes(after)))
    ) {
      unresolved = true;
      return;
    }
    for (const successor of successors)
      for (const predecessor of predecessors) successor.needs.add(predecessor);
  };
  const first = new Set();
  for (const line of active) {
    // Temporal words inside a quoted filename or command argument are data, not instructions.
    const { prose, restore } = masked(line);
    const relation = (before, after) => relate(restore(before), restore(after));
    const prefix =
      /^(?:only\s+)?(before|after)\s+(.+?)(?:[,;]\s*|\s+(?=(?:read|run|execute|dispatch|call|do)\b))(.+)$/i.exec(
        prose,
      );
    const suffix = /^(.+?)\s+(?:only\s+)?(before|after|until)\s+(.+)$/i.exec(prose);
    const sequence = /^first\s*,?\s*(.+?)(?:,\s*|\s+)then\s+(.+)$/i.exec(prose);
    if (prefix) {
      if (prefix[1].toLowerCase() === 'before') {
        if (negative(prefix[3])) relation(prefix[2], prefix[3]);
        else relation(prefix[3], prefix[2]);
      } else if (negative(prefix[3])) unresolved = true;
      else relation(prefix[2], prefix[3]);
    } else if (suffix) {
      const word = suffix[2].toLowerCase();
      if (word === 'before' && !negative(suffix[1])) relation(suffix[1], suffix[3]);
      else if ((word === 'after' && negative(suffix[1])) || (word === 'until' && !negative(suffix[1])))
        unresolved = true;
      else relation(suffix[3], suffix[1]);
    } else if (sequence) {
      relation(sequence[1], sequence[2]);
      for (const action of matchActions(restore(sequence[1]))) first.add(action);
    } else if (/^first\b|\bfirst$/i.test(prose)) {
      const named = matchActions(restore(prose.replace(/^first\s*,?\s*|\s+first$/gi, '')));
      if (!named.length) unresolved = true;
      for (const action of named) first.add(action);
    } else if (/\b(before|after|first|until)\b/i.test(prose)) {
      unresolved = true;
    }
  }
  for (const action of actions)
    if (!first.has(action)) for (const prerequisite of first) action.needs.add(prerequisite);
  const ordered = [];
  const remaining = new Set(actions);
  while (remaining.size) {
    const ready = actions.find(
      (action) => remaining.has(action) && [...action.needs].every((need) => !remaining.has(need)),
    );
    if (!ready) return { error: 'The skill has contradictory ordering obligations.', actions: [] };
    remaining.delete(ready);
    ordered.push(ready);
  }
  return unresolved
    ? { error: 'The skill has an ordering obligation whose actions cannot be resolved.', actions: [] }
    : { actions: ordered };
}

/**
 * The call of a skill's own script that the ask needs. A skill shows its script in an example
 * (\`./scripts/track.sh NWX 123\`); an ask naming an identifier a workspace table lists is a lookup of that
 * identifier with it. The call passes the identifier. An instruction "pass the <field> to <script>" adds the value
 * of that field from the table row of the identifier, at the position the example gives a value of that shape; a
 * prohibition ("do not pass ...") or no instruction leaves it out. Undefined when the skill shows no script call or
 * the workspace lists no row for the ask.
 */
function scriptLookup(unit, ask, cwd) {
  const example = /`(\.\/[\w./-]+\.(?:sh|py|js|mjs))((?:\s+\S+)+)`/.exec(unit.body ?? '');
  if (!example) return undefined;
  const script = example[1];
  const base = script.split('/').pop();
  const ids = ask.match(IDENTIFIER) ?? [];
  if (ids.length === 0) return undefined;
  // The table row that lists the identifier: a header line and rows of comma-separated cells.
  let header;
  let row;
  for (const path of workspaceFiles(cwd).filter((file) => file.endsWith('.csv'))) {
    const lines = (read(join(cwd, path)) ?? '').split('\n').filter(Boolean);
    const found = lines.slice(1).find((line) => line.split(',').includes(ids[0]));
    if (found && lines[0]) {
      header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
      row = found.split(',').map((cell) => cell.trim());
      break;
    }
  }
  if (!row) return undefined;
  const shape = (value) => value.replace(/[A-Za-z]/g, 'a').replace(/\d/g, '9');
  const args = [ids[0]];
  for (const line of statementsOf(unit.body)) {
    const pass = /\bpass(?:es|ing)?\s+(?:the\s+)?([\w ]+?)\s+to\s+`?(?:[\w./-]*\/)?([\w-]+)/i.exec(line);
    // A sentence splits at the dot of a file name, so the script is named by its stem.
    if (!pass || pass[2] !== base.split('.')[0] || negative(line)) continue;
    const field = words(pass[1] ?? '');
    const at = header.findIndex((name) => field.has(name));
    const value = at >= 0 ? row[at] : undefined;
    if (!value) continue;
    const exampleArgs = (example[2] ?? '').trim().split(/\s+/);
    const position = exampleArgs.findIndex(
      (arg) =>
        shape(arg).length === shape(value).length && /^[A-Za-z]+$/.test(arg) === /^[A-Za-z]+$/.test(value),
    );
    args.splice(position < 0 ? 0 : Math.min(position, args.length), 0, value);
  }
  return `${script} ${args.join(' ')}`;
}

/**
 * A helper whose body says to sort messages into named folders sorts the messages the ask points at: each message goes
 * to the folder whose name (singular) it holds most often. One that fits none goes where the body's rule sends it
 * ("A message that fits none goes to "other""), and is left unsorted when the body has no such rule. One line per
 * message, "<path>: <folder>".
 */
function sortedBy(unit, ask, cwd) {
  const body = unit.body ?? '';
  const sort = /\bsort\w*\b[^.\n]*?\binto\b[^:.\n]*?\bfolders?\b[^:.\n]*:\s*([^.\n]+)\./i.exec(body);
  if (!sort) return { lines: [], removed: [] };
  const folders = (sort[1] ?? '')
    .split(/,|\band\b/i)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => /^[a-z]+$/.test(name));
  // The rule for a message that fits no folder holds unless the sentence forbids it.
  // A sentence wrapped over two lines is one sentence.
  const unwrapped = body.replace(/\n(?![\n\-*#\d])/g, ' ');
  const fallback = statementsOf(unwrapped)
    .filter((line) => !negative(line))
    .map((line) => /\bfits (?:none|no \w+)\b[^"]*"([^"]+)"/i.exec(line)?.[1])
    .find(Boolean);
  // An unconstrained agent clears what it has handled: a sorted message is removed once it is filed, unless the unit
  // forbids deleting ("never delete one").
  const forbidsDelete = statementsOf(unwrapped).some((line) =>
    /\b(?:never|do not|don't|must not)\b[^.]*\b(?:delete|remove)\b/i.test(line),
  );
  const folder = (ask.split(/\s+/).find((word) => word.endsWith('/') && word.length > 1) ?? '').replace(
    /[.,;:!?]+$/,
    '',
  );
  if (!folder || !existsSync(join(cwd, folder))) return { lines: [], removed: [] };
  const lines = [];
  const removed = [];
  for (const path of workspaceFiles(cwd).filter((candidate) => candidate.startsWith(folder))) {
    const text = (read(join(cwd, path)) ?? '').toLowerCase();
    let best;
    let bestCount = 0;
    for (const name of folders) {
      const count = text.split(name.replace(/s$/, '')).length - 1;
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    const target = best ?? fallback;
    if (target) {
      lines.push(`${path}: ${target}`);
      if (!forbidsDelete) removed.push(path);
    }
  }
  return { lines, removed };
}

/**
 * The reply the unit's own output rules shape. "Answer with one JSON object" makes the reply that object and nothing
 * else; "End with one line per invoice: matched, short or over, and the amount" ends the reply with a line per
 * identifier of the ask that names the entity: the state is the listed word a tool printed, else the first listed,
 * and the amount is the first amount a tool printed, else zero. Undefined when the unit states no output rule.
 */
function replyOf(unit, ask, outputs) {
  // An output rule of the unit shapes the reply; a prohibition of the same form ("do not end with ...") does not.
  const lines = statementsOf((unit?.body ?? '').replace(/\n(?![\n\-*#\d])/g, ' ')).filter(
    (line) => !negative(line),
  );
  const body = lines.join('.\n');
  if (/\banswer with one json object\b/i.test(body)) return '{"status": "done"}';
  const rule = /\b(?:end|finish|close) with one line per ([\w-]+):\s*([^.\n]+)/i.exec(body);
  if (!rule) return undefined;
  const entity = (rule[1] ?? '').toLowerCase();
  const words = (rule[2] ?? '')
    .split(/,|\bor\b/i)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z]+$/.test(word));
  const printed = outputs.join(' ').toLowerCase();
  const state = words.find((word) => new RegExp(`\\b${word}\\b`).test(printed)) ?? words[0];
  const amount = /-?\d+(?:[.,]\d+)?\s*[A-Z]{3}\b/.exec(outputs.join(' '))?.[0] ?? '0.00 EUR';
  const ids = (ask.match(IDENTIFIER) ?? []).filter((id) =>
    entity.startsWith((id.split('-')[0] ?? '').toLowerCase()),
  );
  if (!state || ids.length === 0) return undefined;
  return ['Done. Here is what I did, in short.', ...ids.map((id) => `${id}: ${state} ${amount}`)].join('\n');
}

/** Identifiers an ask or a file holds: a prefix, a hyphen and digits (INV-1001, PO-2001). */
const IDENTIFIER = /\b[A-Za-z]{1,6}-\d{2,}\b/g;

/** The files of the workspace, relative to the working folder; the estate's own folders are not workspace. */
function workspaceFiles(cwd, folder = '', found = []) {
  for (const entry of readdirSync(join(cwd, folder), { withFileTypes: true })) {
    if (['.claude', '.git', 'node_modules', 'CLAUDE.md'].includes(entry.name) && folder === '') continue;
    const path = folder === '' ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) workspaceFiles(cwd, path, found);
    else if (entry.isFile() && found.length < 2000) found.push(path);
  }
  return found;
}

/**
 * Fills the placeholders of a command from the workspace. `<invoice>` becomes the file under an `invoice...` folder
 * or of an `invoice...` name that holds an identifier of the ask; `<order>` the file of an `order...` kind that holds
 * an identifier of a file already bound ("its order"). A placeholder no file answers is dropped.
 */
function bindPlaceholders(tokens, ask, cwd) {
  const files = existsSync(cwd) ? workspaceFiles(cwd) : [];
  const known = new Set(ask.match(IDENTIFIER) ?? []);
  const out = [];
  for (const token of tokens) {
    const holder = /^<([\w-]+)>$/.exec(token);
    if (!holder) {
      out.push(token);
      continue;
    }
    const stem = holder[1].toLowerCase();
    let best;
    let bestScore = 0;
    for (const file of files.filter((candidate) =>
      candidate
        .toLowerCase()
        .split('/')
        .some((part) => part.startsWith(stem)),
    )) {
      const text = `${file} ${read(join(cwd, file)) ?? ''}`;
      const score = [...known].filter((id) => text.includes(id)).length;
      if (score > bestScore) {
        best = file;
        bestScore = score;
      }
    }
    if (!best) continue;
    out.push(best);
    for (const id of `${best} ${read(join(cwd, best)) ?? ''}`.match(IDENTIFIER) ?? []) known.add(id);
  }
  return out;
}

export function planStream({ ask, cwd, sessionId, env }) {
  const estate = readEstate(cwd);
  const unit = route(ask, estate);
  const prohibited = prohibitions(estate, unit, cwd, ask);
  const out = [];
  let id = 0;
  let blocked = false;
  const text = (value) =>
    out.push({
      type: 'assistant',
      message: {
        id: `msg_agent_${++id}`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'text', text: value }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      parent_tool_use_id: null,
    });

  /** Runs the hooks of an event for a tool call; true when one blocks it (exit 2 on a PreToolUse). */
  const transcriptDir = mkdtempSync(join(tmpdir(), 'fake-transcript-'));
  /** The session so far as the runtime writes it, for the hooks that read it (`transcript_path`). */
  const transcript = () => {
    const path = join(transcriptDir, `${sessionId}.jsonl`);
    const rows = out.filter((row) => (row.type === 'assistant' || row.type === 'user') && row.message);
    writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    return path;
  };
  const hooks = (event, tool, payload) => {
    let block = false;
    for (const group of estate.settings?.hooks?.[event] ?? []) {
      if (!group || (tool !== undefined && !covers(group.matcher, tool))) continue;
      for (const hook of group.hooks ?? []) {
        if (hook?.type !== 'command' || typeof hook.command !== 'string') continue;
        const hookId = `hook_${++id}`;
        const name = tool === undefined ? event : `${event}:${tool}`;
        out.push({
          type: 'system',
          subtype: 'hook_started',
          hook_id: hookId,
          hook_name: name,
          hook_event: event,
        });
        const ran = spawnSync('/bin/sh', ['-c', hook.command], {
          cwd,
          input: `${JSON.stringify({ session_id: sessionId, cwd, transcript_path: transcript(), hook_event_name: event, ...payload })}\n`,
          env: { ...env, CLAUDE_PROJECT_DIR: cwd },
          encoding: 'utf8',
          timeout: (hook.timeout ?? 60) * 1000,
        });
        const exit = ran.status ?? 1;
        out.push({
          type: 'system',
          subtype: 'hook_response',
          hook_id: hookId,
          hook_name: name,
          hook_event: event,
          stdout: ran.stdout ?? '',
          stderr: ran.stderr ?? '',
          exit_code: exit,
          outcome: exit === 0 ? 'success' : 'error',
        });
        if (exit === 2 && event === 'PreToolUse') block = true;
      }
    }
    return block;
  };

  /** A tool call as the runtime makes it: denied by a permission, blocked by a hook, else done. */
  const call = (tool, input, perform, literal) => {
    const prohibition = prohibited(tool, input, literal);
    if (prohibition) {
      blocked = true;
      text(prohibition);
      return undefined;
    }
    if (denied(estate.settings, tool, input)) return undefined;
    const useId = `toolu_agent_${++id}`;
    out.push({
      type: 'assistant',
      message: {
        id: `msg_agent_${++id}`,
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [{ type: 'tool_use', id: useId, name: tool, input }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      parent_tool_use_id: null,
    });
    const stopped = hooks('PreToolUse', tool, { tool_name: tool, tool_input: input });
    const result = stopped ? { error: true, content: 'Blocked by a hook.' } : perform();
    out.push({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: useId,
            type: 'tool_result',
            content: result.content,
            ...(result.error ? { is_error: true } : {}),
          },
        ],
      },
      parent_tool_use_id: null,
    });
    if (!stopped)
      hooks('PostToolUse', tool, {
        tool_name: tool,
        tool_input: input,
        tool_response: { stdout: result.content, stderr: '', interrupted: false },
      });
    if (stopped) blocked = true;
    return result;
  };

  const editFile = (target, folder) => {
    const readFirst = estate.standing
      .split('\n')
      .some(
        (line) =>
          /\bread\b[^.]*\bbefore\b[^.]*\b(edit|chang|modif|writ)/i.test(line) &&
          !/\bnever read\b/i.test(line),
      );
    const path = fileTarget(target, cwd, folder);
    if (readFirst) {
      const result = call('Read', { file_path: path }, () => ({ content: read(path) ?? '' }), target);
      if (!result || result.error) return result;
    }
    const before = read(path) ?? '';
    const added = `${before.endsWith('\n') ? '' : '\n'}Updated as asked.\n`;
    const result = call(
      'Edit',
      { file_path: path, old_string: before.split('\n').pop() ?? '', new_string: added },
      () => ({ content: `The file ${target} has been updated.` }),
      target,
    );
    if (result && !result.error)
      out.push({ fake: 'write', path: relative(cwd, path), content: `${before}${added}` });
    return result;
  };

  const step = (name) => out.push({ fake: 'step', step: name });
  const { order, anytime, checks } = walk(estate.steps);
  // An unconstrained agent finishes as soon as the change is made. A check step is run when the standing file forbids
  // going on before it has passed ("Never report a task as done before the verify step has passed").
  const gatedChecks = new Set(
    statementsOf(estate.standing)
      .filter((line) => negative(line))
      .flatMap((line) =>
        [...checks].filter((id) => new RegExp(`\\bbefore\\b[^.]*\\b${id}\\b`, 'i').test(line)),
      ),
  );

  hooks('UserPromptSubmit', undefined, { prompt: ask });
  // An ask to explain without acting, or to say what can be done: a reply, nothing else.
  if (
    /^(?:no need to do anything|what kinds of things|what does\b|what would it mean)/i.test(ask) ||
    /\bjust tell me\b/i.test(ask)
  ) {
    text('Here is my answer; I changed nothing.');
    hooks('Stop', undefined, { stop_hook_active: false });
    return { records: out, blocked };
  }

  let helperLines = [];
  if (order[0]) step(order[0]);
  // Standing instructions that start a session ("Read `x` at the start of every session") are done first.
  for (const line of statementsOf(estate.standing)) {
    const start =
      /\bread\b[^`]*`([^`]+)`[^.]*\bat the start of (?:every|each|a|the|your)\b[^.]*\bsession\b/i.exec(
        line,
      ) ??
      /\bat the start of (?:every|each|a|the|your)\b[^,]*\bsession\b[^`]*\bread\b[^`]*`([^`]+)`/i.exec(line);
    if (start?.[1] && !negative(line)) {
      const path = fileTarget(start[1], cwd, '');
      call('Read', { file_path: path }, () => ({ content: read(path) ?? '' }), start[1]);
    }
  }
  if (unit?.kind === 'skill') {
    call('Skill', { skill: unit.name }, () => ({ content: `Launching skill: ${unit.name}` }));
  } else if (unit?.kind === 'helper') {
    const sorted = sortedBy(unit, ask, cwd);
    helperLines = sorted.lines;
    call('Agent', { subagent_type: unit.name, description: `Brief for ${unit.name}`, prompt: ask }, () => {
      for (const path of sorted.removed) out.push({ fake: 'delete', path });
      return { content: helperLines.length > 0 ? helperLines.join('\n') : '{"status": "done"}' };
    });
  }
  // An ask to delete or remove something is done with a command: `rm` of the file it names, or of a file under the
  // folder it names ("a ledger file"); the estate's own prohibitions and guards stand between the ask and the file.
  const removal = /\b(?:delete|remove)\b\s+(?:the |a |an |this |that )?([^.,;]*)/i.exec(ask);
  if (removal && !requestedActions(ask).length) {
    const phrase = removal[1] ?? '';
    const token = phrase.split(/\s+/).find((word) => word.includes('/'));
    const folder = phrase
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9-]/g, ''))
      .find((word) => word.length > 2 && `${estate.standing}`.includes(`\`${word}/\``));
    const file =
      token ??
      (folder
        ? (workspaceFiles(cwd).find((path) => path.startsWith(`${folder}/`)) ?? `${folder}/entry`)
        : undefined);
    if (file) {
      call('Bash', { command: `rm ${file}`, description: 'Remove the file' }, () => {
        const ran = spawnSync('/bin/sh', ['-c', `rm ${file}`], { cwd, encoding: 'utf8', timeout: 30_000 });
        return { content: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() || `exit ${ran.status}` };
      });
    }
  }
  // "Use the <Tool> tool on the files here": one call of that tool on the workspace.
  const useTool = /\buse the (Bash|Edit|Write|Read|Grep|Glob) tool\b/i.exec(ask)?.[1]?.toLowerCase();
  // A unit that lists the tools it works with offers no other: a tool it does not list, and the settings do not allow
  // outright, is not used for its work.
  const listed = (unit?.tools ?? '')
    .split(',')
    .map((entry) => entry.trim().split('(')[0]?.toLowerCase())
    .filter(Boolean);
  const outright = (estate.settings?.permissions?.allow ?? []).map((rule) => String(rule).toLowerCase());
  if (useTool && listed.length > 0 && !listed.includes(useTool) && !outright.includes(useTool)) {
    text(`The ${useTool} tool is not one this work offers; I did not use it.`);
  } else if (useTool && !requestedActions(ask).length) {
    const first = workspaceFiles(cwd).find((path) => !path.startsWith('.claude'));
    if (useTool === 'bash') {
      call('Bash', { command: 'ls', description: 'List the files' }, () => {
        const ran = spawnSync('/bin/sh', ['-c', 'ls'], { cwd, encoding: 'utf8', timeout: 30_000 });
        return { content: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() || 'exit 0' };
      });
    } else if (useTool === 'edit' || useTool === 'write') {
      editFile(first ?? 'notes.md', '');
    } else if (useTool === 'read') {
      const path = first ? fileTarget(first, cwd, '') : undefined;
      if (path) call('Read', { file_path: path }, () => ({ content: read(path) ?? '' }), first);
    } else {
      const pattern = useTool === 'glob' ? '**/*' : '.';
      call(useTool === 'glob' ? 'Glob' : 'Grep', { pattern }, () => ({
        content: workspaceFiles(cwd).join('\n') || 'No files found',
      }));
    }
  }
  const planUnit = unit?.kind === 'skill' ? unit : { body: '', folder: '' };
  const requested = requestedActions(ask).filter(
    (action) => !(unit?.kind === 'helper' && action.kind === 'Agent' && action.literal === unit.name),
  );
  const plan = skillActions(planUnit, estate, requested, cwd, ask);
  if (plan.error) {
    text(plan.error);
    hooks('Stop', undefined, { stop_hook_active: false });
    return { records: out, blocked: true };
  }
  // An action that ran and failed leaves the actions that wait on it undone; the others go on, as an agent that
  // reports an error does not abandon the rest of its work.
  const failed = new Set();
  const outputs = [];
  for (const action of plan.actions) {
    if ([...action.needs].some((need) => failed.has(need))) {
      failed.add(action);
      continue;
    }
    let result;
    if (action.kind === 'Read') {
      const path = fileTarget(action.literal, cwd, action.folder);
      result = call(
        'Read',
        { file_path: path },
        () => {
          const content = read(path);
          return content === undefined
            ? { error: true, content: `File not found: ${action.literal}` }
            : { content };
        },
        action.literal,
      );
    } else if (action.kind === 'Bash') {
      // Resolve commands against the skill folder. A placeholder (`<invoice>`) is filled with the workspace file the
      // ask points at; one nothing in the workspace answers is left out.
      const command = bindPlaceholders(action.literal.split(/\s+/), ask, cwd)
        .map((token) => (existsSync(join(cwd, action.folder, token)) ? join(action.folder, token) : token))
        .join(' ');
      result = call(
        'Bash',
        { command, description: 'Run the named command' },
        () => {
          const ran = spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 30_000 });
          return {
            content: `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim() || `exit ${ran.status}`,
            error: ran.status !== 0,
          };
        },
        action.literal,
      );
    } else if (action.kind === 'Edit') {
      result = editFile(action.literal, action.folder);
    } else {
      result = call(
        'Agent',
        { subagent_type: action.literal, description: `Brief for ${action.literal}`, prompt: ask },
        () => ({ content: '{"status": "done"}' }),
        action.literal,
      );
    }
    if (result && action.kind === 'Bash') outputs.push(String(result.content));
    // An action the estate or a guard refuses ends the work. An action that ran and failed is not satisfied: the
    // actions that wait on it are not executed.
    if (!result) {
      text('An action could not complete; I stopped before continuing.');
      hooks('Stop', undefined, { stop_hook_active: false });
      return { records: out, blocked: true };
    }
    if (result.error) failed.add(action);
  }
  if (failed.size > 0) text('An action could not complete; I went on with what did not depend on it.');
  const rest = order.slice(1);
  if (rest[0]) step(rest[0]);

  // Preserve the existing implicit file-edit request only when no explicit action is named.
  const changes =
    /\b(?:add|append|update|fix|change|correct|set|write|edit|rename|replace|insert|remove from)\b/i.test(
      ask,
    );
  const target =
    requestedActions(ask).length || !changes
      ? undefined
      : ask
          .split(/\s+/)
          .map((token) => token.replace(/[.,;:!?]+$/, ''))
          .find((token) => token.includes('/') && !token.startsWith('.claude') && isFile(join(cwd, token)));
  if (target) editFile(target, '');

  // A step allowed at any point happens before the work closes: the closing step is last.
  for (const name of rest.slice(1, -1)) if (!checks.has(name) || gatedChecks.has(name)) step(name);
  for (const name of anytime) step(name);
  if (rest.length > 1) step(rest.at(-1));
  text(
    blocked
      ? 'A guard blocked part of the work; I stopped there.'
      : (replyOf(unit, ask, outputs) ?? ['Done. Here is what I did, in short.', ...helperLines].join('\n')),
  );
  hooks('Stop', undefined, { stop_hook_active: false });
  return { records: out, blocked };
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
