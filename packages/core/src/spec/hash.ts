import { createHash, type Hash } from 'node:crypto';

/** JSON with object keys sorted at every depth, so equal content gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = sortKeys(child);
    }
    return out;
  }
  return value;
}

/** The first 12 hex characters of the SHA-256 of the canonical JSON. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 12);
}

/**
 * A deep copy of JSON-shaped data. Plain objects, arrays and primitives are copied by hand, which costs a
 * fraction of `structuredClone`; any other value (a Date, a Map, a class instance) goes to `structuredClone`.
 */
export function cloneJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) out[index] = cloneJson(value[index]);
    return out as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return structuredClone(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = cloneJson((value as Record<string, unknown>)[key]);
  return out as T;
}

const canonicalOfItem = new WeakMap<object, string>();
const canonicalOfList = new WeakMap<readonly unknown[], string>();

/**
 * The canonical JSON of a list, as `canonicalJson` writes it, with the text of each object item read once
 * for the life of the item. A caller promises not to change an item after it joined a list given here, so a
 * history that grows by one message per block costs one new text per block, not one per message. The text
 * of a list is read once as well: the list is read-only once it is given here.
 */
export function canonicalList(items: readonly unknown[]): string {
  const known = canonicalOfList.get(items);
  if (known !== undefined) return known;
  const parts = new Array<string>(items.length);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === null || typeof item !== 'object') {
      parts[index] = canonicalJson(item === undefined ? null : item);
      continue;
    }
    let text = canonicalOfItem.get(item);
    if (text === undefined) {
      text = canonicalJson(item);
      canonicalOfItem.set(item, text);
    }
    parts[index] = text;
  }
  const text = `[${parts.join(',')}]`;
  canonicalOfList.set(items, text);
  return text;
}

/**
 * `canonicalJson` of an object whose `listKey` field is a list, with that list written by `canonicalList`.
 * The text is the one `canonicalJson` gives for the same value.
 */
export function canonicalJsonWithList(value: Record<string, unknown>, listKey: string): string {
  const fields: string[] = [];
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child === undefined) continue;
    const text = key === listKey && Array.isArray(child) ? canonicalList(child) : canonicalJson(child);
    fields.push(`${JSON.stringify(key)}:${text}`);
  }
  return `{${fields.join(',')}}`;
}

/**
 * Read-only lists made by appending to another read-only list, child to parent. A frozen list never changes, so
 * a child that names its parent starts with exactly the parent's items: the prefix test is a short walk up this
 * chain, not a comparison of every item.
 */
const extensionOf = new WeakMap<readonly unknown[], readonly unknown[]>();

/** Records that the frozen list `child` is the frozen list `parent` with items appended. */
export function noteExtension(parent: readonly unknown[], child: readonly unknown[]): void {
  if (Object.isFrozen(parent) && Object.isFrozen(child) && child.length >= parent.length) {
    extensionOf.set(child, parent);
  }
}

type Running = { head: string; items: readonly unknown[]; state: Hash; text: string };
const running: Running[] = [];
const RUNNING_KEPT = 8;

function itemText(item: unknown): string {
  if (item === null || typeof item !== 'object') return canonicalJson(item === undefined ? null : item);
  let text = canonicalOfItem.get(item);
  if (text === undefined) {
    text = canonicalJson(item);
    canonicalOfItem.set(item, text);
  }
  return text;
}

/** Whether `items` starts with every item of `entry`, the same objects in the same order. */
function isPrefixOf(entry: Running, items: readonly unknown[]): boolean {
  if (entry.items.length > items.length) return false;
  if (entry.items === items) return true;
  if (Object.isFrozen(entry.items) && Object.isFrozen(items)) {
    let list: readonly unknown[] | undefined = items;
    while (list !== undefined && list.length > entry.items.length) list = extensionOf.get(list);
    if (list === entry.items) return true;
  }
  for (let index = 0; index < entry.items.length; index += 1) {
    if (entry.items[index] !== items[index]) return false;
  }
  return true;
}

/**
 * The SHA-256 (hex) of `head + [items] + tail`, where the items are written as `canonicalList` writes them.
 * The digest state after a list is kept, so the next call with the same head and the same items plus more
 * hashes only the new ones: a history that grows by a message per block costs one message per block. The
 * text of the list is kept too, so a call under another head (a ledger that changed, another block
 * position) reads only the new items again; it hashes the whole text, which costs bytes, not item reads.
 */
export function sha256WithList(head: string, items: readonly unknown[], tail: string): string {
  let from: Running | undefined;
  let textFrom: Running | undefined;
  for (const entry of running) {
    if (!isPrefixOf(entry, items)) continue;
    if (entry.head === head && (from === undefined || entry.items.length > from.items.length)) from = entry;
    if (textFrom === undefined || entry.items.length > textFrom.items.length) textFrom = entry;
  }
  let state: Hash;
  let text: string;
  let start: number;
  if (from) {
    state = from.state.copy();
    text = from.text;
    start = from.items.length;
  } else {
    state = createHash('sha256');
    state.update(`${head}[`);
    text = textFrom ? textFrom.text : '';
    if (text !== '') state.update(text);
    start = textFrom ? textFrom.items.length : 0;
  }
  let added = '';
  for (let index = start; index < items.length; index += 1) {
    added += index === 0 ? itemText(items[index]) : `,${itemText(items[index])}`;
  }
  if (added !== '') state.update(added);
  text += added;
  // A frozen list is kept as it is; any other is copied, as a caller may change it later.
  const entry: Running = { head, items: Object.isFrozen(items) ? items : [...items], state, text };
  running.unshift(entry);
  if (running.length > RUNNING_KEPT) running.length = RUNNING_KEPT;
  return state.copy().update(`]${tail}`).digest('hex');
}

const LIST_MARK = '\u0000list\u0000';

/**
 * `sha256(canonicalJson(value))` where `value` holds, at `path`, a list that grows from one call to the next.
 * `place` returns the value with the list replaced by a mark; the text is split at the mark.
 */
export function sha256OfJsonWithList(place: (mark: string) => unknown, items: readonly unknown[]): string {
  const [head, tail] = canonicalJson(place(LIST_MARK)).split(JSON.stringify(LIST_MARK));
  // A list that was never in the value would not split: fall back to the plain digest.
  if (head === undefined || tail === undefined) {
    return createHash('sha256')
      .update(canonicalJson(place(items as unknown as string)))
      .digest('hex');
  }
  return sha256WithList(head, items, tail);
}

/** `contentHash` of an object whose `listKey` field is a list, without re-reading the items of the list. */
export function contentHashWithList(value: Record<string, unknown>, listKey: string): string {
  const list = value[listKey];
  if (!Array.isArray(list)) return contentHash(value);
  return sha256OfJsonWithList((mark) => ({ ...value, [listKey]: mark }), list).slice(0, 12);
}
