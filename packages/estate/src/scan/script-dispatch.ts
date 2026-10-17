import { posix } from 'node:path';

/**
 * `flag`: the text came from an argument although its markers were resolved (a string method was applied).
 * `table`: a literal mapping. `selected`: the value was picked out of a table by an argument.
 */
type Value = {
  text?: string;
  items?: Value[];
  arguments?: true;
  flag?: true;
  table?: Map<string, Value>;
  selected?: true;
};
const unknown: Value = {};
const marker = (index: number): Value => ({ text: `\uE010${index}\uE011` });
const sourced = (value: Value): boolean => value.flag === true || /\uE010\d+\uE011/.test(value.text ?? '');
const literal = (text: string): Value => ({ text });
const identifier = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** Split syntax only outside quoted strings and balanced brackets. */
function split(text: string, separators: string, newline = false): string[] {
  const parts: string[] = [];
  let from = 0;
  let depth = 0;
  let quote = '';
  let triple = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? '';
    if (quote) {
      if (char === '\\') at++;
      else if (triple ? text.slice(at, at + 3) === quote.repeat(3) : char === quote) {
        if (triple) at += 2;
        quote = '';
      }
      continue;
    }
    if (['"', "'", '`'].includes(char)) {
      quote = char;
      triple = text.slice(at, at + 3) === char.repeat(3);
      if (triple) at += 2;
    } else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (depth === 0 && (separators.includes(char) || (newline && char === '\n'))) {
      parts.push(text.slice(from, at).trim());
      from = at + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
}

/** The text before and after the first occurrence of a word outside quotes and brackets. */
function splitWord(text: string, word: string): [string, string] | undefined {
  let depth = 0;
  let quote = '';
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? '';
    if (quote) {
      if (char === '\\') at++;
      else if (char === quote) quote = '';
    } else if (['"', "'", '`'].includes(char)) quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (depth === 0 && text.startsWith(word, at)) {
      const before = text[at - 1] ?? ' ';
      const after = text[at + word.length] ?? ' ';
      if (/\w/.test(word[0] ?? '') && (/\w/.test(before) || /\w/.test(after))) continue;
      return [text.slice(0, at), text.slice(at + word.length)];
    }
  }
  return undefined;
}

/** The expression and the index of a trailing `[…]`, with the brackets balanced. */
function lastIndex(text: string): [string, string] | undefined {
  if (!text.endsWith(']')) return undefined;
  let depth = 0;
  for (let at = text.length - 1; at > 0; at--) {
    if (text[at] === ']') depth++;
    else if (text[at] === '[' && --depth === 0) return [text.slice(0, at), text.slice(at + 1, -1)];
  }
  return undefined;
}

function calls(text: string): Array<{ name: string; args: string[] }> {
  const found: Array<{ name: string; args: string[] }> = [];
  const pattern = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
  let masked = '';
  let quoted = '';
  for (let at = 0; at < text.length; at++) {
    const char = text[at] ?? '';
    if (quoted) {
      masked += ' ';
      if (char === '\\') {
        masked += ' ';
        at++;
      } else if (char === quoted) quoted = '';
    } else if (['"', "'", '`'].includes(char)) {
      quoted = char;
      masked += ' ';
    } else masked += char;
  }
  for (const match of masked.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let quote = '';
    let end = start;
    for (; end < text.length; end++) {
      const char = text[end] ?? '';
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = '';
      } else if (['"', "'", '`'].includes(char)) quote = char;
      else if (char === '(') depth++;
      else if (char === ')' && --depth === 0) break;
    }
    if (depth === 0) found.push({ name: match[1] ?? '', args: split(text.slice(start, end), ',') });
  }
  return found;
}

/** Comments disappear; literals remain data and interpolated expressions retain their syntax. */
function codeOnly(source: string): string {
  let text = '';
  let quote = '';
  let triple = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at] ?? '';
    if (quote) {
      text += char;
      if (char === '\\') text += source[++at] ?? '';
      else if (triple ? source.slice(at, at + 3) === quote.repeat(3) : char === quote) {
        if (triple) {
          text += source.slice(at + 1, at + 3);
          at += 2;
        }
        quote = '';
      }
    } else if (['"', "'", '`'].includes(char)) {
      quote = char;
      triple = source.slice(at, at + 3) === char.repeat(3);
      text += char;
      if (triple) {
        text += source.slice(at + 1, at + 3);
        at += 2;
      }
    } else if (char === '#' || source.slice(at, at + 2) === '//') {
      while (at < source.length && source[at] !== '\n') at++;
      text += '\n';
    } else text += char;
  }
  return text;
}

const interpreter = /^(?:python(?:\d+(?:\.\d+)*)?|node|ruby|(?:ba|z|da|k)?sh|bun|deno|tsx)$/;

/**
 * A bounded symbolic reader, not an execution of project code. Command arguments retain their identity
 * through local values, interpolation, path joins, argv slices and parser attributes. Only a value used
 * in an executable/imported file position establishes dispatch; an option passed to a fixed tool does not.
 */
function codeTarget(
  source: string,
  actual: readonly string[],
  state: { existing: boolean },
): string | undefined {
  const values = new Map<string, Value>();
  const options = new Map<string, string[]>();
  const switches = new Set<string>();
  const positional = new Map<string, number>();
  const code = codeOnly(source);
  for (const call of calls(code)) {
    if (!/\.add_argument$/.test(call.name)) continue;
    const names = call.args
      .map((arg) => /^['"]([^'"]+)['"]$/.exec(arg)?.[1])
      .filter((arg): arg is string => arg !== undefined);
    const flags = names.filter((name) => name.startsWith('-'));
    const destination = /\bdest\s*=\s*['"]([^'"]+)['"]/.exec(call.args.join(','))?.[1];
    const name =
      destination ??
      (flags.find((flag) => flag.startsWith('--')) ?? names[0])?.replace(/^-+/, '').replace(/-/g, '_');
    if (name === undefined) continue;
    if (
      flags.length &&
      /\b(?:action\s*=\s*['"](?:store_true|store_false|store_const|count|append_const)['"]|nargs\s*=\s*0)/.test(
        call.args.join(','),
      )
    )
      switches.add(name);
    if (flags.length) options.set(name, flags);
    else positional.set(name, positional.size);
  }
  const actualPositionals: number[] = [];
  const knownFlags = new Set([...options.values()].flat());
  for (let index = 0; index < actual.length; index++) {
    const word = actual[index] ?? '';
    if (knownFlags.has(word)) {
      const name = [...options].find(([, flags]) => flags.includes(word))?.[0];
      if (name === undefined || !switches.has(name)) index++;
    } else if (!word.startsWith('-')) actualPositionals.push(index);
  }
  const resolveOption = (name: string): Value => {
    if (switches.has(name)) return unknown;
    const flags = options.get(name);
    if (flags) {
      for (let index = 0; index < actual.length; index++) {
        const word = actual[index] ?? '';
        if (flags.includes(word) && actual[index + 1] !== undefined) return marker(index + 1);
        if (flags.some((flag) => word.startsWith(`${flag}=`))) {
          // An equals-form option is represented by its value, not by the option spelling.
          const key = actual.length + index;
          extra.set(key, word.slice(word.indexOf('=') + 1));
          return marker(key);
        }
      }
    }
    const at = positional.get(name);
    return at === undefined || actualPositionals[at] === undefined
      ? unknown
      : marker(actualPositionals[at] ?? 0);
  };
  const extra = new Map<number, string>();
  const concrete = (value: Value): string =>
    (value.text ?? '').replace(
      /\uE010(\d+)\uE011/g,
      (_, index: string) => actual[Number(index)] ?? extra.get(Number(index)) ?? '',
    );
  const combine = (parts: Value[], separator = ''): Value =>
    parts.every((part) => part.text !== undefined)
      ? {
          text: parts.map((part) => part.text).join(separator),
          ...(parts.some((part) => part.flag) ? { flag: true as const } : {}),
          ...(parts.some((part) => part.selected) ? { selected: true as const } : {}),
        }
      : unknown;
  const argv = (name: string): Value => ({
    items: [
      ...(name === 'process.argv'
        ? [literal('node'), literal('wrapper')]
        : name === 'sys.argv'
          ? [literal('wrapper')]
          : []),
      ...actual.map((_, index) => marker(index)),
    ],
  });
  const evaluate = (input: string, depth = 0): Value => {
    if (depth > 30) return unknown;
    const text = input.trim().replace(/;$/, '');
    if (values.has(text)) return values.get(text) ?? unknown;
    if (/^(?:sys\.argv|process\.argv|ARGV)$/.test(text)) return argv(text);
    if (/^(?:sys\.executable|process\.execPath)$/.test(text)) return literal('python3');
    if (/^(?:__dirname|__dir__|__file__)$/.test(text)) return literal('.');
    // A fallback or conditional operand: the first one that comes from an argument.
    for (const word of [' if ', ' or ', '||', '??']) {
      const cut = splitWord(text, word);
      if (!cut) continue;
      const left = evaluate(cut[0], depth + 1);
      if (word === ' if ' || sourced(left)) return left;
      return evaluate(cut[1], depth + 1);
    }
    // The environment names a folder (the project, the home): a base the file is searched under.
    if (/^(?:os\.environ(?:\.get\(|\[)|os\.getenv\(|process\.env[.[]|ENV(?:\.fetch\(|\[))/.test(text))
      return literal('.');
    // Shell expansions: `${NAME:-default}`, the script's own folder.
    const fallback = /^([A-Za-z_]\w*):?[-=](.*)$/.exec(text);
    if (fallback) return values.get(fallback[1] ?? '') ?? literal(fallback[2] ? (fallback[2] ?? '.') : '.');
    if (/^(?:0|BASH_SOURCE\[0\])(?:[%#].*)?$/.test(text)) return literal('.');
    const env = /^\$\{?([A-Za-z_]\w*|\d+)\}?$/.exec(text);
    if (env) {
      const name = env[1] ?? '';
      if (/^\d+$/.test(name)) return name === '0' ? literal('.') : marker(Number(name) - 1);
      return values.get(name) ?? (/^[A-Z][A-Z0-9_]*$/.test(name) ? literal('.') : unknown);
    }
    const attribute = /^(\w+)\.(\w+)$/.exec(text);
    if (attribute && values.get(attribute[1] ?? '')?.arguments) return resolveOption(attribute[2] ?? '');
    const strings = /^([frbuFRBU]*)("""|'''|['"`])([\s\S]*)\2$/.exec(text);
    const singleLiteral =
      strings &&
      (() => {
        const prefix = strings[1] ?? '';
        const quote = strings[2] ?? '';
        for (let at = prefix.length + quote.length; at < text.length; at++) {
          if (text[at] === '\\') {
            at++;
            continue;
          }
          if (text.slice(at, at + quote.length) === quote) return at + quote.length === text.length;
        }
        return false;
      })();
    if (strings && singleLiteral) {
      const prefix = strings[1] ?? '';
      const quote = strings[2] ?? '';
      let body = strings[3] ?? '';
      if (/[fF]/.test(prefix) || quote === '`' || quote === '"') {
        let valid = true;
        let carried: Pick<Value, 'flag' | 'selected'> = {};
        body = body.replace(
          /\$?\{([^{}]+)\}|#\{([^{}]+)\}|\$([A-Za-z_]\w*|\d+)/g,
          (whole, py: string | undefined, ruby: string | undefined, shell: string | undefined) => {
            // Ordinary Python/JS quoted braces are data; Ruby and shell quote interpolation is explicit.
            if (py !== undefined && !/[fF]/.test(prefix) && quote !== '`' && !whole.startsWith('${'))
              return whole;
            const value = evaluate(shell === undefined ? (py ?? ruby ?? '') : `$${shell}`, depth + 1);
            if (value.text === undefined) valid = false;
            // Text taken out of an argument keeps its origin when it is interpolated.
            carried = {
              ...carried,
              ...(value.flag ? { flag: true as const } : {}),
              ...(value.selected ? { selected: true as const } : {}),
            };
            return value.text ?? '';
          },
        );
        if (!valid) return unknown;
        return { text: body, ...carried };
      }
      return literal(body);
    }
    const formatted = /^(["'])((?:(?!\1)[^\\]|\\.)*)\1\.format\(([\s\S]*)\)$/.exec(text);
    if (formatted) {
      const values_ = split(formatted[3] ?? '', ',')
        .filter(Boolean)
        .map((arg) => evaluate(arg, depth + 1));
      let next = 0;
      let valid = true;
      const body = (formatted[2] ?? '').replace(/\{(\d*)\}/g, (_whole, index: string) => {
        const part = values_[index === '' ? next++ : Number(index)];
        if (part?.text === undefined) valid = false;
        return part?.text ?? '';
      });
      return valid
        ? { text: body, ...(values_.some((v) => v.flag) ? { flag: true as const } : {}) }
        : unknown;
    }
    const percent = /^(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*%\s*([\s\S]+)$/.exec(text);
    if (percent) {
      const part = evaluate((percent[3] ?? '').replace(/^\((.*),?\)$/, '$1'), depth + 1);
      if (part.text === undefined) return unknown;
      return {
        text: (percent[2] ?? '').replace(/%[sd]/, part.text),
        ...(part.flag ? { flag: true as const } : {}),
      };
    }
    const method =
      /^([\s\S]+)\.(strip|lstrip|rstrip|trim|trimStart|trimEnd|lower|upper|casefold|toLowerCase|toUpperCase|removesuffix|removeprefix|replace)\(([\s\S]*)\)$/.exec(
        text,
      );
    if (method) {
      const base = evaluate(method[1] ?? '', depth + 1);
      if (base.text === undefined) return unknown;
      const given = split(method[3] ?? '', ',')
        .filter(Boolean)
        .map((arg) => evaluate(arg, depth + 1).text);
      const raw = concrete(base);
      const chars = (set: string | undefined) => (set ?? '').replace(/[\\\]^-]/g, '\\$&');
      let out = raw;
      switch (method[2]) {
        case 'strip':
        case 'trim':
          out =
            given[0] === undefined
              ? raw.trim()
              : raw.replace(new RegExp(`^[${chars(given[0])}]+|[${chars(given[0])}]+$`, 'g'), '');
          break;
        case 'lstrip':
        case 'trimStart':
          out =
            given[0] === undefined ? raw.trimStart() : raw.replace(new RegExp(`^[${chars(given[0])}]+`), '');
          break;
        case 'rstrip':
        case 'trimEnd':
          out =
            given[0] === undefined ? raw.trimEnd() : raw.replace(new RegExp(`[${chars(given[0])}]+$`), '');
          break;
        case 'lower':
        case 'casefold':
        case 'toLowerCase':
          out = raw.toLowerCase();
          break;
        case 'upper':
        case 'toUpperCase':
          out = raw.toUpperCase();
          break;
        case 'removesuffix':
          out = given[0] && raw.endsWith(given[0]) ? raw.slice(0, -given[0].length) : raw;
          break;
        case 'removeprefix':
          out = given[0] && raw.startsWith(given[0]) ? raw.slice(given[0].length) : raw;
          break;
        default:
          if (given[0] === undefined || given[1] === undefined) return unknown;
          out = raw.split(given[0]).join(given[1]);
      }
      return {
        text: out,
        ...(sourced(base) ? { flag: true as const } : {}),
        ...(base.selected ? { selected: true as const } : {}),
      };
    }
    if (text.startsWith('(') && text.endsWith(')')) return evaluate(text.slice(1, -1), depth + 1);
    const parts = split(text, '+');
    if (parts.length > 1) {
      const parsed = parts.map((part) => evaluate(part, depth + 1));
      // A list followed by what the runner passes on (`+ rest`) still starts with its program and file.
      if (parsed[0]?.items !== undefined) return { items: parsed.flatMap((part) => part.items ?? []) };
      return combine(parsed);
    }
    const divisions = split(text, '/');
    if (divisions.length > 1)
      return combine(
        divisions.map((part) => evaluate(part, depth + 1)),
        '/',
      );
    if (text.startsWith('{') && text.endsWith('}')) {
      const table = new Map<string, Value>();
      for (const part of split(text.slice(1, -1), ',')) {
        const pair = part ? (splitWord(part, '=>') ?? splitWord(part, ':')) : undefined;
        if (!pair) continue;
        const key = evaluate(pair[0], depth + 1);
        if (key.text !== undefined) table.set(concrete(key).replace(/^:/, ''), evaluate(pair[1], depth + 1));
      }
      return { table };
    }
    if (text.startsWith('[') && text.endsWith(']')) {
      const items: Value[] = [];
      for (const part of split(text.slice(1, -1), ',')) {
        if (!part) continue;
        const spread = /^(?:\.\.\.|\*)(.+)/.exec(part);
        if (spread) items.push(...(evaluate(spread[1] ?? '', depth + 1).items ?? []));
        else items.push(evaluate(part, depth + 1));
      }
      return { items };
    }
    const parents = /^([\s\S]+)\.parents\[(\d+)\]$/.exec(text);
    if (parents) {
      const base = evaluate(parents[1] ?? '', depth + 1);
      if (base.text === undefined) return unknown;
      let folder = concrete(base);
      for (let level = 0; level <= Number(parents[2]); level++) folder = posix.dirname(folder);
      return { text: folder === '' ? '.' : folder, ...(sourced(base) ? { flag: true as const } : {}) };
    }
    const indexed = lastIndex(text);
    if (indexed) {
      const owner = evaluate(indexed[0], depth + 1);
      const collection = owner.items;
      const index = indexed[1].trim();
      if (owner.table) {
        // A table picks a value by the argument: the value is a script only if the estate holds that file.
        const key = evaluate(index, depth + 1);
        const hit = sourced(key) ? owner.table.get(concrete(key)) : undefined;
        return hit ? { ...hit, flag: true as const, selected: true as const } : unknown;
      }
      if (!collection) return unknown;
      const slice = /^(\d*)\s*:\s*(\d*)$/.exec(index);
      if (slice)
        return { items: collection.slice(Number(slice[1] || 0), slice[2] ? Number(slice[2]) : undefined) };
      if (/^\d+$/.test(index)) return collection[Number(index)] ?? unknown;
      const optionIndex =
        /^(?:sys\.argv|process\.argv|ARGV)\.(?:index|indexOf)\(\s*['"]([^'"]+)['"]\s*\)\s*\+\s*1$/.exec(
          index,
        );
      if (optionIndex) {
        const found = actual.indexOf(optionIndex[1] ?? '');
        return found < 0 ? unknown : marker(found + 1);
      }
      return unknown;
    }
    const parent = /^(.+)\.parent$/.exec(text);
    if (parent) {
      const base = evaluate(parent[1] ?? '', depth + 1);
      return base.text === undefined ? unknown : literal(posix.dirname(base.text));
    }
    const pathMethod = /^(.+)\.(resolve|absolute|joinpath)\(([\s\S]*)\)$/.exec(text);
    if (pathMethod) {
      const base = evaluate(pathMethod[1] ?? '', depth + 1);
      if (pathMethod[2] !== 'joinpath') return base;
      return combine(
        [
          base,
          ...split(pathMethod[3] ?? '', ',')
            .filter(Boolean)
            .map((arg) => evaluate(arg, depth + 1)),
        ].filter((part) => part.text !== ''),
        '/',
      );
    }
    const call = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(([\s\S]*)\)$/.exec(text);
    if (call) {
      const name = call[1] ?? '';
      const args = split(call[2] ?? '', ',');
      if (/\.parse_known_args$/.test(name)) return { items: [{ arguments: true }, unknown] };
      if (/\.parse_args$/.test(name)) return { arguments: true };
      if (/\.pop$/.test(name) && /^\d+$/.test(args[0] ?? ''))
        return evaluate(name.replace(/\.pop$/, ''), depth + 1).items?.[Number(args[0])] ?? unknown;
      if (/\.get$/.test(name)) {
        const owner = evaluate(name.replace(/\.get$/, ''), depth + 1);
        if (owner.table) return evaluate(`${name.replace(/\.get$/, '')}[${args[0] ?? ''}]`, depth + 1);
      }
      if (/(?:^|\.)(?:dirname|basename)$/.test(name)) {
        const base = evaluate(args[0] ?? '', depth + 1);
        if (base.text === undefined) return unknown;
        const folder = /dirname$/.test(name) ? posix.dirname(concrete(base)) : posix.basename(concrete(base));
        return { text: folder === '' ? '.' : folder, ...(sourced(base) ? { flag: true as const } : {}) };
      }
      if (/(?:^|\.)(?:abspath|realpath|normpath|expanduser|expandvars|fspath)$/.test(name))
        return evaluate(args[0] ?? '', depth + 1);
      if (/^(?:os\.getcwd|(?:pathlib\.)?Path\.(?:cwd|home))$/.test(name)) return literal('.');
      if (/\.(?:slice|drop)$/.test(name)) {
        const list = evaluate(name.replace(/\.(?:slice|drop)$/, ''), depth + 1).items;
        return list
          ? { items: list.slice(Number(args[0] ?? 0), args[1] ? Number(args[1]) : undefined) }
          : unknown;
      }
      if (/^(?:str|String|Path|pathlib\.Path|File\.expand_path)$/.test(name))
        return evaluate(args[0] ?? '', depth + 1);
      if (/(?:^|\.)(?:join|joinpath|resolve)$/.test(name)) {
        const owner = name.replace(/\.(?:join|joinpath|resolve)$/, '');
        const base = values.get(owner);
        return combine(
          [
            ...(base?.text !== undefined ? [base] : []),
            ...args.map((arg) => evaluate(arg, depth + 1)),
          ].filter((part) => part.text !== ''),
          '/',
        );
      }
      if (name === 'importlib.util.spec_from_file_location') return evaluate(args[1] ?? '', depth + 1);
      if (name === 'importlib.util.module_from_spec') return evaluate(args[0] ?? '', depth + 1);
      if (/\.(?:with_suffix)$/.test(name)) {
        const base = evaluate(name.slice(0, name.lastIndexOf('.')), depth + 1);
        const suffix = evaluate(args[0] ?? '', depth + 1);
        return base.text === undefined || suffix.text === undefined
          ? unknown
          : literal(base.text.replace(/\.[\w]+$/, '') + suffix.text);
      }
      return unknown;
    }
    return identifier.test(text) ? (values.get(text) ?? unknown) : unknown;
  };
  const target = (value: Value, allowSpaces = true): string | undefined => {
    if (!sourced(value)) return undefined;
    const text = concrete(value);
    if (text === '' || text.startsWith('-') || (!allowSpaces && /\s/.test(text))) return undefined;
    state.existing = value.selected === true;
    return posix.normalize(text);
  };
  /** A module name is a path with dots for folders: `guards.tone` is `guards/tone`. */
  const moduleTarget = (value: Value): string | undefined => {
    if (!sourced(value)) return undefined;
    const text = concrete(value).replace(/^\.+/, '');
    if (text === '' || text.startsWith('-') || /\s/.test(text)) return undefined;
    state.existing = value.selected === true;
    return posix.normalize(/[\\/]/.test(text) ? text : text.replace(/\./g, '/'));
  };
  const executable = (value: Value): string | undefined => {
    const args =
      value.items ??
      (value.text === undefined
        ? []
        : (value.text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((word) =>
            literal(word.replace(/^['"]|['"]$/g, '')),
          ));
    const program = args[0];
    const head = posix.basename(program ? concrete(program) : '');
    if (interpreter.test(head)) {
      // Interpreter flags may precede the file, but code passed with -c/-e is not a file.
      let at = 1;
      while (args[at]?.text?.startsWith('-')) {
        if (args[at]?.text === '-m') return moduleTarget(args[at + 1] ?? unknown);
        if (/^-(?:c|e)$/.test(args[at]?.text ?? '')) return undefined;
        at++;
      }
      return target(args[at] ?? unknown, value.items !== undefined);
    }
    return target(program ?? unknown, value.items !== undefined);
  };
  const statements = split(code, ';', true);
  for (let statement of statements) {
    statement = statement.trim();
    const assigned = /^(?:(?:const|let|var)\s+)?([\w$*,.\s]+|\[[^\]]+\])\s*=\s*([^=][\s\S]*)$/.exec(
      statement,
    );
    if (assigned) {
      const left = (assigned[1] ?? '').replace(/^\[|\]$/g, '').trim();
      const value = evaluate(assigned[2] ?? '');
      const names = left.split(',').map((name) => name.trim());
      if (names.length > 1) {
        names.forEach((name, index) => {
          values.set(
            name.replace(/^\.\.\.|^\*/, ''),
            name.startsWith('*') || name.startsWith('...')
              ? { items: value.items?.slice(index) ?? [] }
              : (value.items?.[index] ?? unknown),
          );
        });
      } else values.set(left.replace(/^\$/, ''), value);
    }
    for (const call of calls(statement)) {
      const args = call.args.map((arg) => evaluate(arg));
      if (
        /^(?:(?:runpy\.)?run_path|require|require_relative|import|load|execFileSync|execFile|spawnSync|spawn|os\.execv|os\.execve)$/.test(
          call.name,
        )
      ) {
        const found = target(args[0] ?? unknown);
        if (found) return found;
        if (/^(?:execFile|spawn)/.test(call.name) && interpreter.test(args[0]?.text ?? '')) {
          const run = executable({ items: [args[0] ?? unknown, ...(args[1]?.items ?? [])] });
          if (run) return run;
        }
      }
      if (
        /^(?:subprocess\.(?:run|call|Popen|check_call|check_output)|os\.system|child_process\.exec(?:Sync)?)$/.test(
          call.name,
        )
      ) {
        const found = executable(args[0] ?? unknown);
        if (found) return found;
      }
      if (/^os\.(?:execv|execve|execvp|execvpe|spawnv|spawnve|spawnvp|spawnvpe)$/.test(call.name)) {
        const list = args.find((arg) => arg.items);
        const run = list ? executable(list) : undefined;
        if (run) return run;
      }
      if (/^(?:importlib\.import_module|import_module|__import__|(?:runpy\.)?run_module)$/.test(call.name)) {
        const found = moduleTarget(args[0] ?? unknown);
        if (found) return found;
      }
      if (/^(?:exec|execfile)$/.test(call.name)) {
        const inner = call.args[0] ?? '';
        const named =
          /\bcompile\(\s*[^,]+,\s*([^,]+),/.exec(inner)?.[1] ??
          /\bopen\(\s*([^,)]+)/.exec(inner)?.[1] ??
          /([\w$.]+)\.read_text\(/.exec(inner)?.[1];
        const found = named === undefined ? undefined : target(evaluate(named));
        if (found) return found;
      }
      if (/\.exec_module$/.test(call.name)) {
        const found = target(args[0] ?? unknown);
        if (found) return found;
      }
    }
    const ruby = /^(?:load|require|require_relative)\s+(.+)$/.exec(statement);
    if (ruby) {
      const found = target(evaluate(ruby[1] ?? ''));
      if (found) return found;
    }
    const shell = /^(?:exec\s+|source\s+|\.\s+)?(.+)$/.exec(statement);
    if (!assigned && shell && /^(?:exec\s|source\s|\.\s)|^#![^\n]*sh/m.test(source)) {
      // A command substitution (`$(dirname "$0")`) names a folder: it stands for the script's own.
      const line = (shell[1] ?? '').replace(/\$\((?:[^()]|\([^()]*\))*\)|`[^`]*`/g, '.');
      const words = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      const found = executable({
        items: words.map((word) =>
          evaluate(/^['"]/.test(word) ? word : /\$/.test(word) ? `"${word}"` : JSON.stringify(word)),
        ),
      });
      if (found) return found;
    }
  }
  return undefined;
}

/** Usage contracts bind an argument to an executable noun phrase or to its concrete path pattern. */
function documentedTarget(source: string, actual: readonly string[]): string | undefined {
  const text = source.replace(/["'`]/g, '');
  const placeholderPattern = /(?:<([\w-]+)>|\{([\w-]+)\})/g;
  const pathPattern = /(?:[\w./-]+\/)?(?:<([\w-]+)>|\{([\w-]+)\})\.(?:py|rb|js|mjs|cjs|ts|sh|bash)\b/g;
  const paths = [...text.matchAll(pathPattern)].filter((path) => {
    const before = text.slice(Math.max(0, (path.index ?? 0) - 120), path.index);
    // An input/configuration filename is not an entry point merely because it ends in a script suffix.
    return /(?:entry\s*point|executable(?:\s+(?:script|file))?|hook(?:\s+(?:script|file))?|executed\s+(?:script|file))\s*(?:(?:is|at|path|file)\s*|:\s*)*$/i.test(
      before,
    );
  });
  for (const usage of text.matchAll(/\busage\s*:\s*([^\n]+)/gi)) {
    const signature = (usage[1] ?? '').split(/\.\s/)[0] ?? '';
    const parameters = [...signature.matchAll(placeholderPattern)].map((parameter) => ({
      name: parameter[1] ?? parameter[2] ?? '',
      flag: /(--[\w-]+)\s*$/.exec(signature.slice(0, parameter.index))?.[1],
    }));
    const valuedFlags = new Set(parameters.flatMap((parameter) => (parameter.flag ? [parameter.flag] : [])));
    const positionalValues: string[] = [];
    for (let index = 0; index < actual.length; index++) {
      const word = actual[index] ?? '';
      if (valuedFlags.has(word)) index++;
      else if (!word.startsWith('-')) positionalValues.push(word);
    }
    let position = 0;
    for (const parameter of parameters) {
      let raw: string | undefined;
      if (parameter.flag) {
        const index = actual.findIndex(
          (word) => word === parameter.flag || word.startsWith(`${parameter.flag}=`),
        );
        if (index >= 0)
          raw = actual[index]?.startsWith(`${parameter.flag}=`)
            ? actual[index]?.slice(parameter.flag.length + 1)
            : actual[index + 1];
      } else raw = positionalValues[position++];
      if (raw === undefined || raw.startsWith('-')) continue;
      for (const path of paths) {
        if ((path[1] ?? path[2]) !== parameter.name) continue;
        return path[0].replace(new RegExp(`(?:<|\\{)${parameter.name}(?:>|\\})`), raw);
      }
    }
  }
  // Here the role is a noun phrase attached to its selector, not a coincidence of the words "script"
  // and "argument". Sentence predicates may vary; there is no leading dispatch-verb vocabulary.
  const role = '(?:script(?:\\s+file)?|hook(?:\\s+script)?|executable(?:\\s+file)?|entry\\s*point)';
  const selector = '(?:first\\s+(?:positional\\s+)?argument|argument\\s+\\d+|--[\\w-]+)';
  const relation = new RegExp(
    `${role}\\s+(?:(?:that\\s+is|is)\\s+)?(?:\\w+(?:ed|en)\\s+)?(?:by|from|with|using|via|as)\\s+(?:(?:the|its)\\s+)?(${selector})` +
      `|(${selector})\\s+(?:(?:argument|option|parameter)\\s+)?(?:is|names?|identifies?|selects?|specifies?)\\s+(?:(?:the|a|an)\\s+)?${role}`,
    'i',
  );
  for (const sentence of text.split(/[\n.!?]/)) {
    if (/\b(?:not|never|cannot|cant|doesnt)\b/i.test(sentence)) continue;
    const selected = relation.exec(sentence);
    const input = selected?.[1] ?? selected?.[2];
    if (input === undefined) continue;
    if (input.startsWith('--')) {
      const index = actual.findIndex((word) => word === input || word.startsWith(`${input}=`));
      const word = index < 0 ? undefined : actual[index];
      const value = word?.startsWith(`${input}=`) ? word.slice(input.length + 1) : actual[index + 1];
      if (index >= 0 && value && !value.startsWith('-')) return value;
    } else {
      const position = /\d+/.exec(input)?.[0];
      const value = actual[Number(position ?? 1) - 1];
      return value && !value.startsWith('-') ? value : undefined;
    }
  }
  return undefined;
}

/** `existing`: the path was picked out of a table, so it names a script only if the estate holds that file. */
export function dispatchedScript(
  source: string,
  actual: readonly string[],
): { path: string; existing: boolean } | undefined {
  const state = { existing: false };
  const found = codeTarget(source, actual, state);
  if (found !== undefined) return { path: found, existing: state.existing };
  const documented = documentedTarget(source, actual);
  return documented === undefined ? undefined : { path: documented, existing: false };
}
