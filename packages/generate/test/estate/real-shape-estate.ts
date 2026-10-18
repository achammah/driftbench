/**
 * A fictional logistics-desk estate that reproduces the shapes of a large real estate: many skills with
 * different purposes, references listed without any task, example and placeholder files, helper agents,
 * a shared folder cited by several units, a catalogue skill that cites everything, and hook guards whose
 * rule text sits in a script docstring. No validator input, bank string or private estate text.
 */

type Unit = { name: string; description: string; verb: string; object: string };

/** Twenty-six skills, each with its own purpose. The description is the unit's one-line purpose. */
export const UNITS: readonly Unit[] = [
  {
    name: 'carrier-invoices',
    description: 'Reconciles carrier invoices against delivery receipts before a payment run.',
    verb: 'reconciling',
    object: 'carrier invoice lines',
  },
  {
    name: 'customs-forms',
    description: 'Prepares customs declarations for cross-border parcels.',
    verb: 'preparing',
    object: 'customs declaration lines',
  },
  {
    name: 'returns-desk',
    description: 'Handles customer return requests and issues return labels.',
    verb: 'issuing',
    object: 'return labels',
  },
  {
    name: 'pickup-planner',
    description: 'Schedule courier pickups 4 steps. Use when the docks are busy.',
    verb: 'scheduling',
    object: 'courier pickups',
  },
  {
    name: 'damage-claims',
    description: 'Damage claim intake is ONE atomic write. Files claims with carriers.',
    verb: 'filing',
    object: 'damage claims',
  },
  {
    name: 'rate-quotes',
    description: 'Quotes freight rates for pallet and parcel shipments.',
    verb: 'quoting',
    object: 'freight rates',
  },
  {
    name: 'dock-roster',
    description: 'Builds the weekly dock staffing roster from the shift calendar.',
    verb: 'building',
    object: 'dock rosters',
  },
  {
    name: 'stock-counts',
    description: 'Runs cycle counts and records stock variances per aisle.',
    verb: 'recording',
    object: 'stock variances',
  },
  {
    name: 'supplier-onboarding',
    description: 'Onboards a new supplier and collects their compliance documents.',
    verb: 'onboarding',
    object: 'supplier records',
  },
  {
    name: 'delivery-promises',
    description: 'Calculates delivery promise dates for open customer orders.',
    verb: 'calculating',
    object: 'promise dates',
  },
  {
    name: 'route-audits',
    description: 'Audits planned delivery routes for time window conflicts.',
    verb: 'auditing',
    object: 'delivery routes',
  },
  {
    name: 'hazmat-labels',
    description: 'Creates hazardous goods labels and safety data sheets for outbound crates.',
    verb: 'creating',
    object: 'hazard labels',
  },
  {
    name: 'fleet-service',
    description: 'Tracks vehicle service intervals and books workshop slots.',
    verb: 'booking',
    object: 'workshop slots',
  },
  {
    name: 'driver-payroll',
    description: 'Totals driver hours and prepares the payroll export.',
    verb: 'totalling',
    object: 'driver hours',
  },
  {
    name: 'warehouse-slotting',
    description: 'Assigns incoming pallets to storage slots by turnover class.',
    verb: 'assigning',
    object: 'storage slots',
  },
  {
    name: 'customer-notices',
    description: 'Drafts delay notices for customers whose parcels are late.',
    verb: 'drafting',
    object: 'delay notices',
  },
  {
    name: 'tender-replies',
    description: 'Answers freight tender requests with a priced offer.',
    verb: 'pricing',
    object: 'tender offers',
  },
  {
    name: 'pallet-pooling',
    description: 'Balances the pool of returnable pallets between depots.',
    verb: 'balancing',
    object: 'pallet pools',
  },
  {
    name: 'cold-chain',
    description: 'Monitors temperature logs of refrigerated loads and flags excursions.',
    verb: 'flagging',
    object: 'temperature excursions',
  },
  {
    name: 'border-queues',
    description: 'Estimates border crossing waits for the trucks on the road.',
    verb: 'estimating',
    object: 'crossing waits',
  },
  {
    name: 'invoice-disputes',
    description: 'Opens and follows up billing disputes with customers.',
    verb: 'following up',
    object: 'billing disputes',
  },
  {
    name: 'load-planning',
    description: 'Plans how parcels are loaded into trailers by weight and destination.',
    verb: 'planning',
    object: 'trailer loads',
  },
  {
    name: 'shift-handover',
    description: 'Writes the shift handover note for the next dock lead.',
    verb: 'writing',
    object: 'handover notes',
  },
  {
    name: 'incident-reports',
    description: 'Collects facts about a yard incident and files the safety report.',
    verb: 'filing',
    object: 'incident reports',
  },
  {
    name: 'tariff-updates',
    description: 'Loads new carrier tariff tables and compares them with the old ones.',
    verb: 'loading',
    object: 'tariff tables',
  },
  {
    name: 'partner-scorecards',
    description: 'Scores carrier partners on punctuality and damage rates each quarter.',
    verb: 'scoring',
    object: 'partner scorecards',
  },
];

const MOMENTS = ['Preparing', 'Checking', 'Closing out'] as const;

/** Helper agents of the estate. Each is a single file that cites shared documents. */
export const HELPERS = [
  {
    name: 'ledger-checker',
    description: 'Checks a ledger extract for duplicate payments and returns findings.',
  },
  { name: 'label-printer', description: 'Renders shipping labels from a prepared address batch.' },
  { name: 'dock-scanner', description: 'Compares a scanned pallet list with the expected inbound manifest.' },
  { name: 'route-reviewer', description: 'Reviews a proposed route plan and lists time window conflicts.' },
  { name: 'tariff-diff', description: 'Compares two tariff tables and reports changed rates.' },
  { name: 'notice-proofreader', description: 'Proofreads a customer notice for tone and missing facts.' },
] as const;

const SHARED = [
  'glossary',
  'handoff-format',
  'escalation-ladder',
  'carrier-codes',
  'address-rules',
  'unit-conversions',
  'holiday-calendar',
  'contact-sheet',
  'severity-scale',
  'tone-guide',
] as const;

/** The paths of the example and placeholder files; the map records them as non-normative documents. */
export function navigationPaths(files: Record<string, string>): { path: string; role: string }[] {
  return Object.keys(files)
    .filter((path) => /\/(?:examples|templates)\//.test(path))
    .map((path) => ({ path, role: path.includes('/templates/') ? 'template' : 'example' }));
}

export function realShapeEstate(options: { skills?: number; gates?: number } = {}): Record<string, string> {
  const count = Math.min(options.skills ?? UNITS.length, UNITS.length);
  const gates = options.gates ?? 8;
  const files: Record<string, string> = {};
  const routes: string[] = [];
  for (const [index, unit] of UNITS.slice(0, count).entries()) {
    const home = `.claude/skills/${unit.name}`;
    // Every third description carries what a real one does: examples in brackets and a purpose clause.
    const description =
      index % 3 === 0
        ? `${unit.description.replace(/\.$/, '')} (see the desk wiki for examples) so that the next shift starts clean.`
        : unit.description;
    const lines = [
      '---',
      `name: ${unit.name}`,
      `description: ${description}`,
      '---',
      `# ${unit.name}\n`,
      '## Gates\n',
    ];
    for (let gate = 0; gate < gates; gate++) {
      const topic = `${unit.object} batch ${gate + 1}`;
      lines.push(
        `- Before ${unit.verb} ${topic}: Read references/rule-${gate}.md.`,
        `- Before ${unit.verb} ${topic}, read references/rule-${gate}.md.`,
      );
      files[`${home}/references/rule-${gate}.md`] =
        `# Rule ${gate}\nHow ${unit.object} batch ${gate + 1} is handled.\n`;
    }
    lines.push('\n## References\n');
    // References listed with no task in their words: a table row and bullets with a label only.
    lines.push('| Topic | File |', '|---|---|');
    for (let ref = 0; ref < 3; ref++) {
      lines.push(`| ${MOMENTS[ref]} ${unit.object} | \`references/table-${ref}.md\` |`);
      files[`${home}/references/table-${ref}.md`] = `# Table ${ref}\nReference values for ${unit.name}.\n`;
    }
    lines.push(
      `- \`references/fields.md\`: field definitions`,
      `- See \`references/limits.md\` for the full limits.`,
    );
    files[`${home}/references/fields.md`] = '# Fields\nField definitions.\n';
    files[`${home}/references/limits.md`] = '# Limits\nLimits.\n';
    // Example files listed under the skill: numbered samples of a finished output.
    for (let sample = 1; sample <= 2; sample++) {
      const path = `references/examples/sample-00${sample}.md`;
      lines.push(`- Example of a finished output: \`${path}\``);
      files[`${home}/${path}`] =
        `# Example output ${sample}\nA finished ${unit.object} sample for ${unit.name}.\n`;
    }
    lines.push(`- Blank form to fill in: \`references/templates/form.md\``);
    files[`${home}/references/templates/form.md`] = '# Form\nName: {{name}}\nDate: {{date}}\n';
    // Shared documents cited directly by this skill (never through another skill).
    for (const shared of [SHARED[index % SHARED.length], SHARED[(index + 3) % SHARED.length]]) {
      lines.push(`- Shared reference: \`.claude/shared/${shared}.md\``);
    }
    lines.push(`\nRead \`references/cutoff.md\` when planning ${unit.object} for the evening run.`);
    files[`${home}/references/cutoff.md`] = '# Cutoff\nEvening cutoff times.\n';
    files[`${home}/SKILL.md`] = `${lines.join('\n')}\n`;
    if (index % 2 === 0) {
      routes.push(`| Help with ${unit.verb} ${unit.object} | ${unit.name} |`);
    }
  }
  // A catalogue skill that links every shared document and every skill: a hostile cross-link.
  files['.claude/skills/catalogue/SKILL.md'] = [
    '---',
    'name: catalogue',
    'description: Lists the documents and skills of the desk.',
    '---',
    '# Catalogue\n',
    ...SHARED.map((shared) => `- \`.claude/shared/${shared}.md\``),
    ...UNITS.slice(0, count).map((unit) => `- \`.claude/skills/${unit.name}/references/fields.md\``),
    '',
  ].join('\n');
  for (const shared of SHARED) {
    files[`.claude/shared/${shared}.md`] = `# ${shared}\nShared desk content.\n`;
  }
  for (const [index, helper] of HELPERS.entries()) {
    files[`.claude/agents/${helper.name}.md`] = [
      '---',
      `name: ${helper.name}`,
      `description: ${helper.description}`,
      'tools: Read, Grep',
      '---',
      `# ${helper.name}\n`,
      `- Report format: \`.claude/shared/${SHARED[index % SHARED.length]}.md\``,
      `- Escalation: \`.claude/shared/${SHARED[(index + 5) % SHARED.length]}.md\``,
      '',
    ].join('\n');
  }
  files['CLAUDE.md'] = ['# Logistics desk\n', '| Ask | Skill |', '|---|---|', ...routes, ''].join('\n');
  // Hook guards: rule text in the script docstring, one script per guard.
  const guards = [
    ['ledger-note', 'Edit', 'Require a review note before editing a ledger entry.'],
    ['label-batch', 'Write', 'Block writes of shipping labels outside the labels folder.'],
    ['claim-evidence', 'Edit', 'Require photo evidence before filing a damage claim.'],
    ['payroll-lock', 'Edit', 'Refuse changes to a payroll export after it is locked.'],
    ['route-window', 'Edit', 'Require a time window on every route stop.'],
    ['notice-tone', 'Write', 'Block customer notices that blame the customer.'],
    ['tariff-backup', 'Edit', 'Require a backup copy before replacing a tariff table.'],
    ['hazmat-sheet', 'Write', 'Require a safety data sheet for every hazard label.'],
    // Rule texts that name a situation, not an act: noun phrases, some with a condition.
    ['release-branch', 'Bash', 'A force push to the shared release branch is blocked.'],
    ['pallet-double', 'Edit', 'Two pallets booked for the same dock slot, when the roster is full.'],
    ['price-sheet', 'Write', 'Sending a price list to a carrier while the contract is unsigned.'],
    ['night-shift', 'Edit', 'Changes to the night shift roster after the weekly lock.'],
    ['customs-hold', 'Edit', 'A customs declaration edited before the broker has confirmed the tariff code.'],
    ['reply-length', 'Write', 'The last reply is too long.'],
    // Shapes of a real estate's hook texts that read as broken sentences once cut: a clause with a pronoun, a
    // subordinate clause, a plural noun with a parenthesis, a statement about the hook, a possessive phrase.
    ['bytecode-cache', 'Write', 'The bytecode of the file it compiles is never cached.'],
    ['hook-clause', 'Edit', 'As a hook it never blocks anything the owner asked for.'],
    ['any-call', 'Bash', 'Calls of ANY tool (Edit, Write) are logged to the journal.'],
    ['feed-once', 'Write', 'Process reads each feed ONCE, never twice.'],
    ['carrier-notes', 'Edit', "Notes on the carrier's cutoff are kept in the shared sheet."],
  ] as const;
  const hooks: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> = guards.map(
    ([name, matcher]) => ({
      matcher,
      hooks: [{ type: 'command', command: `python3 .claude/hooks/${name}.py` }],
    }),
  );
  for (const [name, , rule] of guards) {
    files[`.claude/hooks/${name}.py`] = [
      '#!/usr/bin/env python3',
      `"""${rule}"""`,
      'import sys',
      `sys.stderr.write("${rule}")`,
      'sys.exit(2)',
      '',
    ].join('\n');
  }
  // Two guards that only carry a tool matcher and no documented rule.
  for (const name of ['tool-audit', 'shell-log']) {
    files[`.claude/hooks/${name}.py`] = 'import sys\nsys.exit(0)\n';
    hooks.push({
      matcher: name === 'tool-audit' ? 'Read' : 'Bash',
      hooks: [{ type: 'command', command: `python3 .claude/hooks/${name}.py` }],
    });
  }
  files['.claude/settings.json'] = JSON.stringify({ hooks: { PreToolUse: hooks } }, null, 2);
  return files;
}
