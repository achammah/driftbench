export type DispatcherFormCase = {
  kind: string;
  name: string;
  source: string;
  args: string[];
  target?: string;
};
// Written before inspecting reviewed dispatcher fixtures. Each case varies argument flow or sink role.
export const dispatcherFormCases: DispatcherFormCase[] = [
  {
    kind: 'plain tools',
    name: 'usage input file with script extension is data',
    source: '# Usage: cli.py <name>\n# Reads data/<name>.py as text.\nprint("tool")',
    args: ['summary'],
  },
  {
    kind: 'plain tools',
    name: 'usage filename example is not execution',
    source: '# Usage: cli.py <name>\n# Example output path: reports/<name>.py\nprint("tool")',
    args: ['report'],
  },

  {
    kind: 'documentation',
    name: 'generic script prints first argument',
    source: '"""This script prints its first argument."""',
    args: ['status'],
  },
  {
    kind: 'documentation',
    name: 'first argument is subcommand for script',
    source: '"""The first argument is a subcommand for this script."""',
    args: ['status'],
  },
  {
    kind: 'documentation',
    name: 'path before usage with repeated second positional',
    source:
      '# Entrypoint is jobs/<unit>.py.\n# Usage: chooser.py <mode> <unit>.\n# A second mention: jobs/<unit>.py',
    args: ['quiet', 'compile'],
    target: 'jobs/compile.py',
  },
  {
    kind: 'documentation',
    name: 'usage valued flag before second positional',
    source: '# Usage: cli.py --profile <profile> <mode> <unit>\n# Entrypoint: steps/<unit>.py',
    args: ['--profile', 'daily', 'fast', 'inspect'],
    target: 'steps/inspect.py',
  },
  {
    kind: 'documentation',
    name: 'usage flag value equals form',
    source: '# Usage: cli.py --unit <name>.\n# Entrypoint: steps/<name>.py',
    args: ['--unit=render'],
    target: 'steps/render.py',
  },
  {
    kind: 'parsed options',
    name: 'boolean prefix does not consume positional',
    source:
      'parser.add_argument("--verbose", action="store_true")\nparser.add_argument("unit")\nargs = parser.parse_args()\nrunpy.run_path("steps/" + args.unit + ".py")',
    args: ['--verbose', 'render'],
    target: 'steps/render.py',
  },
  {
    kind: 'plain tools',
    name: 'boolean value cannot name an executable',
    source:
      'parser.add_argument("--verbose", action="store_true")\nargs = parser.parse_args()\nrunpy.run_path(args.verbose)',
    args: ['--verbose', 'status'],
  },
  {
    kind: 'path quoting',
    name: 'list argv path preserves spaces',
    source: 'subprocess.run(["python3", "tasks/" + sys.argv[1] + ".py"])',
    args: ['check inventory'],
    target: 'tasks/check inventory.py',
  },
  {
    kind: 'path quoting',
    name: 'runpy direct file preserves spaces',
    source: 'runpy.run_path(sys.argv[1])',
    args: ['tasks/check inventory.py'],
    target: 'tasks/check inventory.py',
  },

  {
    kind: 'path joins',
    name: 'pathlib parent chain retains filename expression',
    source:
      'import sys, subprocess\nroot = Path(__file__).parent.resolve().parent\nselected = root / (sys.argv[1] + ".py")\nsubprocess.run(["python3", str(selected)])',
    args: ['archive'],
    target: 'archive.py',
  },

  {
    kind: 'interpolation',
    name: 'Python formatted basename in subprocess',
    source: 'import subprocess, sys\nsubprocess.run([sys.executable, f"workers/{sys.argv[1]}.py"])',
    args: ['cleanup'],
    target: 'workers/cleanup.py',
  },
  {
    kind: 'interpolation',
    name: 'Python second input reaches formatted path',
    source:
      'import subprocess, sys\nchoice = sys.argv[2]\nfile = f"jobs/{choice}.py"\nsubprocess.check_call(["python3", file])',
    args: ['quiet', 'rebuild'],
    target: 'jobs/rebuild.py',
  },
  {
    kind: 'path joins',
    name: 'os path join flows through local aliases',
    source:
      'import os, sys, subprocess\nslug = sys.argv[1]\nfile = os.path.join("checks", slug + ".py")\nsubprocess.run([sys.executable, file])',
    args: ['lint'],
    target: 'checks/lint.py',
  },
  {
    kind: 'path joins',
    name: 'pathlib division produces executed file',
    source:
      'import sys, runpy\nfolder = Path("checks")\nfile = folder / (sys.argv[1] + ".py")\nrunpy.run_path(str(file))',
    args: ['style'],
    target: 'checks/style.py',
  },
  {
    kind: 'shell command',
    name: 'os system retains interpolation',
    source: 'import os, sys\nfilename = f"jobs/{sys.argv[1]}.py"\nos.system(f"python3 {filename}")',
    args: ['backup'],
    target: 'jobs/backup.py',
  },
  {
    kind: 'shell command',
    name: 'os system concatenated command path',
    source: 'import os, sys\nos.system("python3 " + "tasks/" + sys.argv[1] + ".py")',
    args: ['sort'],
    target: 'tasks/sort.py',
  },
  {
    kind: 'parsed options',
    name: 'argparse long option with renamed destination',
    source:
      'parser.add_argument("--job", dest="unit")\nopts = parser.parse_args()\ntarget = os.path.join("tasks", opts.unit + ".py")\nsubprocess.run(["python3", target])',
    args: ['--job', 'summarize'],
    target: 'tasks/summarize.py',
  },
  {
    kind: 'parsed options',
    name: 'argparse hyphenated option attribute',
    source:
      'parser.add_argument("--check-name")\nconfig = parser.parse_args()\nrunpy.run_path(f"checks/{config.check_name}.py")',
    args: ['--check-name=types'],
    target: 'checks/types.py',
  },
  {
    kind: 'parsed options',
    name: 'argparse positional after flag',
    source:
      'parser.add_argument("--profile")\nparser.add_argument("unit")\ninput = parser.parse_args()\nrunpy.run_path("units/" + input.unit + ".py")',
    args: ['--profile', 'daily', 'imports'],
    target: 'units/imports.py',
  },
  {
    kind: 'argv selectors',
    name: 'Python finds option value in argv',
    source:
      'import sys, runpy\nslug = sys.argv[sys.argv.index("--unit") + 1]\nrunpy.run_path("units/" + slug + ".py")',
    args: ['--unit', 'format'],
    target: 'units/format.py',
  },
  {
    kind: 'argv slices',
    name: 'Python sliced argv local then index',
    source:
      'import sys, runpy\narguments = sys.argv[1:]\nselected = arguments[1]\nrunpy.run_path("steps/" + selected + ".py")',
    args: ['fast', 'inspect'],
    target: 'steps/inspect.py',
  },
  {
    kind: 'argv slices',
    name: 'Python unpacking from sliced argv',
    source: 'import sys, runpy\nmode, unit = sys.argv[1:]\nrunpy.run_path(f"steps/{unit}.py")',
    args: ['full', 'audit'],
    target: 'steps/audit.py',
  },
  {
    kind: 'argv slices',
    name: 'Python starred rest unpacking',
    source: 'import sys, runpy\nmode, *rest = sys.argv[1:]\nrunpy.run_path("steps/" + rest[0] + ".py")',
    args: ['full', 'audit'],
    target: 'steps/audit.py',
  },
  {
    kind: 'imports',
    name: 'importlib file specification flows to loaded module',
    source:
      'import sys, importlib.util\nfile = "plugins/" + sys.argv[1] + ".py"\nspec = importlib.util.spec_from_file_location("selected", file)\nmodule = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)',
    args: ['spell'],
    target: 'plugins/spell.py',
  },
  {
    kind: 'JavaScript',
    name: 'require template interpolation',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source code for the reader to inspect.
    source: 'const selected = process.argv[2];\nrequire(`./jobs/${selected}.js`);',
    args: ['compile'],
    target: 'jobs/compile.js',
  },
  {
    kind: 'JavaScript',
    name: 'require path join and second positional',
    source: 'const filename = path.join(__dirname, "jobs", process.argv[3] + ".cjs");\nrequire(filename);',
    args: ['daily', 'digest'],
    target: 'jobs/digest.cjs',
  },
  {
    kind: 'JavaScript',
    name: 'argv slice and destructuring',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source code for the reader to inspect.
    source: 'const [mode, task] = process.argv.slice(2);\nrequire(`jobs/${task}.js`);',
    args: ['local', 'render'],
    target: 'jobs/render.js',
  },
  {
    kind: 'JavaScript',
    name: 'execFile interpreter gets argument path',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source code for the reader to inspect.
    source: 'const script = `jobs/${process.argv[2]}.js`;\nexecFile("node", [script]);',
    args: ['index'],
    target: 'jobs/index.js',
  },
  {
    kind: 'Ruby',
    name: 'Ruby load joined argument path',
    source: 'name = ARGV[0]\nfile = File.join("checks", name + ".rb")\nload file',
    args: ['schema'],
    target: 'checks/schema.rb',
  },
  {
    kind: 'Ruby',
    name: 'Ruby interpolated load',
    source: 'name = ARGV[1]\nload "steps/#{name}.rb"',
    args: ['local', 'summarize'],
    target: 'steps/summarize.rb',
  },
  {
    kind: 'Shell',
    name: 'shell second positional resolves file',
    source: '#!/bin/sh\nunit=$2\nexec python3 "checks/$unit.py"',
    args: ['quiet', 'layout'],
    target: 'checks/layout.py',
  },
  {
    kind: 'documentation',
    name: 'usage path relation independent of prose predicate',
    source: '# Usage: command.py <unit>\n# The entrypoint is checks/<unit>.py.\nprint("stub")',
    args: ['style'],
    target: 'checks/style.py',
  },
  {
    kind: 'documentation',
    name: 'same line usage and argument role',
    source: '"""Usage: command.py NAME. The hook named by first argument is the entry point."""\npass',
    args: ['guard'],
    target: 'guard',
  },
  {
    kind: 'documentation',
    name: 'usage option file contract',
    source: '# Usage: dispatch.rb --unit <name>\n# Entrypoint: jobs/<name>.rb\nputs "stub"',
    args: ['--unit', 'brief'],
    target: 'jobs/brief.rb',
  },
  {
    kind: 'plain tools',
    name: 'Python subcommand matched with branches',
    source: 'import sys\nif sys.argv[1] == "status":\n    print("ready")',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'argparse subcommand option passed as data',
    source:
      'parser.add_argument("--job")\nargs = parser.parse_args()\nsubprocess.run(["git", "show", args.job])',
    args: ['--job', 'log'],
  },
  {
    kind: 'plain tools',
    name: 'argparse data in fixed Python script arguments',
    source:
      'parser.add_argument("--job")\nargs = parser.parse_args()\nsubprocess.run(["python3", "worker.py", args.job])',
    args: ['--job', 'log'],
  },
  {
    kind: 'plain tools',
    name: 'formatted shell argument after fixed program',
    source: 'import os, sys\nos.system(f"git show {sys.argv[1]}")',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'printing a formatted path is not executing',
    source: 'import sys\nprint(f"checks/{sys.argv[1]}.py")',
    args: ['schema'],
  },
  {
    kind: 'plain tools',
    name: 'reading a path is not executing',
    source: 'name = sys.argv[1]\nopen("data/" + name + ".py").read()',
    args: ['summary'],
  },
  {
    kind: 'plain tools',
    name: 'mapped selector remains value lookup',
    source: 'name = sys.argv[1]\nfile = {"status": "status.py"}[name]\nrunpy.run_path(file)',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'JavaScript data array after executable',
    source: 'spawn("git", ["show", process.argv[2]]);',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'Ruby command dispatch table',
    source: 'choice = ARGV[0]\nputs({"status" => "ready"}[choice])',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'usage line declares a command not file',
    source: '# Usage: command.py <command>\n# Commands: status, report, validate.\nprint("ready")',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'quoted example source is data',
    source: 'example = "runpy.run_path(sys.argv[1])"\nprint(example)',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'commented execution is data',
    source: '# runpy.run_path(sys.argv[1])\nprint(sys.argv[1])',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'overwritten alias no longer depends on input',
    source: 'name = sys.argv[1]\nname = "fixed.py"\nrunpy.run_path(name)',
    args: ['status'],
  },
  {
    kind: 'plain tools',
    name: 'importlib specification alone does not import',
    source:
      'spec = importlib.util.spec_from_file_location("named", "plugins/" + sys.argv[1] + ".py")\nprint(spec)',
    args: ['schema'],
  },
  {
    kind: 'plain tools',
    name: 'help flag is not a documented file argument',
    source: '# Runs the script named by its first argument.\nprint("help")',
    args: ['--help'],
  },
];
