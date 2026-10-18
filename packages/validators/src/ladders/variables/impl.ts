import { fileURLToPath, pathToFileURL } from 'node:url';
import type { VariablesImpl } from './interface';

/** An environment variable that names another module exporting `variablesImpl`, to plant a mutant. */
export const IMPL_ENV = 'DRIFTBENCH_VARIABLES_IMPL';

/** The module the implementation is loaded from: the adapter beside this file, or the one the variable names. */
export function implModulePath(): string {
  return process.env[IMPL_ENV] ?? fileURLToPath(new URL('./adapter.ts', import.meta.url));
}

/** Loads the implementation. A module may export `variablesImpl`, a default export, or the three functions. */
export async function loadImpl(
  path: string = implModulePath(),
): Promise<{ impl: Partial<VariablesImpl>; module: string }> {
  const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const impl = (mod.variablesImpl ?? mod.default ?? mod) as Partial<VariablesImpl>;
  return { impl, module: path };
}
