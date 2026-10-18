/** A glob of the ignore list and its test on a path relative to the estate root. */
export type IgnoreRule = { pattern: string; test(path: string): boolean };

/** A `.gitignore`-like glob: match at any depth unless anchored, and match a folder whole. */
export function ignoreRule(pattern: string): IgnoreRule {
  const anchored = pattern.startsWith('/');
  const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  let source = '';
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? '';
    if (body.startsWith('**/', index)) {
      source += '(?:[^/]+/)*';
      index += 2;
    } else if (body.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`${anchored ? '^' : '(?:^|/)'}${source}(?:/|$)`);
  return { pattern, test: (path) => regex.test(path) };
}
