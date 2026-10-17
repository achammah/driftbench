// Generic hook runners: the hook entry runs a start-up script and names the real guard as an argument.
// Each case is a hand-written runner, the words the settings file passes it, and the script it runs.
export type RunnerCase = {
  kind: string;
  name: string;
  /** The runner's source. It also carries a start-up description that is no rule. */
  source: string;
  /** The words after the runner in the hook command. */
  args: string[];
  /** The script the runner runs, relative to the estate root. */
  target: string;
  /** Where the runner lives; default `.claude/hooks/hookrun.py`. */
  runner?: string;
};

export const NOISE = 'Start-up helper that loads the environment and hands over to a named script.';

const doc = `"""${NOISE}"""\nimport os, sys, subprocess, runpy, importlib\nfrom pathlib import Path\nHERE = Path(__file__).resolve().parent\n`;

export const runnerCases: RunnerCase[] = [
  {
    kind: 'pathlib',
    name: 'name joined to the runner folder, exec of the interpreter',
    source: `${doc}name = sys.argv[1]\nscript = HERE / f"{name}.py"\nos.execv(sys.executable, [sys.executable, str(script)] + sys.argv[2:])\n`,
    args: ['sales-guard'],
    target: '.claude/hooks/sales-guard.py',
  },
  {
    kind: 'pathlib',
    name: 'subfolder of the runner folder with a suffix',
    source: `${doc}script = HERE / "guards" / (sys.argv[1] + ".py")\nsubprocess.run([sys.executable, str(script)])\n`,
    args: ['ledger-check'],
    target: '.claude/hooks/guards/ledger-check.py',
  },
  {
    kind: 'pathlib',
    name: 'parents index reaches a sibling folder',
    source: `${doc}root = Path(__file__).resolve().parents[1]\nsubprocess.run([sys.executable, str(root / "guards" / f"{sys.argv[1]}.py")])\n`,
    args: ['mail-limit'],
    target: '.claude/guards/mail-limit.py',
  },
  {
    kind: 'os.path',
    name: 'dirname of abspath of the file',
    source: `${doc}base = os.path.dirname(os.path.abspath(__file__))\nsubprocess.run([sys.executable, os.path.join(base, "checks", sys.argv[1] + ".py")])\n`,
    args: ['price-floor'],
    target: '.claude/hooks/checks/price-floor.py',
  },
  {
    kind: 'os.path',
    name: 'project folder from the environment',
    source: `${doc}root = os.environ.get("CLAUDE_PROJECT_DIR", ".")\nsubprocess.run([sys.executable, os.path.join(root, ".claude", "hooks", sys.argv[1] + ".py")])\n`,
    args: ['stock-check'],
    target: '.claude/hooks/stock-check.py',
  },
  {
    kind: 'os.path',
    name: 'project folder from a required environment key',
    source: `${doc}hooks = Path(os.environ["CLAUDE_PROJECT_DIR"]) / ".claude" / "hooks"\nsubprocess.run([sys.executable, str(hooks / f"{sys.argv[1]}.py")])\n`,
    args: ['stock-check'],
    target: '.claude/hooks/stock-check.py',
  },
  {
    kind: 'selection',
    name: 'conditional expression with a fallback',
    source: `${doc}name = sys.argv[1] if len(sys.argv) > 1 else "default"\nsubprocess.run([sys.executable, str(HERE / f"{name}.py")])\n`,
    args: ['refund-guard'],
    target: '.claude/hooks/refund-guard.py',
  },
  {
    kind: 'selection',
    name: 'string method on the name',
    source: `${doc}name = sys.argv[1].replace("-", "_")\nsubprocess.run([sys.executable, str(HERE / (name + ".py"))])\n`,
    args: ['refund-guard'],
    target: '.claude/hooks/refund_guard.py',
  },
  {
    kind: 'selection',
    name: 'removesuffix and strip on the name',
    source: `${doc}name = sys.argv[1].strip().removesuffix(".py")\nsubprocess.run([sys.executable, str(HERE / (name + ".py"))])\n`,
    args: ['refund-guard.py'],
    target: '.claude/hooks/refund-guard.py',
  },
  {
    kind: 'selection',
    name: 'name popped from the argument list',
    source: `${doc}name = sys.argv.pop(1)\nsubprocess.run([sys.executable, str(HERE / f"{name}.py")])\n`,
    args: ['refund-guard'],
    target: '.claude/hooks/refund-guard.py',
  },
  {
    kind: 'selection',
    name: 'table of names to files, every value a file of the estate',
    source: `${doc}TABLE = {"pre": "pre-guard.py", "post": "post-guard.py"}\nrunpy.run_path(str(HERE / TABLE[sys.argv[1]]), run_name="__main__")\n`,
    args: ['post'],
    target: '.claude/hooks/post-guard.py',
  },
  {
    kind: 'format',
    name: 'str.format builds the file name',
    source: `${doc}subprocess.run([sys.executable, str(HERE / "{}.py".format(sys.argv[1]))])\n`,
    args: ['seat-guard'],
    target: '.claude/hooks/seat-guard.py',
  },
  {
    kind: 'format',
    name: 'percent formatting builds the file name',
    source: `${doc}subprocess.run([sys.executable, str(HERE / ("%s.py" % sys.argv[1]))])\n`,
    args: ['seat-guard'],
    target: '.claude/hooks/seat-guard.py',
  },
  {
    kind: 'import',
    name: 'import_module of a module name',
    source: `${doc}module = importlib.import_module(sys.argv[1])\nmodule.main()\n`,
    args: ['guards.tone'],
    target: '.claude/hooks/guards/tone.py',
  },
  {
    kind: 'import',
    name: 'import_module of a formatted module name',
    source: `${doc}module = importlib.import_module(f"guards.{sys.argv[1]}")\nmodule.main()\n`,
    args: ['tone'],
    target: '.claude/hooks/guards/tone.py',
  },
  {
    kind: 'import',
    name: '__import__ of a module name',
    source: `${doc}module = __import__(sys.argv[1])\nmodule.main()\n`,
    args: ['tone'],
    target: '.claude/hooks/tone.py',
  },
  {
    kind: 'import',
    name: 'run_module of a module name',
    source: `${doc}runpy.run_module(f"checks.{sys.argv[1]}", run_name="__main__")\n`,
    args: ['tone'],
    target: '.claude/hooks/checks/tone.py',
  },
  {
    kind: 'exec',
    name: 'source compiled and executed in place',
    source: `${doc}path = HERE / (sys.argv[1] + ".py")\nexec(compile(path.read_text(), str(path), "exec"))\n`,
    args: ['quota-guard'],
    target: '.claude/hooks/quota-guard.py',
  },
  {
    kind: 'exec',
    name: 'exec of an opened file',
    source: `${doc}script = os.path.join(str(HERE), sys.argv[1] + ".py")\nexec(open(script).read())\n`,
    args: ['quota-guard'],
    target: '.claude/hooks/quota-guard.py',
  },
  {
    kind: 'options',
    name: 'named option with a destination',
    source: `${doc}import argparse\nparser = argparse.ArgumentParser()\nparser.add_argument("--hook", required=True)\nargs, rest = parser.parse_known_args()\nsubprocess.run([sys.executable, str(HERE / f"{args.hook}.py")] + rest)\n`,
    args: ['--hook', 'quota-guard'],
    target: '.claude/hooks/quota-guard.py',
  },
  {
    kind: 'options',
    name: 'positional after a timeout option',
    source: `${doc}import argparse\nparser = argparse.ArgumentParser()\nparser.add_argument("--timeout", type=int)\nparser.add_argument("hook")\nargs = parser.parse_args()\nsubprocess.run([sys.executable, str(HERE / f"{args.hook}.py")])\n`,
    args: ['--timeout', '5', 'quota-guard'],
    target: '.claude/hooks/quota-guard.py',
  },
  {
    kind: 'node',
    name: 'require of a joined path',
    source: `/** ${NOISE} */\nconst path = require("path");\nrequire(path.join(__dirname, "guards", process.argv[2]));\n`,
    args: ['stock-check'],
    target: '.claude/hooks/guards/stock-check.js',
    runner: '.claude/hooks/hookrun.js',
  },
  {
    kind: 'node',
    name: 'destructured argument and spawn',
    source: `/** ${NOISE} */\nconst { spawnSync } = require("child_process");\nconst [, , name] = process.argv;\nspawnSync("node", [\`\${__dirname}/\${name}.js\`], { stdio: "inherit" });\n`,
    args: ['stock-check'],
    target: '.claude/hooks/stock-check.js',
    runner: '.claude/hooks/hookrun.js',
  },
  {
    kind: 'shell',
    name: 'exec of the interpreter with a dirname path',
    source: `#!/bin/sh\n# ${NOISE}\nexec python3 "$(dirname "$0")/$1.py"\n`,
    args: ['route-guard'],
    target: '.claude/hooks/route-guard.py',
    runner: '.claude/hooks/hookrun.sh',
  },
  {
    kind: 'shell',
    name: 'source of a script named by the first argument',
    source: `#!/bin/bash\n# ${NOISE}\nHOOKS="\${CLAUDE_PROJECT_DIR:-.}/.claude/hooks"\nsource "$HOOKS/$1.sh"\n`,
    args: ['route-guard'],
    target: '.claude/hooks/route-guard.sh',
    runner: '.claude/hooks/hookrun.sh',
  },
  {
    kind: 'shell',
    name: 'bash on a path with the second argument',
    source: `#!/bin/bash\n# ${NOISE}\nexec bash "$(dirname "$0")/checks/$2.sh" "$@"\n`,
    args: ['pre', 'route-guard'],
    target: '.claude/hooks/checks/route-guard.sh',
    runner: '.claude/hooks/hookrun.sh',
  },
  {
    kind: 'wrapper command',
    name: 'uv run with the name after the runner',
    source: `${doc}subprocess.run([sys.executable, str(HERE / f"{sys.argv[1]}.py")])\n`,
    args: ['sales-guard'],
    target: '.claude/hooks/sales-guard.py',
  },
];

/** Written after the reader was fitted to the cases above, to see what it reads without a change. */
export const heldOutRunners: RunnerCase[] = [
  {
    kind: 'held out',
    name: 'name with its extension under a folder of the runner',
    source: `${doc}script = Path(sys.argv[0]).parent / "checks" / sys.argv[1]\nsubprocess.run([sys.executable, str(script)])\n`,
    args: ['mail-limit.py'],
    target: '.claude/hooks/checks/mail-limit.py',
  },
  {
    kind: 'held out',
    name: 'bash on a joined path',
    source: `${doc}subprocess.check_call(["bash", os.path.join(str(HERE), sys.argv[1])])\n`,
    args: ['mail-limit.sh'],
    target: '.claude/hooks/mail-limit.sh',
  },
  {
    kind: 'held out',
    name: 'os.system with a formatted command',
    source: `${doc}os.system(f"python3 {HERE}/{sys.argv[1]}.py")\n`,
    args: ['mail-limit'],
    target: '.claude/hooks/mail-limit.py',
  },
  {
    kind: 'held out',
    name: 'node fallback operand and string concatenation',
    source: `/** ${NOISE} */\nconst name = process.argv[2] || "default";\nrequire("./checks/" + name);\n`,
    args: ['mail-limit'],
    target: '.claude/hooks/checks/mail-limit.js',
    runner: '.claude/hooks/hookrun.js',
  },
  {
    kind: 'held out',
    name: 'unqualified run_path after a from import',
    source: `"""${NOISE}"""\nimport sys\nfrom runpy import run_path\nrun_path("checks/" + sys.argv[1] + ".py", run_name="__main__")\n`,
    args: ['mail-limit'],
    target: '.claude/hooks/checks/mail-limit.py',
  },
  {
    kind: 'held out',
    name: 'ruby load relative to the runner',
    source: `# ${NOISE}\nload File.join(__dir__, "checks", ARGV[0] + ".rb")\n`,
    args: ['mail-limit'],
    target: '.claude/hooks/checks/mail-limit.rb',
    runner: '.claude/hooks/hookrun.rb',
  },
  {
    kind: 'held out',
    name: 'shell dot-source with a parameter expansion of the runner folder',
    source: `#!/bin/sh\n# ${NOISE}\n. "\${0%/*}/$1.sh"\n`,
    args: ['mail-limit'],
    target: '.claude/hooks/mail-limit.sh',
    runner: '.claude/hooks/hookrun.sh',
  },
  {
    kind: 'held out',
    name: 'the runner passes its own arguments to the interpreter',
    source: `${doc}os.execvp(sys.argv[1], sys.argv[1:])\n`,
    args: ['python3', '.claude/hooks/mail-limit.py'],
    target: '.claude/hooks/mail-limit.py',
  },
  {
    kind: 'held out',
    name: 'module name inserted on the path then imported',
    source: `${doc}sys.path.insert(0, str(HERE))\n__import__(sys.argv[1])\n`,
    args: ['mail-limit'],
    target: '.claude/hooks/mail-limit.py',
  },
  {
    kind: 'held out',
    name: 'ternary and string method together',
    source: `${doc}raw = sys.argv[1] if len(sys.argv) > 1 else "x"\nname = raw.lower().replace("_", "-")\nsubprocess.run([sys.executable, str(HERE / f"{name}.py")])\n`,
    args: ['Mail_Limit'],
    target: '.claude/hooks/mail-limit.py',
  },
];

export const decoyRunners: RunnerCase[] = [
  {
    kind: 'decoy',
    name: 'a mode switch, not a script',
    source: `${doc}mode = sys.argv[1]\nif mode == "pre":\n    print("pre")\n`,
    args: ['pre'],
    target: '.claude/hooks/hookrun.py',
  },
  {
    kind: 'decoy',
    name: 'the name is data passed to a fixed script',
    source: `${doc}subprocess.run([sys.executable, str(HERE / "fixed.py"), sys.argv[1]])\n`,
    args: ['sales-guard'],
    target: '.claude/hooks/hookrun.py',
  },
  {
    kind: 'decoy',
    name: 'a table whose values are not files of the estate',
    source: `${doc}TABLE = {"pre": "missing.py"}\nrunpy.run_path(str(HERE / TABLE[sys.argv[1]]))\n`,
    args: ['pre'],
    target: '.claude/hooks/hookrun.py',
  },
  {
    kind: 'decoy',
    name: 'the name is only read as text',
    source: `${doc}text = (HERE / (sys.argv[1] + ".py")).read_text()\nprint(len(text))\n`,
    args: ['sales-guard'],
    target: '.claude/hooks/hookrun.py',
  },
];
