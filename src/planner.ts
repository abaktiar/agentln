import path from "node:path";

import {
  AGENTS_DIR,
  AGENTS_FILE,
  CLAUDE_DIR,
  CLAUDE_FILE,
  SKILLS_SUBDIR,
  sourceDirFor,
  type DirState,
  type EntryState,
  type PlannedAction,
  type SourceName,
} from "./types.js";

export interface PlanInput {
  root: string;
  source: SourceName;
  dirs: DirState[];
  /**
   * True for Case D (neither existed at root). Triggers creation of an empty
   * root source file before linking.
   */
  bootstrapRoot: boolean;
  force: boolean;
}

export interface Plan {
  actions: PlannedAction[];
  /** Directories that needed no changes (everything already correct). */
  cleanCount: number;
  /** Directories skipped because there's nothing to link in either direction. */
  emptyCount: number;
}

function linkName(source: SourceName): SourceName {
  return source === CLAUDE_FILE ? AGENTS_FILE : CLAUDE_FILE;
}

function entryFor(dir: DirState, name: SourceName): EntryState {
  return name === CLAUDE_FILE ? dir.claude : dir.agents;
}

interface ReconcileOutcome {
  /** Actions to append to the plan. */
  actions: PlannedAction[];
  /** "clean" if nothing to do, "empty" if both sides are missing, "changed" otherwise. */
  status: "clean" | "empty" | "changed";
}

export function buildPlan(input: PlanInput): Plan {
  const { root, source, dirs, bootstrapRoot, force } = input;
  const actions: PlannedAction[] = [];
  let cleanCount = 0;
  let emptyCount = 0;

  const otherName = linkName(source);
  const sourceDir = sourceDirFor(source);
  const otherDir = sourceDir === CLAUDE_DIR ? AGENTS_DIR : CLAUDE_DIR;

  if (bootstrapRoot) {
    actions.push({
      type: "create-root-source",
      sourcePath: path.join(root, source),
    });
  }

  for (const dir of dirs) {
    const isRootDir = dir.dir === root;

    // --- File pair: CLAUDE.md <-> AGENTS.md ---
    const fileOutcome = reconcilePair({
      sourceEntry: entryFor(dir, source),
      linkEntry: entryFor(dir, otherName),
      sourcePath: path.join(dir.dir, source),
      linkPath: path.join(dir.dir, otherName),
      isDirectory: false,
      // The root source is bootstrapped earlier, so treat it as present at planning time.
      sourceConsideredPresent: isRootDir && bootstrapRoot,
      force,
    });

    // --- Directory pair: .claude/skills <-> .agents/skills ---
    const skillsOutcome = reconcilePair({
      sourceEntry: skillsEntryFor(dir, sourceDir),
      linkEntry: skillsEntryFor(dir, otherDir),
      sourcePath: path.join(dir.dir, sourceDir, SKILLS_SUBDIR),
      linkPath: path.join(dir.dir, otherDir, SKILLS_SUBDIR),
      isDirectory: true,
      sourceConsideredPresent: false,
      force,
    });

    actions.push(...fileOutcome.actions, ...skillsOutcome.actions);

    const combined = combineStatus(fileOutcome.status, skillsOutcome.status);
    if (combined === "clean") cleanCount++;
    else if (combined === "empty") emptyCount++;
  }

  return { actions, cleanCount, emptyCount };
}

function combineStatus(
  a: ReconcileOutcome["status"],
  b: ReconcileOutcome["status"],
): ReconcileOutcome["status"] {
  if (a === "changed" || b === "changed") return "changed";
  if (a === "clean" || b === "clean") return "clean";
  return "empty";
}

function skillsEntryFor(dir: DirState, which: typeof CLAUDE_DIR | typeof AGENTS_DIR): EntryState {
  return which === CLAUDE_DIR ? dir.claudeSkills : dir.agentsSkills;
}

interface ReconcileArgs {
  sourceEntry: EntryState;
  linkEntry: EntryState;
  sourcePath: string;
  linkPath: string;
  isDirectory: boolean;
  /** Treat the source as present even if the current entry says it's missing. */
  sourceConsideredPresent: boolean;
  force: boolean;
}

function reconcilePair(args: ReconcileArgs): ReconcileOutcome {
  const { sourceEntry, linkEntry, sourcePath, linkPath, isDirectory, force } = args;

  const sourcePresent =
    args.sourceConsideredPresent ||
    sourceEntry.kind === "regular-file" ||
    sourceEntry.kind === "correct-symlink";

  const linkPresent = linkEntry.kind !== "missing";

  if (!sourcePresent && !linkPresent) {
    return { actions: [], status: "empty" };
  }

  if (sourcePresent) {
    const desired = ensureLink({ linkEntry, sourcePath, linkPath, isDirectory, force });
    if (desired === "ok") return { actions: [], status: "clean" };
    return { actions: [desired], status: "changed" };
  }

  // No source present in this directory; promote the link if it has real
  // content (or even just a salvageable stale symlink target).
  if (
    linkEntry.kind === "regular-file" ||
    linkEntry.kind === "incorrect-symlink" ||
    linkEntry.kind === "broken-symlink"
  ) {
    return {
      actions: [
        {
          type: "promote-to-source",
          fromPath: linkEntry.path,
          toPath: sourcePath,
          linkBack: true,
          isDirectory,
        },
      ],
      status: "changed",
    };
  }

  return {
    actions: [
      {
        type: "skip",
        path: linkEntry.path,
        reason: `unexpected entry kind: ${linkEntry.kind}`,
      },
    ],
    status: "changed",
  };
}

function ensureLink(args: {
  linkEntry: EntryState;
  sourcePath: string;
  linkPath: string;
  isDirectory: boolean;
  force: boolean;
}): PlannedAction | "ok" {
  const { linkEntry, sourcePath, linkPath, isDirectory, force } = args;

  if (linkEntry.kind === "correct-symlink") return "ok";

  if (linkEntry.kind === "missing") {
    return {
      type: "create-symlink",
      linkPath,
      sourcePath,
      replacesExisting: false,
      replacesRegularFile: false,
      isDirectory,
    };
  }

  if (
    linkEntry.kind === "incorrect-symlink" ||
    linkEntry.kind === "broken-symlink"
  ) {
    return {
      type: "create-symlink",
      linkPath,
      sourcePath,
      replacesExisting: true,
      replacesRegularFile: false,
      isDirectory,
    };
  }

  if (linkEntry.kind === "regular-file") {
    // "regular-file" here means real content of the expected kind (real file
    // for the MD pair, real directory for the skills pair). Replacing real
    // content requires --force so we don't silently destroy data.
    return {
      type: "create-symlink",
      linkPath,
      sourcePath,
      replacesExisting: true,
      replacesRegularFile: !force,
      isDirectory,
    };
  }

  return {
    type: "skip",
    path: linkPath,
    reason: `unexpected entry kind: ${linkEntry.kind}`,
  };
}

export function describeAction(action: PlannedAction): string {
  switch (action.type) {
    case "create-root-source":
      return `create empty source file → ${action.sourcePath}`;
    case "create-symlink": {
      const rel = path.relative(path.dirname(action.linkPath), action.sourcePath);
      const noun = action.isDirectory ? "directory symlink" : "symlink";
      const realNoun = action.isDirectory ? "directory" : "regular file";
      const verb = action.replacesExisting
        ? action.replacesRegularFile
          ? `replace ${realNoun}`
          : `replace stale ${noun}`
        : `create ${noun}`;
      return `${verb} ${action.linkPath} → ${rel}`;
    }
    case "promote-to-source": {
      const rel = path.relative(path.dirname(action.fromPath), action.toPath);
      const noun = action.isDirectory ? "directory" : "file";
      return `rename ${noun} ${action.fromPath} → ${action.toPath}, then link ${path.basename(action.fromPath)} → ${rel}`;
    }
    case "skip":
      return `skip ${action.path} (${action.reason})`;
  }
}
