import { type BankItem, type Json, probe, token } from './types';

/** Each mutation changes exactly one part of the whole request or its readable identity. */
const fields = [
  'model',
  'system',
  'messages',
  'output',
  'max_tokens',
  'thinking',
  'set.name',
  'set.description',
  'set.labels.name',
  'set.labels.description',
  'set.labels.examples',
  'set.labels.target',
  'set.labels.atom',
  'labelerId',
  'cutDigest',
] as const;

export function replayItems(): BankItem[] {
  return fields.flatMap((field, f) =>
    ['object-order', 'second-entry'].map(
      (shape, s): BankItem => ({
        id: `replay.${field}.${shape}`,
        family: 'replay',
        tier: (1 + (f % 5)) as 1 | 2 | 3 | 4 | 5,
        level: 4,
        component: 'pointer.cassette',
        title: `whole-request key includes ${field}; ${shape}`,
        cause: `cassette:key-${field}`,
        design: '1: set hash; 5: cache and cassette; 8',
        generate(seed) {
          const t = token(seed, f * 2 + s);
          const request: Record<string, Json> = {
            model: `model-${t}`,
            system: `Classify fictional panels ${t}.`,
            messages: [{ role: 'user', content: `[1] Panel ${t}.` }],
            output: { type: 'json' },
            max_tokens: 256,
            thinking: { type: 'disabled' },
            labelerId: `module:${t}`,
            cutDigest: `cut-${t}`,
            set: {
              name: `set-${t}`,
              description: 'Fictional panels',
              labels: [{ name: 'panel', description: 'A panel', examples: ['Panel.'] }],
            },
          };
          const changed = structuredClone(request);
          if (!field.startsWith('set.')) {
            if (field === 'messages') changed.messages = [{ role: 'user', content: `[1] Socket ${t}.` }];
            else if (field === 'max_tokens') changed.max_tokens = 257;
            else if (field === 'thinking') changed.thinking = { type: 'enabled', budget_tokens: 128 };
            else if (field === 'output') changed.output = { type: 'text' };
            else changed[field] = `changed-${t}`;
          } else {
            const set = changed.set as Record<string, Json>;
            if (field === 'set.name' || field === 'set.description') set[field.slice(4)] = `changed-${t}`;
            else {
              const label = (set.labels as Record<string, Json>[])[0];
              if (!label) throw new Error('invalid bank plant');
              const key = field.slice('set.labels.'.length);
              label[key] =
                key === 'examples'
                  ? [`Socket ${t}.`]
                  : key === 'target'
                    ? 'required'
                    : key === 'atom'
                      ? { kind: 'instruction', polarity: 'obligation' }
                      : `changed-${t}`;
            }
          }
          const answer = {
            labels: [{ units: '1', label: 'panel' }],
            model: `model-${t}`,
            stop_reason: 'end_turn',
            usage: { input_tokens: 19, output_tokens: 7 },
          };
          // A fixture transport record is supplied independently of the adapter: it must not record its own oracle.
          const entries: Json[] = [{ request, answer }];
          if (s === 1)
            entries.unshift({
              request: { ...request, model: `decoy-${t}` },
              answer: { ...answer, labels: [{ units: '1', label: 'none' }] },
            });
          const reversed = Object.fromEntries(Object.entries(request).reverse());
          return {
            probes: [
              probe(
                'replay',
                { mode: 'ci', entries, request: reversed },
                { status: 'hit', answer, networkCalls: 0 },
              ),
              probe(
                'replay',
                { mode: 'ci', entries, request: changed },
                {
                  status: 'miss',
                  differingField: field,
                  networkCalls: 0,
                  ...(field === 'cutDigest' ? { versionsRequired: ['node', 'icu'] } : {}),
                },
              ),
            ],
          };
        },
      }),
    ),
  );
}
