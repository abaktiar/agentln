import { promises as fs } from "node:fs";
import path from "node:path";

import {
  AGENTS_FILE,
  CLAUDE_FILE,
  type DirState,
  type EntryKind,
  type EntryState,
  type SourceName,
} from "./types.js";

export const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".svelte-kit",
  ".nuxt",
  ".output",
  ".vercel",
  ".idea",
  ".vscode",
]);

export interface ScanOptions {
  ignoredDirs?: Set<string>;
  followHiddenDirs?: boolean;
}

/**
 * Classify a single CLAUDE.md/AGENTS.md candidate path. Resolves the symlink
 * target without following it, so we can decide whether it already points to
 * its sibling source file.
 */
export async function classifyEntry(
  filePath: string,
  expectedSiblingSource: SourceName | null,
): Promise<EntryState> {
  let lstat;
  try {
    lstat = await fs.lstat(filePath);
  } catch {
    return { path: filePath, kind: "missing" };
  }

  if (lstat.isDirectory()) {
    return { path: filePath, kind: "directory" };
  }

  if (lstat.isSymbolicLink()) {
    let target: string;
    try {
      target = await fs.readlink(filePath);
    } catch {
      return { path: filePath, kind: "broken-symlink" };
    }

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return { path: filePath, kind: "broken-symlink", linkTarget: target };
    }

    if (!stat.isFile()) {
      return { path: filePath, kind: "incorrect-symlink", linkTarget: target };
    }

    if (expectedSiblingSource) {
      // We accept either the bare filename or "./<filename>" as correct.
      const normalised = target.replace(/^\.[\\/]/, "");
      if (normalised === expectedSiblingSource) {
        return { path: filePath, kind: "correct-symlink", linkTarget: target };
      }
      return { path: filePath, kind: "incorrect-symlink", linkTarget: target };
    }

    return { path: filePath, kind: "incorrect-symlink", linkTarget: target };
  }

  if (lstat.isFile()) {
    return { path: filePath, kind: "regular-file" };
  }

  return { path: filePath, kind: "other" };
}

/**
 * Build the per-directory state for the two managed files. `source` is the
 * repository-wide source-of-truth name; the other file is the link.
 */
export async function readDirState(
  dir: string,
  source: SourceName,
): Promise<DirState> {
  const linkName: SourceName = source === CLAUDE_FILE ? AGENTS_FILE : CLAUDE_FILE;
  const [claude, agents] = await Promise.all([
    classifyEntry(
      path.join(dir, CLAUDE_FILE),
      source === CLAUDE_FILE ? null : linkName === CLAUDE_FILE ? source : null,
    ),
    classifyEntry(
      path.join(dir, AGENTS_FILE),
      source === AGENTS_FILE ? null : linkName === AGENTS_FILE ? source : null,
    ),
  ]);
  return { dir, claude, agents };
}

/**
 * Walk the repo recursively and yield every directory that contains at least
 * one of the managed filenames (CLAUDE.md / AGENTS.md). Ignored directories
 * are pruned cheaply.
 */
export async function scanRepository(
  root: string,
  source: SourceName,
  options: ScanOptions = {},
): Promise<DirState[]> {
  const ignored = options.ignoredDirs ?? DEFAULT_IGNORED_DIRS;
  const results: DirState[] = [];

  async function walk(dir: string, isRoot: boolean): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    let hasClaude = false;
    let hasAgents = false;
    const childDirs: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        if (!options.followHiddenDirs && entry.name.startsWith(".")) continue;
        childDirs.push(path.join(dir, entry.name));
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (entry.name === CLAUDE_FILE) hasClaude = true;
        else if (entry.name === AGENTS_FILE) hasAgents = true;
      }
    }

    if (isRoot || hasClaude || hasAgents) {
      results.push(await readDirState(dir, source));
    }

    for (const child of childDirs) {
      await walk(child, false);
    }
  }

  await walk(root, true);
  return results;
}

export function describeEntry(state: EntryState): string {
  switch (state.kind as EntryKind) {
    case "missing":
      return "missing";
    case "regular-file":
      return "regular file";
    case "correct-symlink":
      return `symlink → ${state.linkTarget ?? "?"} (current)`;
    case "incorrect-symlink":
      return `symlink → ${state.linkTarget ?? "?"} (stale)`;
    case "broken-symlink":
      return `broken symlink → ${state.linkTarget ?? "?"}`;
    case "directory":
      return "directory (unexpected)";
    case "other":
      return "non-regular file (unexpected)";
    default:
      return "unknown";
  }
}
