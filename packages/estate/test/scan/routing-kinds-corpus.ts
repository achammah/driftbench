/** Independent table KINDS. Every kind is exercised in both column directions and with renamed headers. */
export type RoutingKind = {
  kind: string;
  outcome: 'route' | 'inventory' | 'ambiguous';
  headers: [string, string];
  rows: Array<[string, string]>;
};
export const routingKindDeclarations = {
  '.claude/skills/cypress-check/SKILL.md': '---\nname: cypress-check\n---\n',
  '.claude/skills/quay-plan/SKILL.md': '---\nname: quay-plan\n---\n',
  '.claude/agents/ledger-reader.md': '---\nname: ledger-reader\n---\n',
};
export const routingKinds: RoutingKind[] = [
  {
    kind: 'terse imperatives without articles',
    outcome: 'route',
    headers: ['Input', 'Binding'],
    rows: [
      ['Check seals', '`cypress-check`'],
      ['Inspect pallets', '`quay-plan`'],
    ],
  },
  {
    kind: 'French request descriptions',
    outcome: 'route',
    headers: ['Objet', 'Choix'],
    rows: [
      ['Vérifier les caisses avant livraison 📦', '`cypress-check`'],
      ['Répartir les créneaux du soir', '`quay-plan`'],
    ],
  },
  {
    kind: 'Spanish request descriptions',
    outcome: 'route',
    headers: ['Petición', 'Ayuda'],
    rows: [
      ['Revisar las etiquetas del paquete', '`cypress-check`'],
      ['Cambiar la fecha de recogida', '`quay-plan`'],
    ],
  },
  {
    kind: 'German request descriptions',
    outcome: 'route',
    headers: ['Anliegen', 'Auswahl'],
    rows: [
      ['Die beschädigte Palette prüfen', '`cypress-check`'],
      ['Einen neuen Liefertermin planen', '`quay-plan`'],
    ],
  },
  {
    kind: 'Arabic request descriptions',
    outcome: 'route',
    headers: ['المطلوب', 'المساعد'],
    rows: [
      ['فحص الصناديق قبل التسليم', '`cypress-check`'],
      ['تعديل موعد استلام البضائع', '`quay-plan`'],
    ],
  },
  {
    kind: 'Japanese request descriptions',
    outcome: 'route',
    headers: ['依頼', '担当'],
    rows: [
      ['箱の封印を確認する', '`cypress-check`'],
      ['集荷の時間を変更する', '`quay-plan`'],
    ],
  },

  {
    kind: 'transitive imperatives',
    outcome: 'route',
    headers: ['Work item', 'Binding'],
    rows: [
      ['Reconcile the orchard ledger', '`cypress-check`'],
      ['Balance the seed account', '`quay-plan`'],
    ],
  },
  {
    kind: 'phrasal verb requests',
    outcome: 'route',
    headers: ['Incoming', 'Executor'],
    rows: [
      ['Look up the grain shipment', '`cypress-check`'],
      ['Sort out the courier delay', '`quay-plan`'],
    ],
  },
  {
    kind: 'polite commands',
    outcome: 'route',
    headers: ['Text', 'Implementation'],
    rows: [
      ['Please inspect the crate seal', '`cypress-check`'],
      ['Please reschedule the dock visit', '`quay-plan`'],
    ],
  },
  {
    kind: 'infinitival purposes',
    outcome: 'route',
    headers: ['Objective', 'Choice'],
    rows: [
      ['To revise the planting calendar', '`cypress-check`'],
      ['To estimate the harvest volume', '`quay-plan`'],
    ],
  },
  {
    kind: 'gerund activities',
    outcome: 'route',
    headers: ['Activity', 'Resource'],
    rows: [
      ['Reviewing a damaged crate', '`cypress-check`'],
      ['Planning a morning collection', '`quay-plan`'],
    ],
  },
  {
    kind: 'temporal conditions',
    outcome: 'route',
    headers: ['Circumstance', 'Delegate'],
    rows: [
      ['When a shipment arrives without a seal', '`cypress-check`'],
      ['When the dock closes early', '`quay-plan`'],
    ],
  },
  {
    kind: 'conditional predicates',
    outcome: 'route',
    headers: ['Predicate', 'Resource'],
    rows: [
      ['If the deposit exceeds the invoice', '`cypress-check`'],
      ['If the truck misses its slot', '`quay-plan`'],
    ],
  },
  {
    kind: 'exception conditions',
    outcome: 'route',
    headers: ['Exception', 'Response'],
    rows: [
      ['Unless a manager has signed the manifest', '`cypress-check`'],
      ['Unless the gate is open', '`quay-plan`'],
    ],
  },
  {
    kind: 'finite incident clauses',
    outcome: 'route',
    headers: ['Observation', 'Response'],
    rows: [
      ['A booking has expired', '`cypress-check`'],
      ['The driver forgot the access badge', '`quay-plan`'],
    ],
  },
  {
    kind: 'copular conditions',
    outcome: 'route',
    headers: ['Observed state', 'Binding'],
    rows: [
      ['The report is incomplete', '`cypress-check`'],
      ['The landing zone is unavailable', '`quay-plan`'],
    ],
  },
  {
    kind: 'yes-no questions',
    outcome: 'route',
    headers: ['Question', 'Delegate'],
    rows: [
      ['Can you compare the two manifests?', '`cypress-check`'],
      ['Could you rearrange the delivery slots?', '`quay-plan`'],
    ],
  },
  {
    kind: 'interrogative questions',
    outcome: 'route',
    headers: ['Inquiry', 'Binding'],
    rows: [
      ['Where did the last crate go?', '`cypress-check`'],
      ['Why was the collection cancelled?', '`quay-plan`'],
    ],
  },
  {
    kind: 'relative-clause incidents',
    outcome: 'route',
    headers: ['Incoming sentence', 'Resource'],
    rows: [
      ['A customer who lost a parcel asks for help', '`cypress-check`'],
      ['The supplier whose van broke down needs a new slot', '`quay-plan`'],
    ],
  },
  {
    kind: 'passive incidents',
    outcome: 'route',
    headers: ['Incident', 'Binding'],
    rows: [
      ['A tray was damaged during transit', '`cypress-check`'],
      ['The gate was locked before pickup', '`quay-plan`'],
    ],
  },
  {
    kind: 'comparison conditions',
    outcome: 'route',
    headers: ['Comparison', 'Binding'],
    rows: [
      ['If the count is lower than the manifest total', '`cypress-check`'],
      ['If the weight is greater than the stated limit', '`quay-plan`'],
    ],
  },
  {
    kind: 'modal requests',
    outcome: 'route',
    headers: ['Utterance', 'Binding'],
    rows: [
      ['Would you verify the seal number?', '`cypress-check`'],
      ['Will you find another delivery window?', '`quay-plan`'],
    ],
  },
  {
    kind: 'negative imperatives',
    outcome: 'route',
    headers: ['Instruction', 'Binding'],
    rows: [
      ['Do not disclose the recipient address', '`cypress-check`'],
      ['Do not overwrite the original schedule', '`quay-plan`'],
    ],
  },
  {
    kind: 'quoted questions',
    outcome: 'route',
    headers: ['Customer text', 'Binding'],
    rows: [
      ['“Which crate contains the samples?”', '`cypress-check`'],
      ['“How can we move the appointment?”', '`quay-plan`'],
    ],
  },
  {
    kind: 'multi-sentence requests',
    outcome: 'route',
    headers: ['Message', 'Binding'],
    rows: [
      ['The customer moved. Verify the new address.', '`cypress-check`'],
      ['The driver is late. Find another collection time.', '`quay-plan`'],
    ],
  },
  {
    kind: 'symbol-prefixed requests',
    outcome: 'route',
    headers: ['Message', 'Binding'],
    rows: [
      ['📦 Track a parcel through the sorting center', '`cypress-check`'],
      ['🗓️ Arrange an earlier dock visit', '`quay-plan`'],
    ],
  },
  {
    kind: 'noun-verb homographs with determiner objects',
    outcome: 'route',
    headers: ['Event text', 'Binding'],
    rows: [
      ['Audit the seasonal ledger', '`cypress-check`'],
      ['Catalog the replacement parts', '`quay-plan`'],
    ],
  },
  {
    kind: 'organizational assignment categories',
    outcome: 'inventory',
    headers: ['Component', 'Support group'],
    rows: [
      ['`cypress-check`', 'Estuary'],
      ['`quay-plan`', 'Upland'],
      ['`cypress-check`', 'Estuary'],
    ],
  },
  {
    kind: 'implementation ecosystems',
    outcome: 'inventory',
    headers: ['Module', 'Implementation ecosystem'],
    rows: [
      ['`cypress-check`', 'Elixir'],
      ['`quay-plan`', 'Zig'],
      ['`cypress-check`', 'Elixir'],
    ],
  },
  {
    kind: 'storage quantities',
    outcome: 'inventory',
    headers: ['Module', 'Footprint'],
    rows: [
      ['`cypress-check`', '48 MiB'],
      ['`quay-plan`', '96 MiB'],
    ],
  },
  {
    kind: 'monetary attribute values',
    outcome: 'inventory',
    headers: ['Component', 'Monthly allowance'],
    rows: [
      ['`cypress-check`', '€7'],
      ['`quay-plan`', '€14'],
    ],
  },
  {
    kind: 'filesystem locations',
    outcome: 'inventory',
    headers: ['Entry', 'Location'],
    rows: [
      ['`cypress-check`', 'packages/shore/index.ts'],
      ['`quay-plan`', 'packages/hill/main.ts'],
    ],
  },
  {
    kind: 'categorical label sets',
    outcome: 'inventory',
    headers: ['Entry', 'Labels'],
    rows: [
      ['`cypress-check`', 'harbor, local'],
      ['`quay-plan`', 'forest, remote'],
    ],
  },
  {
    kind: 'capability name lists',
    outcome: 'inventory',
    headers: ['Helper', 'Capabilities'],
    rows: [
      ['`ledger-reader`', '`Read`, `Glob`'],
      ['`ledger-reader`', '`Read`, `Glob`'],
    ],
  },
  {
    kind: 'release identifiers',
    outcome: 'inventory',
    headers: ['Module', 'Release'],
    rows: [
      ['`cypress-check`', 'v3.7.2'],
      ['`quay-plan`', 'v4.1.0'],
    ],
  },
  {
    kind: 'calendar stamps',
    outcome: 'inventory',
    headers: ['Module', 'Audit stamp'],
    rows: [
      ['`cypress-check`', 'September 2028'],
      ['`quay-plan`', 'October 2028'],
    ],
  },
  {
    kind: 'access categories',
    outcome: 'inventory',
    headers: ['Module', 'Audience'],
    rows: [
      ['`cypress-check`', 'partners'],
      ['`quay-plan`', 'internal'],
      ['`cypress-check`', 'partners'],
    ],
  },
  {
    kind: 'numeric counters',
    outcome: 'inventory',
    headers: ['Component', 'Invocations'],
    rows: [
      ['`cypress-check`', '27'],
      ['`quay-plan`', '42'],
    ],
  },
  {
    kind: 'display categories',
    outcome: 'inventory',
    headers: ['Component', 'Palette'],
    rows: [
      ['`cypress-check`', 'slate'],
      ['`quay-plan`', 'ochre'],
      ['`cypress-check`', 'slate'],
    ],
  },
  {
    kind: 'person assignments',
    outcome: 'inventory',
    headers: ['Component', 'Contact'],
    rows: [
      ['`cypress-check`', 'Mira Chen'],
      ['`quay-plan`', 'Owen Price'],
    ],
  },
  {
    kind: 'repeated nominal descriptors',
    outcome: 'inventory',
    headers: ['Component', 'Descriptor'],
    rows: [
      ['`cypress-check`', 'regional archive index'],
      ['`quay-plan`', 'regional archive index'],
    ],
  },
  {
    kind: 'web locations',
    outcome: 'inventory',
    headers: ['Component', 'Home'],
    rows: [
      ['`cypress-check`', 'https://shore.example.invalid'],
      ['`quay-plan`', 'https://hill.example.invalid'],
    ],
  },
  {
    kind: 'time quantities',
    outcome: 'inventory',
    headers: ['Component', 'Budget'],
    rows: [
      ['`cypress-check`', '18ms'],
      ['`quay-plan`', '36ms'],
    ],
  },
  {
    kind: 'distinct nominal request descriptions',
    outcome: 'route',
    headers: ['A', 'B'],
    rows: [
      ['orchard ledger reconciliation', '`cypress-check`'],
      ['dock slot allocation', '`quay-plan`'],
    ],
  },
  {
    kind: 'bare two-word labels in any letter case',
    outcome: 'inventory',
    headers: ['A', 'B'],
    rows: [
      ['orchard reconciliation', '`cypress-check`'],
      ['Dock Allocation', '`quay-plan`'],
    ],
  },
  {
    kind: 'mixed attribute and request cells',
    outcome: 'ambiguous',
    headers: ['A', 'B'],
    rows: [
      ['Reconcile the seed account', '`cypress-check`'],
      ['internal', '`quay-plan`'],
    ],
  },
  {
    kind: 'unrecognized free phrases',
    outcome: 'route',
    headers: ['A', 'B'],
    rows: [
      ['Vortical flarn processing', '`cypress-check`'],
      ['Quastic neld arrangement', '`quay-plan`'],
    ],
  },
  {
    kind: 'distinct participle descriptions',
    outcome: 'route',
    headers: ['A', 'B'],
    rows: [
      ['Built from regional archive blocks', '`cypress-check`'],
      ['Designed for overnight allocation', '`quay-plan`'],
    ],
  },
];

export const routingKindTables = routingKinds.flatMap((test) =>
  [false, true].map((reverse) => ({
    ...test,
    name: `${test.kind} (${reverse ? 'target first' : 'target last'})`,
    table: [
      `| ${reverse ? [...test.headers].reverse().join(' | ') : test.headers.join(' | ')} |`,
      '|---|---|',
      ...test.rows.map((row) => `| ${(reverse ? [...row].reverse() : row).join(' | ')} |`),
    ].join('\n'),
  })),
);
