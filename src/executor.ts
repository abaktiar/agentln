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
 * On Windows, `fs.symlink` needs an explicit type hint. We always use `file`
 * for our use case (linking a single file). On POSIX systems the type arg is
 * ignored.
 */
async function createRelativeSymlink(linkPath: string, sourcePath: string): Promise<void> {
  const target = path.relative(path.dirname(linkPath), sourcePath);
  await fs.symlink(target, linkPath, IS_WINDOWS ? "file" : undefined);
}

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

async function copyFile(sourcePath: string, destPath: string): Promise<void> {
  await fs.copyFile(sourcePath, destPath);
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
      if (options.dryRun) {
        const verb = action.replacesExisting ? "replace" : "create";
        return { action, ok: true, message: `would ${verb} symlink` };
      }

      try {
        if (action.replacesExisting) await safeUnlink(action.linkPath);
        await createRelativeSymlink(action.linkPath, action.sourcePath);
        return { action, ok: true, message: "symlink created" };
      } catch (err) {
        if (IS_WINDOWS && isSymlinkPermissionError(err) && options.copyFallback) {
          try {
            await safeUnlink(action.linkPath);
            await copyFile(action.sourcePath, action.linkPath);
            return {
              action,
              ok: true,
              message:
                "symlink not permitted on this system; wrote a file copy instead. " +
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
              "creating a symlink was denied by the OS. On Windows, enable " +
              "Developer Mode or run an elevated shell, or re-run with " +
              "--copy-fallback to write a regular file copy instead.",
          };
        }
        return { action, ok: false, message: errorMessage(err) };
      }
    }

    case "promote-to-source": {
      if (options.dryRun) {
        return {
          action,
          ok: true,
          message: `would rename ${path.basename(action.fromPath)} → ${path.basename(action.toPath)} and link back`,
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
        if (targetExists) await safeUnlink(action.toPath);
        await fs.rename(action.fromPath, action.toPath);
        await createRelativeSymlink(action.fromPath, action.toPath);
        return {
          action,
          ok: true,
          message: "promoted file to source and linked back",
        };
      } catch (err) {
        if (IS_WINDOWS && isSymlinkPermissionError(err) && options.copyFallback) {
          try {
            await copyFile(action.toPath, action.fromPath);
            return {
              action,
              ok: true,
              message:
                "symlink not permitted; wrote a file copy as fallback. The " +
                "two files will diverge on subsequent edits.",
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
