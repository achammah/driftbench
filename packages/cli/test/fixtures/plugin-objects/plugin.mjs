// A test plugin that registers one of each part of the rules framework: a kind, two rules, an evidence name,
// a diagnostic step, a prompt template and three objects of its own, which specs/routed.yaml uses by id.

/** A params schema with zod's safeParse shape: `tone` must be one of the listed words. */
const toneParams = {
  safeParse(value) {
    const tone = value?.tone;
    return tone === undefined || ['plain', 'warm'].includes(tone)
      ? { success: true, data: value }
      : {
          success: false,
          error: { issues: [{ code: 'custom', path: ['tone'], message: 'tone is plain or warm' }] },
        };
  },
};

export default function plugin(api) {
  api.kind('policy/routing', { summary: 'Which team a conversation goes to.' });
  api.rule('policy/routing', 'route-by-intent', { run: () => 'sales' });
  api.rule('check-set', 'acme-tone', { params: toneParams, run: () => [] });
  api.evidence('check-set', 'tone_score', () => 0.5);
  api.diagnosticStep('acme-dedup', () => ({ duplicates: 0 }));
  api.promptTemplate(
    'linker/acme',
    { system: 'You link blocks to prompt units.', rubric: 'One unit per line.' },
    (answer) => answer.split('\n'),
  );
  api.object('objects/policy-routing-intent.yaml');
  api.object('objects/check-set-acme.yaml');
  api.object('objects/diagnostic-acme-dedup.yaml');
}
