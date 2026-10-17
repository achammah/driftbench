import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { main } from '../src/index';

const variants = [
  { name: 'allow-all', decision: 'allow', positive: false, negative: true },
  { name: 'block-all', decision: 'block', positive: true, negative: false },
  { name: 'message-only', decision: 'message', positive: false, negative: true },
  { name: 'correct', decision: 'conditional', positive: true, negative: true },
] as const;

it.each(variants)(
  'judges unqualified guard expectations by blocking decisions for a $name guard',
  async ({ decision, positive, negative }) => {
    const root = await mkdtemp(join(tmpdir(), 'unit-access-policy-'));
    try {
      await mkdir(join(root, '.claude/hooks'), { recursive: true });
      await writeFile(join(root, 'CLAUDE.md'), '# A hand-written archive-access estate\n');
      const source = [
        'import json,sys',
        'event=json.load(sys.stdin)',
        `mode=${JSON.stringify(decision)}`,
        'if mode == "message":',
        '    print("Archive access requires a permit")',
        'else:',
        '    blocked=mode == "block" or (mode == "conditional" and event["tool_input"]["command"] == "archive restricted")',
        '    print(json.dumps({"hookSpecificOutput":{"permissionDecision":"deny" if blocked else "allow","permissionDecisionReason":"Archive access requires a permit" if blocked else "Public archive access is allowed"}}))',
      ].join('\n');
      await writeFile(join(root, '.claude/hooks/archive.py'), source);
      const command = 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/archive.py';
      await writeFile(
        join(root, '.claude/settings.json'),
        JSON.stringify({
          hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] },
        }),
      );
      const spec = (control: boolean) => ({
        id: control ? 'public-archive' : 'restricted-archive',
        title: 'Check archive access',
        kind: 'task',
        target: { adapter: 'claude-code' },
        blocks: [
          {
            user: 'Request archive access',
            expect: { guards: [{ name: 'archive.py', count: control ? 0 : { min: 1 } }] },
          },
        ],
        metadata: {
          estate: {
            mode: 'unit',
            testType: control ? 'guard_negative' : 'guard_positive',
            unit: {
              target: { kind: 'guard', name: 'archive.py', event: 'PreToolUse', matcher: 'Bash', command },
              cases: [
                {
                  id: 'request',
                  material: 'archive access',
                  payload: {
                    tool_name: 'Bash',
                    tool_input: { command: control ? 'archive public' : 'archive restricted' },
                  },
                },
              ],
            },
          },
        },
      });
      for (const [control, passes] of [
        [false, positive],
        [true, negative],
      ] as const) {
        const file = join(root, 'access.yaml');
        await writeFile(file, stringify(spec(control)));
        let out = '';
        let err = '';
        const code = await main(['estate', 'unit', file, '--estate', root, '--json'], {
          cwd: root,
          out: (text) => {
            out += text;
          },
          err: (text) => {
            err += text;
          },
        });
        expect(err).toBe('');
        expect(code, `${control ? 'negative' : 'positive'}: ${out}`).toBe(passes ? 0 : 1);
        const report = JSON.parse(out);
        expect(report.runs[0].pass).toBe(passes);
        expect(report.guards[0].decision).toBe(
          decision === 'block' || (decision === 'conditional' && !control) ? 'deny' : 'allow',
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
