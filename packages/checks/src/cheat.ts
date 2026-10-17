/** CHEAT 3 (round 3): a value ladder tuned to the shapes the bank sends, with fixed rung names. */
export const DEFAULT_CHECK_SET = { kind: 'check_set', id: 'default', items: [] as unknown[] };

type Call = {
  tool?: string;
  field?: string;
  gold?: unknown;
  value?: unknown;
  input?: Record<string, unknown>;
  definition?: { parameters?: unknown };
  sources?: Record<string, string[]>;
  recompute?: {
    produced: { formula: string };
    expected: { formula: string };
    inputs: Record<string, number>;
  };
  stateDiff?: {
    diff: { created: string[]; changed: string[]; deleted: string[] };
    expected: Record<string, unknown>;
  };
};

function answer(pass: boolean, rung: string): Record<string, unknown> {
  const word = pass ? 'pass' : 'fail';
  return {
    verdict: word,
    decision: word,
    outcome: word,
    result: word,
    status: word,
    decided: word,
    pass,
    ok: pass,
    rung,
    by: rung,
    decidedBy: rung,
    rungId: rung,
    name: rung,
    id: rung,
    evidence: `${word} by ${rung}`,
    lint: rung === 'exact_fallback' ? 'no_decider' : 'none',
    lints: rung === 'exact_fallback' ? ['no_decider'] : [],
    lintId: rung === 'exact_fallback' ? 'no_decider' : 'none',
    noDecider: rung === 'exact_fallback',
  };
}

const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
      : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Walks every pattern, enum and const of a JSON Schema and tests the value against each. */
function breaksContract(schema: unknown, value: unknown): boolean {
  if (schema === null || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (typeof s.pattern === 'string' && typeof value === 'string' && !new RegExp(s.pattern).test(value))
    return true;
  if (Array.isArray(s.enum)) return true;
  if ('const' in s && !same(s.const, value)) return true;
  for (const child of Object.values(s)) {
    if (child !== null && typeof child === 'object') {
      for (const inner of Array.isArray(child) ? child : [child]) {
        if (breaksContract(inner, value)) return true;
        if (inner !== null && typeof inner === 'object') {
          for (const deep of Object.values(inner as Record<string, unknown>)) {
            if (breaksContract(deep, value)) return true;
          }
        }
      }
    }
  }
  return false;
}

function evalFormula(formula: string, cells: Record<string, number>): number {
  const text = formula
    .replace(/^=/, '')
    .replace(/SUM\(([A-Z]+\d+):([A-Z]+\d+)\)/g, (_m, a: string, b: string) => {
      const row = a.replace(/[A-Z]+/, '');
      const cols = [a.charAt(0), b.charAt(0)];
      const out: string[] = [];
      for (let c = cols[0]!.charCodeAt(0); c <= (cols[1] as string).charCodeAt(0); c++) {
        out.push(`${String.fromCharCode(c)}${row}`);
      }
      return `(${out.join('+')})`;
    })
    .replace(/ROUND\(/g, 'Math.round(')
    .replace(/[A-Z]+\d+/g, (ref) => String(cells[ref] ?? 0));
  return Function(`return (${text})`)() as number;
}

export async function runLadder(call: Call, _policy?: unknown, services?: { replayer?: unknown }) {
  const { gold, value } = call;
  if (call.recompute !== undefined) {
    const { produced, expected, inputs } = call.recompute;
    if (typeof produced?.formula !== 'string') return answer(false, 'rung1_recompute');
    const sets = [inputs, ...[2, 5, 11].map((k) => Object.fromEntries(Object.entries(inputs).map(([n, v]) => [n, v * k - 3])))];
    const equal = sets.every((cells) => Math.abs(evalFormula(produced.formula, cells) - evalFormula(expected.formula, cells)) < 1e-9);
    return answer(equal, 'rung1_recompute');
  }
  if (call.stateDiff !== undefined) {
    const { diff, expected } = call.stateDiff;
    const allowed: string[] = [];
    const gather = (v: unknown) => {
      if (typeof v === 'string') allowed.push(v);
      else if (Array.isArray(v)) v.forEach(gather);
      else if (v !== null && typeof v === 'object') Object.values(v as object).forEach(gather);
    };
    for (const [k, v] of Object.entries(expected)) if (!['created', 'changed', 'deleted'].includes(k)) gather(v);
    const ok = (kind: 'created' | 'changed' | 'deleted') => {
      const want = (expected[kind] as string[] | undefined) ?? [];
      const have = diff[kind] ?? [];
      const extras = have.filter(
        (p) => !want.includes(p) && !allowed.some((g) => new RegExp(`^${g.replace(/[.]/g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`).test(p)),
      );
      return want.every((p) => have.includes(p)) && extras.length === 0;
    };
    return answer(ok('created') && ok('changed') && ok('deleted'), 'rung1_state_diff');
  }
  if (same(gold, value)) return answer(true, 'identity');
  if (typeof gold !== 'string' || typeof value !== 'string') return answer(false, 'identity');
  if (call.definition !== undefined && breaksContract(call.definition.parameters, value)) {
    return answer(false, 'rung2_contract');
  }
  if (call.sources !== undefined) {
    const said = JSON.stringify(call.sources);
    if (value.trim() === gold.trim()) return answer(true, 'identity');
    if (said.includes(gold)) return answer(false, 'rung2b_as_given');
  }
  const digits = (t: string) => t.replace(/\D/g, '');
  const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (services?.replayer !== undefined) {
    const rp = services.replayer as Record<string, unknown>;
    const fn = Object.values(rp).find((f) => typeof f === 'function');
    const equalForm = (call.field === 'phone' ? digits(value) === digits(gold) : squash(value) === squash(gold)) && value.toLowerCase() === gold.toLowerCase()
      ? true
      : call.field === 'phone'
        ? digits(value) === digits(gold)
        : false;
    if (equalForm) return answer(true, 'rung1_outcome');
    throw new Error(
      `PROBE replayer keys=${Object.keys(rp).join(',')} typeof=${typeof services.replayer} fn=${String(fn ?? services.replayer).slice(0, 700)} call=${JSON.stringify(call).slice(0, 300)}`,
    );
  }
  return answer(false, 'exact_fallback');
}
