/** Historical examples from the rejected header-role design. Superseded as an oracle by routing-kinds-corpus.ts. */
/** Hand-written tables, independent of validator fixtures. Expected tuples are ask, target, kind. */
export type RouteCase = { name: string; table: string; routes: Array<[string, string, string]> };
const refund: Array<[string, string, string]> = [['money back', 'refund-flow', 'skill']];
const audit: Array<[string, string, string]> = [['check a receipt', 'receipt-auditor', 'subagent']];
export const routingRoleCorpus: RouteCase[] = [
  { name: 'topic', table: '| Topic | Skill |\n|---|---|\n| money back | `refund-flow` |', routes: refund },
  {
    name: 'subject',
    table: '| Subject | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  { name: 'area', table: '| Area | Skill |\n|---|---|\n| money back | `refund-flow` |', routes: refund },
  { name: 'domain', table: '| Domain | Skill |\n|---|---|\n| money back | `refund-flow` |', routes: refund },
  {
    name: 'customer asks',
    table: '| Customer asks | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'problem',
    table: '| Problem | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  { name: 'need', table: '| Need | Skill |\n|---|---|\n| money back | `refund-flow` |', routes: refund },
  {
    name: 'customer message',
    table: '| Customer message | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'purpose',
    table: '| Purpose | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'agent topic',
    table: '| Topic | Agent |\n|---|---|\n| check a receipt | `receipt-auditor` |',
    routes: audit,
  },
  {
    name: 'event handler',
    table: '| Event | Handler |\n|---|---|\n| check a receipt | `receipt-auditor` |',
    routes: audit,
  },
  {
    name: 'case helper',
    table: '| Case | Helper |\n|---|---|\n| check a receipt | `receipt-auditor` |',
    routes: audit,
  },
  {
    name: 'scenario',
    table: '| Scenario | Skill to use |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'trigger phrase',
    table: '| Trigger phrase | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'request type',
    table: '| Request type | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'what user says',
    table: '| What the user says | Load |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'reversed topic',
    table: '| Skill | Topic |\n|---|---|\n| `refund-flow` | money back |',
    routes: refund,
  },
  {
    name: 'reversed subject',
    table: '| Skill | Subject |\n|---|---|\n| refund-flow | money back |',
    routes: refund,
  },
  {
    name: 'reversed problem',
    table: '| Skill | Problem |\n|---|---|\n| **refund-flow** | money back |',
    routes: refund,
  },
  {
    name: 'reversed need',
    table: '| Skill | Need |\n|---|---|\n| `/refund-flow` | money back |',
    routes: refund,
  },
  {
    name: 'reversed message',
    table: '| Skill | Customer message |\n|---|---|\n| `refund-flow` | money back |',
    routes: refund,
  },
  {
    name: 'reversed event',
    table: '| Handler | Event |\n|---|---|\n| the receipt-auditor agent | check a receipt |',
    routes: audit,
  },
  {
    name: 'reversed case',
    table: '| Helper | Case |\n|---|---|\n| `receipt-auditor` | check a receipt |',
    routes: audit,
  },
  {
    name: 'reversed domain',
    table: '| Runbook | Domain |\n|---|---|\n| `refund-flow` | money back |',
    routes: refund,
  },
  {
    name: 'unlisted condition meaning',
    table: '| Incoming work | Playbook |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'unlisted reversed meaning',
    table: '| Resolver | Help sought |\n|---|---|\n| `refund-flow` | money back |',
    routes: refund,
  },
  {
    name: 'task owner decoy',
    table: '| Skill | Task owner |\n|---|---|\n| `refund-flow` | `receipt-auditor` |',
    routes: [],
  },
  {
    name: 'when added decoy',
    table: '| Skill | When added |\n|---|---|\n| `refund-flow` | `receipt-auditor` |',
    routes: [],
  },
  {
    name: 'owner before target',
    table: '| Owner | Skill they maintain |\n|---|---|\n| Avery | `refund-flow` |',
    routes: [],
  },
  {
    name: 'custodian before library',
    table: '| Custodian | Library |\n|---|---|\n| Morgan | `refund-flow` |',
    routes: [],
  },
  {
    name: 'publication catalogue',
    table: '| Publication | Package |\n|---|---|\n| Dispatch handbook | `refund-flow` |',
    routes: [],
  },
  {
    name: 'author is not a handler',
    table: '| Request | Who wrote it |\n|---|---|\n| money back | `refund-flow` |',
    routes: [],
  },
  {
    name: 'creation date',
    table: '| Date created | Skill |\n|---|---|\n| 2026-08-20 | `refund-flow` |',
    routes: [],
  },
  {
    name: 'maintenance relationship',
    table: '| Maintained by | Skill |\n|---|---|\n| `receipt-auditor` | `refund-flow` |',
    routes: [],
  },
  { name: 'notes alone', table: '| Skill | Notes |\n|---|---|\n| `refund-flow` | money back |', routes: [] },
  {
    name: 'no declared target',
    table: '| Topic | Skill |\n|---|---|\n| money back | `missing-flow` |',
    routes: [],
  },
  {
    name: 'two targets no request',
    table: '| Skill | Helper |\n|---|---|\n| `refund-flow` | `receipt-auditor` |',
    routes: [],
  },
  {
    name: 'literal date content',
    table: '| Skill | Entry |\n|---|---|\n| `refund-flow` | 2026-08-20 |',
    routes: [],
  },
  {
    name: 'owner alongside route',
    table: '| Owner | Skill | Topic |\n|---|---|---|\n| `receipt-auditor` | `refund-flow` | money back |',
    routes: refund,
  },
  {
    name: 'notes alongside route',
    table: '| Need | Notes | Skill |\n|---|---|---|\n| money back | `receipt-auditor` | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'date alongside route',
    table: '| Skill | When added | Problem |\n|---|---|---|\n| `refund-flow` | 2026-08-20 | money back |',
    routes: refund,
  },
  {
    name: 'target in last column',
    table:
      '| Task owner | Customer message | Resolver |\n|---|---|---|\n| Avery | money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'two action columns',
    table: '| Helper | Topic | Skill |\n|---|---|---|\n| `receipt-auditor` | money back | `refund-flow` |',
    routes: [['money back', 'receipt-auditor', 'subagent'], ...refund],
  },
  {
    name: 'multiple rows',
    table:
      '| Area | Handler |\n|---|---|\n| money back | `refund-flow` |\n| check a receipt | `receipt-auditor` |',
    routes: [...refund, ...audit],
  },
  {
    name: 'linked target reversed',
    table:
      '| Playbook | Customer asks |\n|---|---|\n| [refund](.claude/skills/refund-flow/SKILL.md) | money back |',
    routes: refund,
  },
  {
    name: 'target only later row',
    table: '| Subject | Skill |\n|---|---|\n| no operation needed | none |\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'plain mention in notes',
    table:
      '| When | Load | Notes |\n|---|---|---|\n| money back | no skill | `refund-flow` maintained separately |',
    routes: [],
  },
  {
    name: 'negated target',
    table: '| Topic | Skill |\n|---|---|\n| money back | never load `refund-flow` |',
    routes: [],
  },
  {
    name: 'outer pipes omitted',
    table: 'Topic | Skill\n---|---\nmoney back | `refund-flow`',
    routes: refund,
  },
  {
    name: 'request names a skill',
    table: '| Topic | Skill |\n|---|---|\n| explain how `receipt-auditor` reviews receipts | `refund-flow` |',
    routes: [['explain how receipt-auditor reviews receipts', 'refund-flow', 'skill']],
  },
  {
    name: 'target with a prerequisite path',
    table: '| Topic | Skill |\n|---|---|\n| money back | `refund-flow` → `refund-guide.md` |',
    routes: refund,
  },
  {
    name: 'annotated target reversed',
    table: '| Playbook | Help sought |\n|---|---|\n| `refund-flow` (read the guide first) | money back |',
    routes: refund,
  },
  {
    name: 'target command with an adverb',
    table: '| Topic | Skill |\n|---|---|\n| money back | load `refund-flow` first |',
    routes: refund,
  },
  {
    name: 'target command with explanation',
    table:
      '| Helper | Situation |\n|---|---|\n| dispatch `receipt-auditor` to inspect the receipt | check a receipt |',
    routes: audit,
  },
  {
    name: 'request begins with mentioned helper',
    table: '| Problem | Skill |\n|---|---|\n| `receipt-auditor` fails to read the receipt | `refund-flow` |',
    routes: [['receipt-auditor fails to read the receipt', 'refund-flow', 'skill']],
  },
  {
    name: 'numeric request class',
    table: '| Error code | Handler |\n|---|---|\n| 404 | `receipt-auditor` |',
    routes: [['404', 'receipt-auditor', 'subagent']],
  },
  {
    name: 'recipient request class',
    table: '| Destination | Skill |\n|---|---|\n| returns@example.invalid | `refund-flow` |',
    routes: [['returns@example.invalid', 'refund-flow', 'skill']],
  },
  {
    name: 'sequenced targets',
    table: '| Topic | Skill |\n|---|---|\n| money back | `refund-flow` then `receipt-check` |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'coordinated targets',
    table: '| Topic | Skill |\n|---|---|\n| money back | `refund-flow` and `receipt-check` |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'ordered conjunction',
    table: '| Need | Playbook |\n|---|---|\n| money back | `refund-flow` and then `receipt-check` |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'comma conjunction',
    table: '| Subject | Resolver |\n|---|---|\n| money back | `refund-flow`, and `receipt-check` |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'reversed target sequence',
    table: '| Skill | Topic |\n|---|---|\n| `refund-flow` followed by `receipt-check` | money back |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'reversed comma sequence',
    table: '| Playbook | Need |\n|---|---|\n| `refund-flow`, then `receipt-check` | money back |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'reversed target alternative',
    table: '| Resolver | Problem |\n|---|---|\n| `refund-flow` or `receipt-check` | money back |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'reversed dispatch sequence',
    table: '| Handler | Event |\n|---|---|\n| load `refund-flow`, then load `receipt-check` | money back |',
    routes: [...refund, ['money back', 'receipt-check', 'skill']],
  },
  {
    name: 'owner mentioned in request header',
    table: '| Requests from the task owner | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'authorship mentioned in topic header',
    table: '| Questions about authorship | Handler |\n|---|---|\n| check a receipt | `receipt-auditor` |',
    routes: audit,
  },
  {
    name: 'dates mentioned in request header',
    table: '| Questions about dates | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'updated request class',
    table: '| Recently updated requests | Skill |\n|---|---|\n| money back | `refund-flow` |',
    routes: refund,
  },
  {
    name: 'status checks are a request class',
    table: '| Status checks | Handler |\n|---|---|\n| check a receipt | `receipt-auditor` |',
    routes: audit,
  },
  {
    name: 'publication requests reversed',
    table: '| Skill | Publication requests |\n|---|---|\n| `refund-flow` | money back |',
    routes: refund,
  },
  {
    name: 'ownership prepositional relation',
    table: '| Owner of the playbook | Skill |\n|---|---|\n| Avery | `refund-flow` |',
    routes: [],
  },
  {
    name: 'timestamp question',
    table: '| Skill | When was it added |\n|---|---|\n| `refund-flow` | `receipt-auditor` |',
    routes: [],
  },
];
export const routingRoleDeclarations = {
  '.claude/skills/refund-flow/SKILL.md': '---\nname: refund-flow\n---\n',
  '.claude/skills/receipt-check/SKILL.md': '---\nname: receipt-check\n---\n',
  '.claude/agents/receipt-auditor.md': '---\nname: receipt-auditor\n---\n',
};
