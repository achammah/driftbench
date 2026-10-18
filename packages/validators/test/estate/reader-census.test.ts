import { describe, expect, it } from 'vitest';
import { blockOptionReads, codeMatches, codeView, textMatches } from './reader-census';

// Hand-written sources. None is a line of the repository: the census must judge any module by what the code does.

const OLD_PATTERN = /\b(options|opts|entry)\.block\b/;

describe('codeView keeps code and blanks what is not code', () => {
  it('blanks comments, string literals and regular expressions, and keeps the length and the line breaks', () => {
    const text = [
      'const a = options.block; // opts.block in a comment',
      '/* entry.block',
      '   in a block comment */',
      "const b = 'opts.block in a string';",
      'const c = "entry.block in a string";',
      'const d = /options\\.block/.test(x);',
      'const e = 1 / 2 / 3;',
    ].join('\n');
    const view = codeView(text);
    expect(view).toHaveLength(text.length);
    expect(view.split('\n')).toHaveLength(text.split('\n').length);
    expect(codeMatches(text, OLD_PATTERN)).toEqual(['const a = options.block; // opts.block in a comment']);
    expect(view).toContain('const e = 1 / 2 / 3;');
  });

  it('blanks the text of a template and keeps the expressions inside it, nested ones included', () => {
    const text = [
      'const a = `text opts.block ${entry.block} and ${`inner ${options.block}`} tail opts.block`;',
      'const b = `a ${ {x: 1}.x } entry.block`;',
    ].join('\n');
    const lines = codeMatches(text, /\bentry\.block\b/);
    expect(lines).toEqual([text.split('\n')[0]]);
    expect(codeMatches(text, /\bopts\.block\b/)).toEqual([]);
    expect(codeMatches(text, /\boptions\.block\b/)).toEqual([text.split('\n')[0]]);
  });

  it('keeps the literal text when the census asks for it, comments still left out', () => {
    const text = ['// the driver asked for block 3', 'const m = `the driver asked for block ${n}`;'].join(
      '\n',
    );
    expect(textMatches(text, /the driver asked for block/)).toEqual([
      'const m = `the driver asked for block ${n}`;',
    ]);
  });
});

describe('blockOptionReads finds the reads of a custom check block option by what the receiver is bound to', () => {
  const module = (body: string) =>
    [
      "import type { CustomCheckFunction } from './types';",
      'declare const isRecord: (v: unknown) => v is Record<string, unknown>;',
      body,
    ].join('\n');

  it('counts the options argument, a value derived from it, and a parameter that receives one', () => {
    const lines = blockOptionReads(
      module(
        [
          'export const alpha: CustomCheckFunction = (ctx, options) => {',
          "  if (typeof options.block === 'number' && options.block !== ctx.blockIndex) return [];",
          '  const opts = isRecord(options) ? options : {};',
          '  const own = opts.block;',
          '  const rows = (options.rows as unknown[]).map(parseRow);',
          '  [].forEach(() => 0);',
          '  return [];',
          '};',
          'function parseRow(entry: Record<string, unknown>) {',
          '  return entry.block;',
          '}',
        ].join('\n'),
      ),
    );
    expect(lines).toEqual([
      "if (typeof options.block === 'number' && options.block !== ctx.blockIndex) return [];",
      'const own = opts.block;',
      'return entry.block;',
    ]);
  });

  it('counts the options of a function a factory declares to return a custom check, and a callback over derived values', () => {
    const lines = blockOptionReads(
      module(
        [
          'export function make(strict: boolean): CustomCheckFunction {',
          '  return async (ctx, options) => {',
          '    const rules = (options as { rules: Array<{ block?: number }> }).rules;',
          '    rules.forEach((entry) => { if (entry.block !== undefined) strict; });',
          '    if (options.block !== undefined) return [];',
          '    return [];',
          '  };',
          '}',
        ].join('\n'),
      ),
    );
    expect(lines).toEqual([
      'rules.forEach((entry) => { if (entry.block !== undefined) strict; });',
      'if (options.block !== undefined) return [];',
    ]);
  });

  it('does not count a filter over findings whose parameter is called entry', () => {
    const body = [
      'export const beta: CustomCheckFunction = (ctx, options) => {',
      '  const mine = findings.filter((entry) => entry.block === ctx.blockIndex);',
      '  return mine.map(() => options.label);',
      '};',
      'declare const findings: Array<{ block: number }>;',
    ].join('\n');
    expect(blockOptionReads(module(body))).toEqual([]);
    // The lexical census this replaces counted it.
    expect(codeMatches(body, OLD_PATTERN)).toEqual([
      'const mine = findings.filter((entry) => entry.block === ctx.blockIndex);',
    ]);
  });

  it('does not count a module that declares no custom check, whatever its parameters are called', () => {
    const body = [
      'export function pick(entries: Array<{ block: number }>, options: { block: number }) {',
      '  return entries.filter((entry) => entry.block === options.block);',
      '}',
    ].join('\n');
    expect(blockOptionReads(body)).toEqual([]);
    expect(codeMatches(body, OLD_PATTERN)).toHaveLength(1);
  });

  it('does not count a comment or a string that names a read', () => {
    const body = [
      'export const gamma: CustomCheckFunction = (ctx, options) => {',
      '  // a read of options.block would go here',
      "  const message = 'options.block is not read';",
      '  const text = `opts.block ${ctx.blockIndex}`;',
      '  return [message, text].map(() => options.label);',
      '};',
    ].join('\n');
    expect(blockOptionReads(module(body))).toEqual([]);
    expect(textMatches(body, OLD_PATTERN).length).toBeGreaterThan(0);
  });

  it('counts a bracket read of the option and an optional-chain read', () => {
    const lines = blockOptionReads(
      module(
        [
          'export const delta: CustomCheckFunction = (ctx, options) => {',
          "  const a = options['block'];",
          '  const b = options?.block;',
          '  return [];',
          '};',
        ].join('\n'),
      ),
    );
    expect(lines).toEqual(["const a = options['block'];", 'const b = options?.block;']);
  });

  describe('roots a check from the way it reaches the registry, not from an annotation', () => {
    const preamble = [
      "import type { CustomCheckFunction } from './types';",
      'declare function registerCheck(name: string, check: CustomCheckFunction): void;',
      'declare const registry: { register(name: string, check: CustomCheckFunction): void };',
    ].join('\n');
    const reads = (body: string) => blockOptionReads(`${preamble}\n${body}`);

    it('counts an inline entry of an object typed to hold custom checks, shorthand and method forms included', () => {
      expect(
        reads(
          [
            'function plain(ctx: unknown, options: any) { return options.block; }',
            'const shared = (ctx: unknown, options: any) => options.block;',
            'export const CHECKS: Readonly<Record<string, CustomCheckFunction>> = {',
            '  inline: (ctx, options: any) => (options.block === 1 ? [] : []),',
            '  plain,',
            '  alias: shared,',
            '  method(ctx, options: any) { return options.block; },',
            '};',
          ].join('\n'),
        ),
      ).toEqual([
        'function plain(ctx: unknown, options: any) { return options.block; }',
        'const shared = (ctx: unknown, options: any) => options.block;',
        'inline: (ctx, options: any) => (options.block === 1 ? [] : []),',
        'method(ctx, options: any) { return options.block; },',
      ]);
    });

    it('counts a function given to a registering call: an arrow, a plain function, a method call', () => {
      expect(
        reads(
          [
            "registerCheck('a', (ctx, options: any) => (options.block === 1 ? [] : []));",
            'function named(ctx: unknown, options: any) { return options.block; }',
            "registry.register('b', named);",
          ].join('\n'),
        ),
      ).toEqual([
        "registerCheck('a', (ctx, options: any) => (options.block === 1 ? [] : []));",
        'function named(ctx: unknown, options: any) { return options.block; }',
      ]);
    });

    it('counts a function that satisfies or is cast to a custom check', () => {
      expect(
        reads(
          [
            'export const one = ((ctx, options: any) => options.block) satisfies CustomCheckFunction;',
            'export const two = ((ctx: unknown, options: any) => options.block) as CustomCheckFunction;',
            'export const REG = { three: (ctx, options: any) => options.block } satisfies Record<string, CustomCheckFunction>;',
          ].join('\n'),
        ),
      ).toEqual(
        [
          'export const one = ((ctx, options: any) => options.block) satisfies CustomCheckFunction;',
          'export const two = ((ctx: unknown, options: any) => options.block) as CustomCheckFunction;',
        ].concat(
          'export const REG = { three: (ctx, options: any) => options.block } satisfies Record<string, CustomCheckFunction>;',
        ),
      );
    });

    it('counts a read through a cast receiver and through a binding pattern', () => {
      expect(
        reads(
          [
            'export const cast: CustomCheckFunction = (ctx, options) => {',
            '  const a = (options as { block?: number }).block;',
            '  const { block } = options as { block?: number };',
            '  const { block: renamed } = options as { block?: number };',
            '  return [a, block, renamed].map(() => options.label);',
            '};',
          ].join('\n'),
        ),
      ).toEqual([
        'const a = (options as { block?: number }).block;',
        'const { block } = options as { block?: number };',
        'const { block: renamed } = options as { block?: number };',
      ]);
    });

    it('still ignores a function that never reaches the registry', () => {
      expect(
        reads(
          [
            'export const loose = (ctx: unknown, options: any) => options.block;',
            'const filter = (entry: { block: number }) => entry.block;',
            "registerCheck('x', (ctx, options: any) => options.label);",
          ].join('\n'),
        ),
      ).toEqual([]);
    });
  });
});
