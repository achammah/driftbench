import { describe, expect, it } from 'vitest';
import { holds, isSubset, jsonEqual, parseAssertion } from '../src/assertion';
import { matchList } from '../src/match';
import { resolvePart } from '../src/opc';
import { attribute, childElements, decodeEntities, descendants, parseXml, XmlError } from '../src/xml';

describe('xml', () => {
  it('reads elements, attributes, text, entities, CDATA and skips comments and declarations', () => {
    const root = parseXml(
      '﻿<?xml version="1.0"?><!DOCTYPE x><!-- note --><p:sld xmlns:p="urn:p" a=\'1 &amp; 2\'>' +
        '<p:t>A &lt;b&gt; &#65;&#x42;</p:t><p:t><![CDATA[<raw>]]></p:t><p:e r:id="rId2" id="7"/></p:sld>',
    );
    expect(root.name).toBe('p:sld');
    expect(root.local).toBe('sld');
    expect(root.attrs.a).toBe('1 & 2');
    expect(descendants(root, 't').map((t) => t.children.join(''))).toEqual(['A <b> AB', '<raw>']);
    const [entry] = childElements(root, 'e');
    expect(attribute(entry, 'id', true)).toBe('rId2');
    expect(attribute(entry, 'id', false)).toBe('7');
    expect(attribute(entry, 'missing')).toBeUndefined();
  });

  it('keeps unknown entities as written', () => {
    expect(decodeEntities('a &nbsp; b &#xFFFFFFF;')).toBe('a &nbsp; b &#xFFFFFFF;');
  });

  it('refuses malformed documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlError);
    expect(() => parseXml('<a>')).toThrow('<a> is never closed');
    expect(() => parseXml('<a/><b/>')).toThrow('more than one root element');
    expect(() => parseXml('')).toThrow('no root element');
    expect(() => parseXml('<a b=c/>')).toThrow('is not quoted');
  });
});

describe('package parts', () => {
  it('resolves relationship targets against the folder of the part', () => {
    expect(resolvePart('ppt', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
    expect(resolvePart('ppt/slides', '../media/image1.png')).toBe('ppt/media/image1.png');
    expect(resolvePart('word', '/word/document.xml')).toBe('word/document.xml');
    expect(resolvePart('', 'word/./document.xml')).toBe('word/document.xml');
  });
});

describe('assertions', () => {
  const present = (value: unknown) => ({ present: true, value });

  it('reads every form of the spec assertion and refuses anything else', () => {
    for (const form of [
      'x',
      1,
      true,
      null,
      { exact: [1] },
      { regex: '^a' },
      { contains: 'a' },
      { one_of: [1, 2] },
      { nonempty: true },
      { absent: true },
      { subset: { a: 1 } },
    ]) {
      expect(parseAssertion(form, 'value')).toBe(form);
    }
    for (const bad of [
      [1],
      { regex: '(' },
      { nonempty: false },
      { one_of: [] },
      { exact: 1, regex: 'a' },
      { equals: 1 },
      Number.NaN,
    ]) {
      expect(() => parseAssertion(bad, 'value')).toThrow();
    }
  });

  it('holds with the meaning each form has in the spec', () => {
    expect(holds('a', present('a'), jsonEqual)).toBe(true);
    expect(holds({ exact: { a: [1] } }, present({ a: [1] }), jsonEqual)).toBe(true);
    expect(holds({ exact: { a: [1] } }, present({ a: [1], b: 2 }), jsonEqual)).toBe(false);
    expect(holds({ regex: '^4' }, present(42), jsonEqual)).toBe(true);
    expect(holds({ regex: '.' }, present({ a: 1 }), jsonEqual)).toBe(false);
    expect(holds({ contains: 'Mobile' }, present('Acme Mobile S'), jsonEqual)).toBe(true);
    expect(holds({ one_of: ['a', 'b'] }, present('b'), jsonEqual)).toBe(true);
    expect(holds({ nonempty: true }, present('  '), jsonEqual)).toBe(false);
    expect(holds({ nonempty: true }, present([]), jsonEqual)).toBe(false);
    expect(holds({ nonempty: true }, present(0), jsonEqual)).toBe(true);
    // docs/reference/checks.md "Assertions on values": not a mapping whose keys hold nothing.
    expect(holds({ nonempty: true }, present({ a: '' }), jsonEqual)).toBe(false);
    expect(holds({ nonempty: true }, present({ a: null, b: [] }), jsonEqual)).toBe(false);
    expect(holds({ nonempty: true }, present({ a: { b: ' ' } }), jsonEqual)).toBe(false);
    expect(holds({ nonempty: true }, present({ a: '', b: 'x' }), jsonEqual)).toBe(true);
    expect(holds({ nonempty: true }, present({ a: 0 }), jsonEqual)).toBe(true);
    expect(holds({ absent: true }, { present: false, value: undefined }, jsonEqual)).toBe(true);
    expect(holds({ absent: true }, present(null), jsonEqual)).toBe(false);
    expect(holds(null, { present: false, value: undefined }, jsonEqual)).toBe(false);
  });

  it('treats subset as at least these keys, nested mappings as subsets and lists item by item', () => {
    expect(isSubset({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(isSubset({ a: { b: 1 } }, { a: { b: 1, c: 2 } })).toBe(true);
    expect(isSubset({ a: [{ b: 1 }] }, { a: [{ b: 1, c: 2 }] })).toBe(true);
    expect(isSubset({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(isSubset({ a: null }, {})).toBe(false);
    expect(isSubset({ a: 1 }, [1])).toBe(false);
  });
});

describe('list matching', () => {
  const test = (want: unknown, item: string) =>
    holds(parseAssertion(want, 'x'), { present: true, value: item }, jsonEqual);
  const show = (item: string) => JSON.stringify(item);

  it('exact wants the same items in the same order and nothing else', () => {
    expect(matchList(['a', 'b'], ['a', 'b'], 'exact', test, show)).toEqual([]);
    expect(matchList(['a'], ['a', 'b'], 'exact', test, show)).toEqual(['1 more than expected: "b"']);
    expect(matchList(['a', 'b'], ['b', 'a'], 'exact', test, show)).toEqual([
      'item 1 is "b", expected "a"',
      'item 2 is "a", expected "b"',
    ]);
  });

  it('in_order lets other items sit between, and tells out of order from missing', () => {
    expect(matchList(['a', 'c'], ['a', 'b', 'c'], 'in_order', test, show)).toEqual([]);
    expect(matchList(['c', 'a'], ['a', 'b', 'c'], 'in_order', test, show)).toEqual([
      '"a" is out of order: expected after "c"',
    ]);
    expect(matchList(['a', 'a'], ['a', 'b'], 'in_order', test, show)).toEqual(['missing "a"']);
    expect(matchList(['d'], ['a'], 'in_order', test, show)).toEqual(['missing "d"']);
  });

  it('any_order gives each expected item its own found item, even when patterns overlap', () => {
    expect(matchList([{ regex: 'a' }, 'ab'], ['ab', 'a'], 'any_order', test, show)).toEqual([]);
    expect(matchList(['a', 'a'], ['a'], 'any_order', test, show)).toEqual(['missing "a"']);
  });
});
