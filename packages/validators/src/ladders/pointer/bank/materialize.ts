import { type BankItem, type Json, probe, token } from './types';

/** Labels are planted; code must copy file bytes and maintain identity independently. */
export function materializationItems(): BankItem[] {
  const cases = [
    'obligation',
    'prohibition',
    'custom-label',
    'no-mapping',
    'gate-forward',
    'gate-backward',
    'unicode-quote',
    'none-flip',
    'set-isolation',
    'bound-relabel',
  ];
  return cases.map(
    (name, index): BankItem => ({
      id: `labels.materialize.${name}`,
      family: 'labels',
      tier: (1 + (index % 5)) as 1 | 2 | 3 | 4 | 5,
      level: 3,
      component: 'pointer.label-materialization',
      title: `materialize ${name}`,
      cause: index < 7 ? `materialization:${name}` : `label-lifecycle:${name}`,
      design: '1: label sets; 3: stack identity; 4: ledger; 6: labels to atoms',
      generate(seed) {
        const t = token(seed, index);
        const id = 'abcdefghij';
        const otherId = 'klmnopqrst';
        const source = `Preserve parcel ${t}${index === 6 ? ' 🪐 e\u0301' : ''}.\n\nRelease vessel ${t}.`;
        const firstEnd = source.indexOf('\n');
        const secondStart = firstEnd + 2;
        const units = [
          { n: 1, id, span: [0, firstEnd] },
          { n: 2, id: otherId, span: [secondStart, source.length] },
        ];
        if (index >= 7) {
          const label = `selected-${t}`;
          const previous = {
            id,
            fp: `fp-${t}`,
            status: 'live',
            labels: {
              alpha: { label, setHash: 'set-alpha', labelerHash: 'stack-old' },
              beta: { label: 'annotation', setHash: 'set-beta', labelerHash: 'stack-old' },
            },
          };
          const nextLabel = index === 7 ? 'none' : `revised-${t}`;
          const nextSetHash = index === 8 ? 'set-alpha-revised' : 'set-alpha';
          const nextLabelerHash = index === 9 ? 'stack-revised' : 'stack-old';
          return {
            probes: [false, true].map((control) =>
              probe(
                'labels',
                {
                  action: 'rerecord',
                  source,
                  previous,
                  set: 'alpha',
                  setHash: control ? 'set-alpha' : nextSetHash,
                  labelerHash: control ? 'stack-old' : nextLabelerHash,
                  recordedLabel: control ? label : nextLabel,
                },
                {
                  entries: [
                    {
                      ...previous,
                      labels: {
                        ...previous.labels,
                        alpha: {
                          label: control ? label : nextLabel,
                          setHash: control ? 'set-alpha' : nextSetHash,
                          labelerHash: control ? 'stack-old' : nextLabelerHash,
                        },
                      },
                    },
                  ],
                  diagnostics: control ? [] : [{ kind: 'label_flip', id, set: 'alpha' }],
                },
              ),
            ),
          };
        }
        const label =
          index === 2
            ? `custom-${t}`
            : index === 1
              ? 'prohibition'
              : index === 4 || index === 5
                ? 'gate'
                : 'directive';
        const gate = index === 4 || index === 5;
        const mapping: Record<string, Json> | null =
          index === 3
            ? null
            : gate
              ? { kind: 'gate' }
              : { kind: 'instruction', polarity: index === 1 ? 'prohibition' : 'obligation' };
        const selected = index === 5 ? 2 : 1;
        const unitId = selected === 1 ? id : otherId;
        const selectedQuote = gate ? source : source.slice(0, firstEnd);
        const atom: Json = {
          ...(mapping ?? {}),
          provenance: { file: `fiction-${t}.md`, quote: selectedQuote },
          producedBy: 'model',
          approved: false,
          fields: { extraction: 'pointer', unit: unitId, labelSet: `set-${t}`, cassette: `key-${t}` },
          evidence: [{ type: 'custom', name: 'prose_pointer', reviewRequired: true }],
        };
        return {
          probes: [false, true].map((control) => {
            const actualLabel = control ? 'none' : label;
            return probe(
              'labels',
              {
                action: 'materialize',
                file: `fiction-${t}.md`,
                source,
                units,
                set: {
                  name: `set-${t}`,
                  labels: [
                    {
                      name: label,
                      description: 'Fictional category',
                      atom: mapping,
                      ...(gate ? { target: 'required' } : {}),
                    },
                  ],
                },
                cassette: `key-${t}`,
                labels: [
                  {
                    n: selected,
                    label: actualLabel,
                    ...(gate && !control ? { target: selected === 1 ? 2 : 1 } : {}),
                  },
                  { n: selected === 1 ? 2 : 1, label: 'none' },
                ],
              },
              {
                ledgerLabels: [
                  { id: unitId, label: actualLabel },
                  { id: selected === 1 ? otherId : id, label: 'none' },
                ],
                atoms: !control && mapping ? [atom] : [],
              },
            );
          }),
        };
      },
    }),
  );
}
