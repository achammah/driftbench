/**
 * The reference unit sampler of the scale items: `node --import tsx scale-unit.ts [idle]`. It repeats one fixed
 * piece of work until its standard input closes, and prints one line per unit: the wall-clock time the unit ended,
 * in milliseconds since the epoch, and the CPU time it took (user plus system), in milliseconds. Between two units
 * it sleeps `idle` times the unit's wall time (4 by default), so it takes about a fifth of one core.
 *
 * The work is the generator's kind of work, in JavaScript and in memory: it builds small spec-like objects, writes
 * each as indented text, parses the text back into objects, counts keys in a Map, and round-trips the result
 * through JSON. It reads and writes no file, so the cost of a file system, which differs from host to host far
 * more than the cost of JavaScript, never decides the unit. It uses only the language and Node built-ins, never
 * driftbench code, so a change to the product never changes it. The scale child runs it beside its measured
 * window (docs/validators.md, "The reference unit of the generator's scale items").
 */

// A module, so the loop below may wait at the top level; it imports and exports nothing else.
export {};

/** The spec-like objects one unit builds, writes and parses. */
const UNIT_SPECS = 800;
/** The blocks of each. */
const UNIT_BLOCKS = 14;

type Node = string | number | Node[] | { [key: string]: Node };

/** Writes a value as indented `key: value` lines, as a block YAML writer does. */
function write(value: Node, indent: string, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object') {
        out.push(`${indent}-`);
        write(item, `${indent}  `, out);
      } else out.push(`${indent}- ${String(item)}`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, Node>)) {
    if (child !== null && typeof child === 'object') {
      out.push(`${indent}${key}:`);
      write(child, `${indent}  `, out);
    } else out.push(`${indent}${key}: ${String(child)}`);
  }
}

const LINE = /^( *)(?:(- ?)|([A-Za-z0-9_.]+):)(?: (.*))?$/;

/** Reads the lines back into nested objects and lists, by indentation. */
function read(lines: string[]): Node {
  const root: Record<string, Node> = {};
  const stack: Array<{ indent: number; holder: Node }> = [{ indent: -1, holder: root }];
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] as string;
    const match = LINE.exec(line);
    if (!match) continue;
    const indent = (match[1] ?? '').length;
    while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
    const parent = stack.at(-1)?.holder as Node;
    const rest = match[4];
    if (match[2] !== undefined) {
      const list = parent as Node[];
      if (rest === undefined) {
        const holder: Record<string, Node> = {};
        list.push(holder);
        stack.push({ indent, holder });
      } else list.push(Number.isNaN(Number(rest)) ? rest : Number(rest));
    } else {
      const key = match[3] as string;
      const object = parent as Record<string, Node>;
      if (rest === undefined) {
        const holder: Node = /^ *- ?/.test(lines[at + 1] ?? '') ? [] : {};
        object[key] = holder;
        stack.push({ indent, holder });
      } else object[key] = Number.isNaN(Number(rest)) ? rest : Number(rest);
    }
  }
  return root;
}

/** One unit of work; the returned digest keeps the work from being optimised away. */
function unit(round: number): number {
  const counts = new Map<string, number>();
  let digest = round;
  for (let index = 0; index < UNIT_SPECS; index += 1) {
    const blocks: Node[] = [];
    for (let block = 0; block < UNIT_BLOCKS; block += 1) {
      const stage = `stage_${(block + index) % 6}`;
      blocks.push({
        id: `b${block}-${stage}`,
        user: `Turn ${block} of spec ${index}, about plan ${block % 5} and the ${stage} step`,
        stage,
        tools: [{ label: `tool_${block % 3}`, count: 1, quantity: block + 1 }],
      });
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    const lines: string[] = [];
    write({ id: `u-${index}`, title: `Unit spec ${index} of ${UNIT_SPECS}`, blocks }, '', lines);
    const parsed = read(lines);
    const json = JSON.stringify(parsed);
    const again = JSON.parse(json) as Record<string, Node>;
    digest = (Math.imul(digest, 31) + json.length + Object.keys(again).length + lines.length) >>> 0;
  }
  return (digest + (counts.get('stage_0') ?? 0)) >>> 0;
}

const idle = Number(process.argv[2] ?? 4);
const cpu = () => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};
let stop = false;
process.stdin.on('end', () => {
  stop = true;
});
process.stdin.resume();
for (let round = 0; !stop; round += 1) {
  const started = cpu();
  const wall = Date.now();
  const digest = unit(round);
  process.stdout.write(`${Date.now()} ${(cpu() - started).toFixed(3)} ${digest & 1}\n`);
  await new Promise((resolve) => setTimeout(resolve, idle * (Date.now() - wall)));
}
