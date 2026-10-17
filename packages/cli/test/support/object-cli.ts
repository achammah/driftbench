import { Command, CommanderError } from 'commander';
import type { Io } from '../../src/io';

type Registered = (program: Command, io: Io, setExit: (code: number) => void) => void;

/** Runs one command the way main does: one program, the command registered, exit 2 on a usage error. */
export async function cliRun(
  register: Registered,
  argv: string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.out(text), writeErr: (text) => io.err(text) });
  register(program, io, (exit) => {
    code = exit;
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}
