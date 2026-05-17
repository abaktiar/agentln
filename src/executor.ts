import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ActionResult, PlannedAction } from "./types.js";

export interface ExecuteOptions {
  dryRun: boolean;
  force: boolean;
  /** If true, fall back to copying the file when symlink creation fails. */
  copyFallback: boolean;
}

const IS_WINDOWS = process.platform === "win32";

/**
 * On Windows, `fs.symlink` needs an explicit type hint ("file" or "dir").
 * On POSIX systems the type arg is ignored.
 */
async function createRelativeSymlink(
  linkPath: string,
  sourcePath: string,
  isDirectory: boolean,
): Promise<void> {
  const target = path.relative(path.dirname(linkPath), sourcePath);
  const winType = isDirectory ? "dir" : "file";
  await fs.symlink(target, linkPath, IS_WINDOWS ? winType : undefined);
}

/** Remove a file, symlink, or directory tree. No-op if the path is missing. */
async function safeRemove(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

async function ensureParentDir(p: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

async function copyEntry(
  sourcePath: string,
  destPath: string,
  isDirectory: boolean,
): Promise<void> {
  if (isDirectory) {
    await fs.cp(sourcePath, destPath, { recursive: true });
  } else {
    await fs.copyFile(sourcePath, destPath);
  }
}

function isSymlinkPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "ENOSYS";
}

export async function executeAction(
  action: PlannedAction,
  options: ExecuteOptions,
): Promise<ActionResult> {
  switch (action.type) {
    case "skip":
      return { action, ok: true, message: `skipped (${action.reason})` };

    case "create-root-source": {
      if (options.dryRun) {
        return { action, ok: true, message: "would create empty source file" };
      }
      try {
        const handle = await fs.open(action.sourcePath, "wx");
        await handle.close();
        return { action, ok: true, message: "created empty source file" };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          return { action, ok: true, message: "source file already exists" };
        }
        return { action, ok: false, message: errorMessage(err) };
      }
    }

    case "create-symlink": {
      const noun = action.isDirectory ? "directory symlink" : "symlink";
      if (options.dryRun) {
        const verb = action.replacesExisting ? "replace" : "create";
        return { action, ok: true, message: `would ${verb} ${noun}` };
      }

      // Guard real-content replacement (real file or real directory) behind --force.
      if (action.replacesExisting && action.replacesRegularFile && action.isDirectory) {
        return {
          action,
          ok: false,
          message:
            `${action.linkPath} is a non-empty directory; refusing to replace it ` +
            "with a symlink without --force (this would delete its contents).",
        };
      }

      try {
        if (action.replacesExisting) await safeRemove(action.linkPath);
        await ensureParentDir(action.linkPath);
        await createRelativeSymlink(action.linkPath, action.sourcePath, action.isDirectory);
        return { action, ok: true, message: `${noun} created` };
      } catch (err) {
        if (IS_WINDOWS && isSymlinkPermissionError(err) && options.copyFallback) {
          try {
            await safeRemove(action.linkPath);
            await ensureParentDir(action.linkPath);
            await copyEntry(action.sourcePath, action.linkPath, action.isDirectory);
            return {
              action,
              ok: true,
              message:
                `${noun} not permitted on this system; wrote a ${action.isDirectory ? "recursive copy" : "file copy"} instead. ` +
                "Re-run after enabling Developer Mode or with admin privileges " +
                "to use real symlinks.",
              fellBackToCopy: true,
            };
          } catch (copyErr) {
            return { action, ok: false, message: errorMessage(copyErr) };
          }
        }
        if (IS_WINDOWS && isSymlinkPermissionError(err)) {
          return {
            action,
            ok: false,
            message:
              `creating a ${noun} was denied by the OS. On Windows, enable ` +
              "Developer Mode or run an elevated shell, or re-run with " +
              `--copy-fallback to write a ${action.isDirectory ? "recursive copy" : "regular file copy"} instead.`,
          };
        }
        return { action, ok: false, message: errorMessage(err) };
      }
    }

    case "promote-to-source": {
      const noun = action.isDirectory ? "directory" : "file";
      if (options.dryRun) {
        return {
          action,
          ok: true,
          message: `would rename ${noun} ${path.basename(action.fromPath)} → ${path.basename(action.toPath)} and link back`,
        };
      }
      try {
        // If the target source path already exists (race or stale state) and
        // we'd otherwise overwrite, bail out unless --force was requested.
        let targetExists = false;
        try {
          await fs.lstat(action.toPath);
          targetExists = true;
        } catch {
          targetExists = false;
        }
        if (targetExists && !options.force) {
          return {
            action,
            ok: false,
            message:
              `${action.toPath} already exists; refusing to overwrite without --force.`,
          };
        }
        if (targetExists) await safeRemove(action.toPath);
        await ensureParentDir(action.toPath);
        await fs.rename(action.fromPath, action.toPath);
        await createRelativeSymlink(action.fromPath, action.toPath, action.isDirectory);
        return {
          action,
          ok: true,
          message: `promoted ${noun} to source and linked back`,
        };
      } catch (err) {
        if (IS_WINDOWS && isSymlinkPermissionError(err) && options.copyFallback) {
          try {
            await copyEntry(action.toPath, action.fromPath, action.isDirectory);
            return {
              action,
              ok: true,
              message:
                `symlink not permitted; wrote a ${action.isDirectory ? "recursive copy" : "file copy"} as fallback. ` +
                "The two paths will diverge on subsequent edits.",
              fellBackToCopy: true,
            };
          } catch (copyErr) {
            return { action, ok: false, message: errorMessage(copyErr) };
          }
        }
        return { action, ok: false, message: errorMessage(err) };
      }
    }
  }
}

export function isWindowsHost(): boolean {
  return IS_WINDOWS;
}

export function platformLabel(): string {
  return `${process.platform} (${os.release()})`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}
