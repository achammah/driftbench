import type { PointerSut } from './port';
import { realReader } from './reader';

/**
 * The binding of the pointer reader to the bank's port (`reader.ts`). When the checkout has no reader, every call
 * fails with ReaderNotReachable, so each item fails with a message that says so.
 *
 * `DRIFTBENCH_POINTER_SUT` names a module (an absolute path) whose default export is a PointerSut or a function
 * returning one. The bank's tests use it to run the items against a reference reader, in the same process and in
 * child processes. CI never sets it.
 */

const unreachable = (reason: string): PointerSut => {
  const fail = async (): Promise<never> => {
    throw new Error(reason);
  };
  return { name: 'unreachable', cut: fail, scan: fail };
};

/** Resolves the system under test for this process. */
export async function resolveSut(): Promise<PointerSut> {
  const module = process.env.DRIFTBENCH_POINTER_SUT;
  if (module !== undefined && module !== '') {
    const loaded = (await import(module)) as {
      default?: PointerSut | (() => PointerSut | Promise<PointerSut>);
    };
    const target = loaded.default;
    if (typeof target === 'function') return await target();
    if (target) return target;
    return unreachable(`${module} has no default export`);
  }
  return realReader();
}
