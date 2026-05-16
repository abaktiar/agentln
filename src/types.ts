export const CLAUDE_FILE = "CLAUDE.md";
export const AGENTS_FILE = "AGENTS.md";

export type SourceName = typeof CLAUDE_FILE | typeof AGENTS_FILE;

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
      /** Whether existing entry is a regular file (vs a stale symlink). */
      replacesRegularFile: boolean;
    }
  | {
      type: "promote-to-source";
      /** Existing file that will be renamed (e.g. AGENTS.md in a folder where CLAUDE.md is source). */
      fromPath: string;
      /** New name for that file (e.g. CLAUDE.md). */
      toPath: string;
      /** Then create symlink at fromPath -> toPath. */
      linkBack: true;
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
