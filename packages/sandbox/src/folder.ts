import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import type {
  ExecOptions,
  ExecutionRecord,
  Sandbox,
  SandboxKind,
  WorkspaceDiff,
  WorkspaceSnapshot,
  WorldState,
} from '@agent-nexus/driftbench-core';
import { trackFolder, untrackFolder } from './cleanup';
import { DEFAULT_MAX_READ_BYTES, SandboxLimitError, SandboxPathError, type SnapshotLimits } from './limits';
import { makeFoldersInside, relativeInside, resolveExisting } from './paths';
import { diffSnapshots, takeSnapshot, walkFiles } from './walk';

export type Workspace = NonNullable<WorldState['workspace']>;

/**
 * What every sandbox shares: a workspace folder on this machine that the sandbox seeds, snapshots,
 * lists and reads. A local sandbox runs commands in it; a docker sandbox mounts it in a container.
 */
export abstract class FolderSandbox implements Sandbox {
  abstract readonly kind: SandboxKind;
  abstract readonly root: string;
  abstract readonly isolation: 'strong' | 'weak';

  /**
   * @param folder the workspace folder on this machine, a real path
   * @param keep true leaves the folder on disk after destroy
   */
  protected constructor(
    readonly folder: string,
    protected readonly limits: SnapshotLimits,
    readonly keep: boolean,
  ) {
    // A kept folder is the caller's to keep: the exit sweep leaves it alone.
    if (keep) untrackFolder(folder);
  }

  abstract exec(command: string, options?: ExecOptions): Promise<ExecutionRecord>;
  abstract destroy(): Promise<void>;

  /** Copies `from` (a folder; a relative path resolves from the current directory), then writes `files` over it. */
  async seed(workspace: Workspace): Promise<void> {
    if (workspace.from !== undefined) {
      const source = resolve(workspace.from);
      const info = await stat(source).catch((error: NodeJS.ErrnoException) => {
        throw new Error(
          `the workspace folder ${workspace.from} cannot be read: ${error.code ?? error.message}`,
        );
      });
      if (!info.isDirectory()) throw new Error(`the workspace source ${workspace.from} is not a folder`);
      await this.copyFolder(source, '');
    }
    for (const [path, content] of Object.entries(workspace.files ?? {})) {
      await this.writeInside(path, Buffer.from(content, 'utf8'));
    }
    for (const path of Object.keys(workspace.binary ?? {})) {
      if (Object.hasOwn(workspace.files ?? {}, path)) {
        throw new Error(`the workspace path ${path} is in both files and binary`);
      }
    }
    for (const [path, content] of Object.entries(workspace.binary ?? {})) {
      await this.writeInside(path, Buffer.from(content, 'base64'));
    }
  }

  snapshot(): Promise<WorkspaceSnapshot> {
    return takeSnapshot(this.folder, this.limits);
  }

  diff(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiff {
    return diffSnapshots(before, after);
  }

  async listFiles(): Promise<string[]> {
    return (await walkFiles(this.folder, this.limits)).map((entry) => entry.rel);
  }

  /** Reads one file, refusing a path outside the workspace and a file larger than `maxBytes`. */
  async readFile(path: string, maxBytes: number = DEFAULT_MAX_READ_BYTES): Promise<Uint8Array> {
    const real = await resolveExisting(this.folder, path);
    const handle = await open(real, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new SandboxPathError(`the workspace path ${path} is not a file`);
      if (info.size > maxBytes) {
        throw new SandboxLimitError(
          `${path} holds ${info.size} bytes, more than the read bound of ${maxBytes}`,
        );
      }
      // Read one byte past the bound, in case the file grew after the size check.
      const buffer = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > maxBytes) {
        throw new SandboxLimitError(
          `${path} grew past the read bound of ${maxBytes} bytes while it was read`,
        );
      }
      return new Uint8Array(buffer.buffer, buffer.byteOffset, length);
    } finally {
      await handle.close();
    }
  }

  /** Removes the workspace folder unless the sandbox keeps it. */
  protected async removeFolder(): Promise<void> {
    if (!this.keep) {
      await rm(this.folder, { recursive: true, force: true });
      untrackFolder(this.folder);
    }
  }

  /**
   * The working folder of a command, relative to the workspace root. `cwd` is relative to the root, or an
   * absolute path inside the workspace as the agent sees it. The folder must exist.
   */
  protected async workingFolder(cwd: string | undefined): Promise<string> {
    if (cwd === undefined) return '.';
    let path = cwd;
    if (posix.isAbsolute(cwd)) {
      if (cwd === this.root) path = '.';
      else if (cwd.startsWith(`${this.root}/`)) path = cwd.slice(this.root.length + 1);
      else throw new SandboxPathError(`the working folder ${cwd} is outside the workspace ${this.root}`);
    }
    const rel = relativeInside(path);
    const info = await stat(join(this.folder, rel)).catch(() => undefined);
    if (!info?.isDirectory())
      throw new SandboxPathError(`the working folder ${cwd} does not exist in the workspace`);
    return rel;
  }

  /** Writes one file, replacing a symbolic link at its place, and never writes through one. */
  private async writeInside(path: string, data: Buffer): Promise<void> {
    const rel = relativeInside(path);
    if (rel === '.') throw new SandboxPathError('a seeded file needs a name');
    const folder = await makeFoldersInside(this.folder, posix.dirname(rel));
    const target = join(folder, posix.basename(rel));
    await this.clearPlace(target, rel);
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o644,
    );
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  }

  /** Copies a folder tree into the workspace with the same rules as a seeded file. Links are copied as links. */
  private async copyFolder(source: string, rel: string): Promise<void> {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = rel === '' ? entry.name : posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        await makeFoldersInside(this.folder, to);
        await this.copyFolder(from, to);
      } else if (entry.isSymbolicLink()) {
        const target = join(await makeFoldersInside(this.folder, rel), entry.name);
        const info = await this.clearPlace(target, to);
        if (info) await unlink(target);
        await symlink(await readlink(from), target);
      } else if (entry.isFile()) {
        const handle = await open(from, 'r');
        try {
          await this.writeInside(to, await handle.readFile());
        } finally {
          await handle.close();
        }
      }
    }
  }

  /** Unlinks a symbolic link at `target` and refuses a folder there. Returns what remains at the place. */
  private async clearPlace(target: string, rel: string) {
    const info = await lstat(target).catch(() => undefined);
    if (info?.isSymbolicLink()) {
      await unlink(target);
      return undefined;
    }
    if (info?.isDirectory()) throw new SandboxPathError(`the workspace path ${rel} is a folder, not a file`);
    return info;
  }
}

/** Creates an empty workspace folder under `parent` (the system temp folder by default) and returns its real path. */
export async function makeWorkspaceFolder(parent: string | undefined): Promise<string> {
  const base = parent === undefined ? tmpdir() : resolve(parent);
  await mkdir(base, { recursive: true });
  const folder = await realpath(await mkdtemp(join(base, 'driftbench-')));
  trackFolder(folder);
  return folder;
}
