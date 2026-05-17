export const CLAUDE_FILE = "CLAUDE.md";
export const AGENTS_FILE = "AGENTS.md";

export const CLAUDE_DIR = ".claude";
export const AGENTS_DIR = ".agents";
export const SKILLS_SUBDIR = "skills";

export type SourceName = typeof CLAUDE_FILE | typeof AGENTS_FILE;
export type SourceDirName = typeof CLAUDE_DIR | typeof AGENTS_DIR;

export function sourceDirFor(source: SourceName): SourceDirName {
  return source === CLAUDE_FILE ? CLAUDE_DIR : AGENTS_DIR;
}

export interface CliOptions {
  root: string;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
  source?: SourceName;
  copyFallback: boolean;
  noCopyFallback: boolean;
}

export type EntryKind =
  | "missing"
  | "regular-file"
  | "correct-symlink"
  | "incorrect-symlink"
  | "broken-symlink"
  | "directory"
  | "other";

export interface EntryState {
  /** Absolute path to the file. */
  path: string;
  kind: EntryKind;
  /** For symlinks, the raw link target (relative or absolute as stored). */
  linkTarget?: string;
}

export interface DirState {
  /** Absolute directory path. */
  dir: string;
  claude: EntryState;
  agents: EntryState;
  /** State of <dir>/.claude/skills (directory, symlink, or missing). */
  claudeSkills: EntryState;
  /** State of <dir>/.agents/skills (directory, symlink, or missing). */
  agentsSkills: EntryState;
}

export type PlannedAction =
  | {
      type: "create-symlink";
      /** The link file we will create (e.g. AGENTS.md in some dir). */
      linkPath: string;
      /** The source file the link should point at (absolute path). */
      sourcePath: string;
      /** Whether the link file currently exists and must be removed first. */
      replacesExisting: boolean;
      /** Whether existing entry is real content (regular file or real directory) vs a stale symlink. */
      replacesRegularFile: boolean;
      /** True when linking a directory (e.g. skills/), false for a single file. */
      isDirectory: boolean;
    }
  | {
      type: "promote-to-source";
      /** Existing entry that will be renamed (e.g. AGENTS.md in a folder where CLAUDE.md is source). */
      fromPath: string;
      /** New name for that entry (e.g. CLAUDE.md). */
      toPath: string;
      /** Then create symlink at fromPath -> toPath. */
      linkBack: true;
      /** True when promoting a directory (e.g. skills/), false for a single file. */
      isDirectory: boolean;
    }
  | {
      type: "create-root-source";
      /** Create an empty source file at the repository root. */
      sourcePath: string;
    }
  | {
      type: "skip";
      reason: string;
      path: string;
    };

export interface ActionResult {
  action: PlannedAction;
  ok: boolean;
  message: string;
  fellBackToCopy?: boolean;
}
