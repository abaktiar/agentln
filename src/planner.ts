import path from "node:path";

import {
  AGENTS_FILE,
  CLAUDE_FILE,
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

export function buildPlan(input: PlanInput): Plan {
  const { root, source, dirs, bootstrapRoot, force } = input;
  const actions: PlannedAction[] = [];
  let cleanCount = 0;
  let emptyCount = 0;

  const otherName = linkName(source);

  if (bootstrapRoot) {
    actions.push({
      type: "create-root-source",
      sourcePath: path.join(root, source),
    });
  }

  for (const dir of dirs) {
    const isRootDir = dir.dir === root;
    const sourceEntry = entryFor(dir, source);
    const linkEntry = entryFor(dir, otherName);

    const sourcePresent =
      sourceEntry.kind === "regular-file" ||
      (sourceEntry.kind === "correct-symlink" && !isRootDir) ||
      // After bootstrap the root source will exist on disk by the time we run.
      (isRootDir && bootstrapRoot);

    const linkPresent = linkEntry.kind !== "missing";

    // Nothing in this directory to manage.
    if (!sourcePresent && !linkPresent) {
      emptyCount++;
      continue;
    }

    // Source exists (or will after bootstrap). Just ensure the link mirrors it.
    if (sourcePresent) {
      const desired = ensureLink({
        sourceName: source,
        linkName: otherName,
        linkEntry,
        dir: dir.dir,
        force,
      });
      if (desired === "ok") {
        cleanCount++;
      } else {
        actions.push(desired);
      }
      continue;
    }

    // No source file in this directory but the link file exists as a regular
    // file (or stale/broken symlink). Promote it to source, then link back.
    if (
      linkEntry.kind === "regular-file" ||
      linkEntry.kind === "incorrect-symlink" ||
      linkEntry.kind === "broken-symlink"
    ) {
      const sourcePath = path.join(dir.dir, source);
      actions.push({
        type: "promote-to-source",
        fromPath: linkEntry.path,
        toPath: sourcePath,
        linkBack: true,
      });
    } else {
      actions.push({
        type: "skip",
        path: linkEntry.path,
        reason: `unexpected entry kind: ${linkEntry.kind}`,
      });
    }
  }

  return { actions, cleanCount, emptyCount };
}

function ensureLink(args: {
  sourceName: SourceName;
  linkName: SourceName;
  linkEntry: EntryState;
  dir: string;
  force: boolean;
}): PlannedAction | "ok" {
  const { sourceName, linkEntry, dir, force } = args;
  const sourcePath = path.join(dir, sourceName);
  const linkPath = linkEntry.path;

  if (linkEntry.kind === "correct-symlink") return "ok";

  if (linkEntry.kind === "missing") {
    return {
      type: "create-symlink",
      linkPath,
      sourcePath,
      replacesExisting: false,
      replacesRegularFile: false,
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
    };
  }

  if (linkEntry.kind === "regular-file") {
    return {
      type: "create-symlink",
      linkPath,
      sourcePath,
      replacesExisting: true,
      replacesRegularFile: !force,
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
      const verb = action.replacesExisting
        ? action.replacesRegularFile
          ? "replace regular file"
          : "replace stale symlink"
        : "create symlink";
      return `${verb} ${action.linkPath} → ${rel}`;
    }
    case "promote-to-source": {
      const rel = path.relative(path.dirname(action.fromPath), action.toPath);
      return `rename ${action.fromPath} → ${action.toPath}, then link ${path.basename(action.fromPath)} → ${rel}`;
    }
    case "skip":
      return `skip ${action.path} (${action.reason})`;
  }
}
