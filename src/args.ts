import path from "node:path";

import {
  AGENTS_FILE,
  CLAUDE_FILE,
  type CliOptions,
  type SourceName,
} from "./types.js";

const HELP_TEXT = `agentln — manage CLAUDE.md ⇄ AGENTS.md symlinks across a repo

Usage:
  npx agentln [options]
  pnpm dlx agentln [options]

Options:
  --root <path>        Repository root (default: current working directory).
  --source <name>      Use CLAUDE.md or AGENTS.md as source of truth (skips prompt).
  -y, --yes            Non-interactive mode (assume defaults for every prompt).
  --dry-run            Show planned changes without writing anything.
  --force              Overwrite divergent regular files when replacing with a symlink.
  --copy-fallback      On Windows, fall back to a file copy if symlink creation is denied.
  --no-copy-fallback   Disable the copy fallback (default).
  --verbose            Print debug-level information.
  -h, --help           Show this help.
  -v, --version        Show version.
`;

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    root: process.cwd(),
    yes: false,
    dryRun: false,
    force: false,
    verbose: false,
    help: false,
    version: false,
    copyFallback: false,
    noCopyFallback: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      case "-y":
      case "--yes":
        opts.yes = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--verbose":
        opts.verbose = true;
        break;
      case "--copy-fallback":
        opts.copyFallback = true;
        break;
      case "--no-copy-fallback":
        opts.noCopyFallback = true;
        opts.copyFallback = false;
        break;
      case "--root": {
        const next = argv[++i];
        if (!next) throw new Error("--root requires a path argument");
        opts.root = path.resolve(next);
        break;
      }
      case "--source": {
        const next = argv[++i];
        opts.source = parseSource(next);
        break;
      }
      default: {
        if (arg.startsWith("--root=")) {
          opts.root = path.resolve(arg.slice("--root=".length));
        } else if (arg.startsWith("--source=")) {
          opts.source = parseSource(arg.slice("--source=".length));
        } else {
          throw new Error(`Unknown argument: ${arg}`);
        }
      }
    }
  }

  return opts;
}

function parseSource(value: string | undefined): SourceName {
  if (!value) throw new Error("--source requires a value (CLAUDE.md or AGENTS.md)");
  const normalised = value.trim();
  if (
    normalised === CLAUDE_FILE ||
    normalised.toLowerCase() === "claude" ||
    normalised.toLowerCase() === "claude.md"
  ) {
    return CLAUDE_FILE;
  }
  if (
    normalised === AGENTS_FILE ||
    normalised.toLowerCase() === "agents" ||
    normalised.toLowerCase() === "agents.md"
  ) {
    return AGENTS_FILE;
  }
  throw new Error(`Invalid --source value: ${value}. Expected CLAUDE.md or AGENTS.md.`);
}

export function helpText(): string {
  return HELP_TEXT;
}
