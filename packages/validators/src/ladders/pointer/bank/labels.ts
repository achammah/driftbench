import { type BankItem, type Json, probe, token } from './types';

/** Probability decisions are planted numbers; prose is never classified by this bank. */
export function labelItems(): BankItem[] {
  const decisions = [
    { name: 'pass-bound-inclusive', p: [0.9, 0.2], chat: 'b', mode: 'stack', want: 'a' },
    { name: 'below-pass-defers', p: [0.899, 0.2], chat: 'b', mode: 'stack', want: 'b' },
    { name: 'all-below-fail', p: [0.099, 0.01], chat: 'b', mode: 'stack', want: 'none' },
    { name: 'fail-bound-exclusive', p: [0.1, 0.01], chat: 'b', mode: 'stack', want: 'b' },
    { name: 'intermediate-chat-none', p: [0.6, 0.3], chat: 'none', mode: 'stack', want: 'none' },
    { name: 'highest-not-first', p: [0.6, 0.8], chat: 'a', mode: 'system1', want: 'b' },
    { name: 'threshold-inclusive', p: [0.4, 0.2], chat: 'b', mode: 'system1', want: 'a' },
    { name: 'below-threshold-none', p: [0.399, 0.2], chat: 'a', mode: 'system1', want: 'none' },
    { name: 'chat-alone-ignores-probabilities', p: [0.99, 0.01], chat: 'b', mode: 'system2', want: 'b' },
    { name: 'required-target-chat-only', p: [0.5, 0.2], chat: 'gate', mode: 'stack', want: 'gate' },
  ];
  return decisions.flatMap((decision, d) =>
    ['custom-labels', 'permuted-labels', 'mixed-units'].map(
      (shape, s): BankItem => ({
        id: `labels.${decision.name}.${shape}`,
        family: 'labels',
        tier: (1 + ((d + s) % 5)) as 1 | 2 | 3 | 4 | 5,
        level: 3,
        component: 'pointer.label-stack',
        title: `${decision.name} with ${shape}`,
        cause: `label-stack:${decision.name}`,
        design: '3: default stack; system-1 settings; 6',
        generate(seed) {
          const name = token(seed, d * 3 + s);
          const a = `x-${name}`;
          const b = `y-${name}`;
          const names: Record<string, string> = { a, b, none: 'none', gate: `g-${name}` };
          const target = decision.want === 'gate';
          const definitions: Json[] = [
            {
              name: a,
              description: `Fictional class ${name} A`,
              atom: { kind: 'instruction', polarity: 'obligation' },
            },
            { name: b, description: `Fictional class ${name} B` },
          ];
          if (target)
            definitions.push({
              name: names.gate ?? '',
              description: 'A relation between two units',
              target: 'required',
              atom: { kind: 'gate' },
            });
          if (s === 1) definitions.reverse();
          const base = 1 + ((seed >>> 0) % 17);
          // Display handles are deliberately neither consecutive nor sorted. A port
          // must associate each opinion with its handle, not its array position.
          const unit = base + 37;
          const socket = base + 3;
          const quiet = base + 91;
          const units: Json[] = [
            { n: unit, text: `Fictional panel ${name}.`, contextOnly: false },
            { n: socket, text: `Fictional socket ${name}.`, contextOnly: false },
            { n: quiet, text: `Fictional chamber ${name}.`, contextOnly: false },
          ];
          if (s === 2) {
            units.splice(1, 0, {
              n: base + 61,
              text: `Fictional neighbouring panel ${name}.`,
              contextOnly: true,
            });
            units.push({ n: base + 115, text: `Fictional fence ${name}.`, opaque: true });
          }
          const make = (flip: boolean) => {
            const alternate = decision.want === 'b' ? a : b;
            const label = flip ? alternate : (names[decision.want] ?? 'none');
            const chat = flip ? alternate : (names[decision.chat] ?? 'none');
            const p = flip ? (alternate === a ? [0.99, 0.01] : [0.01, 0.99]) : decision.p;
            // The target remains selectable and receives its own ordinary label.
            // Its system-1 and system-2 opinions agree, avoiding any assumption
            // about a target-required label competing with an extreme opinion.
            const chatLabels: Json[] = [
              { units: String(unit), label: chat, ...(target && !flip ? { target: socket } : {}) },
              { units: String(socket), label: b },
              { units: String(quiet), label: 'none' },
            ];
            const result: Json[] = [
              { n: unit, label, ...(target && !flip ? { target: socket } : {}) },
              { n: socket, label: b },
              { n: quiet, label: 'none' },
            ];
            return probe(
              'labels',
              {
                action: 'decide',
                mode: decision.mode,
                set: { name: `set-${name}`, labels: definitions },
                window: { id: `window-${name}`, units },
                probabilities: {
                  [`u${unit}__${a}`]: p[0] ?? 0,
                  [`u${unit}__${b}`]: p[1] ?? 0,
                  [`u${socket}__${a}`]: 0.01,
                  [`u${socket}__${b}`]: 0.99,
                  [`u${quiet}__${a}`]: 0.01,
                  [`u${quiet}__${b}`]: 0.02,
                },
                system2: { window: `window-${name}`, set: `set-${name}`, labels: chatLabels },
                threshold: 0.4,
                passAt: 0.9,
                failAt: 0.1,
              },
              { labels: result },
            );
          };
          const first = make(false);
          const second = make(true);
          // A separate, unchanged fixture is replayed under four policies. Only
          // mode and threshold change: neither the chat answer nor the probability
          // table contains the desired policy result. This contrast also protects
          // legitimate chat-only and intermediate-stack items from a chat copier.
          // No target-required label participates in this policy comparison.
          const companion = {
            action: 'decide',
            set: {
              name: `comparison-${name}`,
              labels: definitions.filter((definition) => {
                const entry = definition as { name: string };
                return entry.name === a || entry.name === b;
              }),
            },
            window: { id: `comparison-window-${name}`, units },
            probabilities: {
              [`u${unit}__${a}`]: 0.84,
              [`u${unit}__${b}`]: 0.11,
              [`u${socket}__${a}`]: 0.03,
              [`u${socket}__${b}`]: 0.96,
              [`u${quiet}__${a}`]: 0.08,
              [`u${quiet}__${b}`]: 0.02,
            },
            system2: {
              window: `comparison-window-${name}`,
              set: `comparison-${name}`,
              labels: [
                { units: String(unit), label: b },
                { units: String(socket), label: a },
                { units: String(quiet), label: b },
              ],
            },
            passAt: 0.9,
            failAt: 0.1,
          };
          const policies = [
            { mode: 'system1', threshold: 0.4, labels: [a, b, 'none'] },
            { mode: 'system1', threshold: 0.9, labels: ['none', b, 'none'] },
            { mode: 'system2', threshold: 0.4, labels: [b, a, b] },
            { mode: 'stack', threshold: 0.4, labels: [b, b, 'none'] },
          ];
          const contrasts = policies.map((policy) =>
            probe(
              'labels',
              { ...companion, mode: policy.mode, threshold: policy.threshold },
              {
                labels: [unit, socket, quiet].map((n, i) => ({
                  n,
                  label: policy.labels[i] ?? 'none',
                })),
              },
            ),
          );
          return { probes: [first, second, ...contrasts] };
        },
      }),
    ),
  );
}
