import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pc from "picocolors";

import { helpText, parseArgs } from "./args.js";
import { executeAction, isWindowsHost, platformLabel } from "./executor.js";
import { createLogger } from "./logger.js";
import { buildPlan, describeAction } from "./planner.js";
import { classifyRoot, decideRoot } from "./prompts.js";
import { describeEntry, scanRepository } from "./scanner.js";
import { type CliOptions } from "./types.js";

async function readPackageVersion(): Promise<string> {
  try {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const pkgPath = path.join(here, "..", "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${pc.red("✗")} ${(err as Error).message}\n`);
    process.stderr.write(helpText());
    return 2;
  }

  if (options.help) {
    process.stdout.write(helpText());
    return 0;
  }

  if (options.version) {
    process.stdout.write(`${await readPackageVersion()}\n`);
    return 0;
  }

  const logger = createLogger(options.verbose);
  const root = path.resolve(options.root);

  logger.step("agentln", `${root}`);
  logger.debug(`Platform: ${platformLabel()}`);

  // Verify the root directory exists before doing anything else.
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      logger.error(`${root} is not a directory.`);
      return 1;
    }
  } catch {
    logger.error(`Cannot read ${root}. Does the path exist?`);
    return 1;
  }

  // First pass: just read the root state so we can ask the right question.
  // We do this with an arbitrary source (CLAUDE) — the answer doesn't depend
  // on which file the user later picks, only on which files are present.
  const initialScan = await scanRepository(root, "CLAUDE.md");
  const rootState = initialScan.find((d) => d.dir === root);
  if (!rootState) {
    logger.error(`Failed to scan repository root at ${root}.`);
    return 1;
  }

  logger.debug(`Root CLAUDE.md: ${describeEntry(rootState.claude)}`);
  logger.debug(`Root AGENTS.md: ${describeEntry(rootState.agents)}`);

  const rootCase = classifyRoot(rootState);
  logger.debug(`Root case: ${rootCase}`);

  const decision = await decideRoot(rootState, {
    yes: options.yes,
    sourceFlag: options.source,
  });

  logger.info(
    `Source of truth: ${pc.bold(decision.source)}${
      decision.bootstrapRoot ? pc.dim(" (will be created at root)") : ""
    }`,
  );

  // Re-scan now that we know the actual source, so entry classification can
  // judge whether existing symlinks point at the right sibling.
  const dirs = await scanRepository(root, decision.source);
  logger.debug(`Scanned ${dirs.length} relevant director${dirs.length === 1 ? "y" : "ies"}.`);

  const plan = buildPlan({
    root,
    source: decision.source,
    dirs,
    bootstrapRoot: decision.bootstrapRoot,
    force: options.force,
  });

  if (plan.actions.length === 0) {
    logger.success(
      `Nothing to do. ${plan.cleanCount} director${plan.cleanCount === 1 ? "y is" : "ies are"} already in sync.`,
    );
    return 0;
  }

  logger.step(
    options.dryRun ? "Planned changes (dry run)" : "Planned changes",
    `${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"}`,
  );
  for (const action of plan.actions) {
    logger.raw(`  ${pc.dim("•")} ${describeAction(action)}`);
  }

  if (options.dryRun) {
    logger.info("Dry run complete. No changes were written.");
    return 0;
  }

  if (isWindowsHost() && !options.copyFallback) {
    logger.debug(
      "Tip: pass --copy-fallback to write a regular file copy if symlink creation is denied on Windows.",
    );
  }

  let failures = 0;
  let copyFallbacks = 0;
  for (const action of plan.actions) {
    const result = await executeAction(action, {
      dryRun: false,
      force: options.force,
      copyFallback: options.copyFallback,
    });
    if (result.fellBackToCopy) copyFallbacks++;
    if (!result.ok) {
      failures++;
      logger.error(`${describeAction(action)} — ${result.message}`);
    } else {
      logger.success(`${describeAction(action)} — ${result.message}`);
    }
  }

  if (copyFallbacks > 0) {
    logger.warn(
      `${copyFallbacks} file${copyFallbacks === 1 ? "" : "s"} written as a copy instead of a symlink. ` +
        "Edits to one file will not propagate to the other until real symlinks are restored.",
    );
  }

  if (failures > 0) {
    logger.error(`${failures} action${failures === 1 ? "" : "s"} failed.`);
    return 1;
  }

  logger.success(`Done. ${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"} applied.`);
  return 0;
}
