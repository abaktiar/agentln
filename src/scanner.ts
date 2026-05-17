import { promises as fs } from "node:fs";
import path from "node:path";

import {
  AGENTS_DIR,
  AGENTS_FILE,
  CLAUDE_DIR,
  CLAUDE_FILE,
  SKILLS_SUBDIR,
  sourceDirFor,
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
 * Classify a single CLAUDE.md/AGENTS.md candidate path, or a managed
 * directory path (e.g. .claude/skills). Resolves the symlink target without
 * following it, so we can decide whether it already points at its sibling
 * source. `expectedKind` determines whether a "real" entry should be a file
 * or a directory; the returned EntryKind reuses `regular-file` to mean
 * "real content at this path" in either mode.
 *
 * For directories, `expectedSiblingTarget` is the relative path that a
 * correctly-shaped symlink should point to (e.g. `../.claude/skills`).
 */
export async function classifyEntry(
  filePath: string,
  expectedSiblingTarget: string | null,
  options: { expectedKind?: "file" | "directory" } = {},
): Promise<EntryState> {
  const expectedKind = options.expectedKind ?? "file";
  let lstat;
  try {
    lstat = await fs.lstat(filePath);
  } catch {
    return { path: filePath, kind: "missing" };
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

    const targetMatchesKind =
      expectedKind === "file" ? stat.isFile() : stat.isDirectory();
    if (!targetMatchesKind) {
      return { path: filePath, kind: "incorrect-symlink", linkTarget: target };
    }

    if (expectedSiblingTarget) {
      const normalised = normaliseLinkTarget(target);
      if (normalised === normaliseLinkTarget(expectedSiblingTarget)) {
        return { path: filePath, kind: "correct-symlink", linkTarget: target };
      }
      return { path: filePath, kind: "incorrect-symlink", linkTarget: target };
    }

    return { path: filePath, kind: "incorrect-symlink", linkTarget: target };
  }

  if (expectedKind === "directory") {
    if (lstat.isDirectory()) {
      return { path: filePath, kind: "regular-file" };
    }
    if (lstat.isFile()) {
      return { path: filePath, kind: "other" };
    }
    return { path: filePath, kind: "other" };
  }

  if (lstat.isDirectory()) {
    return { path: filePath, kind: "directory" };
  }

  if (lstat.isFile()) {
    return { path: filePath, kind: "regular-file" };
  }

  return { path: filePath, kind: "other" };
}

function normaliseLinkTarget(target: string): string {
  // Accept both POSIX and Windows separators; strip a leading "./".
  return target.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Build the per-directory state for the two managed files and the two
 * managed skills directories. `source` is the repository-wide source-of-truth
 * name; the other file (and corresponding skills dir) is the link.
 */
export async function readDirState(
  dir: string,
  source: SourceName,
): Promise<DirState> {
  const sourceDir = sourceDirFor(source);
  const linkFile = source === CLAUDE_FILE ? AGENTS_FILE : CLAUDE_FILE;
  const linkDir = sourceDir === CLAUDE_DIR ? AGENTS_DIR : CLAUDE_DIR;

  // For the file pair, a correct link points at the bare source filename.
  // For the skills pair, a correct link points at "../<source-dir>/skills".
  const skillsLinkTarget = `../${sourceDir}/${SKILLS_SUBDIR}`;

  const [claude, agents, claudeSkills, agentsSkills] = await Promise.all([
    classifyEntry(
      path.join(dir, CLAUDE_FILE),
      source === CLAUDE_FILE ? null : linkFile === CLAUDE_FILE ? source : null,
    ),
    classifyEntry(
      path.join(dir, AGENTS_FILE),
      source === AGENTS_FILE ? null : linkFile === AGENTS_FILE ? source : null,
    ),
    classifyEntry(
      path.join(dir, CLAUDE_DIR, SKILLS_SUBDIR),
      sourceDir === CLAUDE_DIR ? null : linkDir === CLAUDE_DIR ? skillsLinkTarget : null,
      { expectedKind: "directory" },
    ),
    classifyEntry(
      path.join(dir, AGENTS_DIR, SKILLS_SUBDIR),
      sourceDir === AGENTS_DIR ? null : linkDir === AGENTS_DIR ? skillsLinkTarget : null,
      { expectedKind: "directory" },
    ),
  ]);
  return { dir, claude, agents, claudeSkills, agentsSkills };
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
    let hasClaudeManagedDir = false;
    let hasAgentsManagedDir = false;
    const childDirs: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (entry.name === CLAUDE_DIR) hasClaudeManagedDir = true;
        else if (entry.name === AGENTS_DIR) hasAgentsManagedDir = true;
      }
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        if (!options.followHiddenDirs && entry.name.startsWith(".")) continue;
        childDirs.push(path.join(dir, entry.name));
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (entry.name === CLAUDE_FILE) hasClaude = true;
        else if (entry.name === AGENTS_FILE) hasAgents = true;
      }
    }

    if (
      isRoot ||
      hasClaude ||
      hasAgents ||
      hasClaudeManagedDir ||
      hasAgentsManagedDir
    ) {
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
