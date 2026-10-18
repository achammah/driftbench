/** A fictional editorial estate. No validator inputs or private estate text. */
export function editorialEstate(skills = 24, gates = 12): Record<string, string> {
  const files: Record<string, string> = { 'CLAUDE.md': '# Editorial desk\n' };
  const actions = ['editing', 'publishing', 'reviewing', 'translating', 'archiving', 'exporting'];
  const objects = [
    'the interview',
    'the photo caption',
    'the correction',
    'the newsletter',
    'the index',
    'the transcript',
  ];
  for (let skill = 0; skill < skills; skill++) {
    const topic = `desk-${skill}`;
    const home = `.claude/skills/${topic}`;
    const lines = [
      '---',
      `name: ${topic}`,
      'description: Manage the editorial desk and its publication queue.',
      '---',
      `# Desk ${skill}\n`,
    ];
    for (let gate = 0; gate < gates; gate++) {
      const action = actions[gate % actions.length];
      const object = objects[Math.floor(gate / actions.length) % objects.length];
      const policy = `references/policy-${gate}.md`;
      const rule = `Before ${action} ${object} for desk ${skill}: Read ${policy}.`;
      lines.push(`## ${action} ${object}\n`, rule, rule);
      files[`${home}/${policy}`] = `# Policy\nDesk ${skill}: ${action} ${object}.\n`;
    }
    files[`${home}/SKILL.md`] = `${lines.join('\n')}\n`;
  }
  return files;
}
