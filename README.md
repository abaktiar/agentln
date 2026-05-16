# agentln

Cross-platform CLI that keeps `CLAUDE.md` and `AGENTS.md` in sync across an
entire repository by managing **relative symlinks** between them.

You make **one decision at the repository root** — which filename is the source
of truth — and `agentln` applies that decision recursively to every directory
in the repo.

- Works on macOS, Linux, and Windows (PowerShell, Git Bash, WSL).
- Uses Node's native `fs` symlink APIs. Never shells out to `ln`, `bash`, or
  PowerShell.
- Designed for monorepos: Nx, Turborepo, pnpm workspaces, and nested apps.

## Install / Run

```bash
# One-shot
npx agentln
pnpm dlx agentln

# Or install globally
npm i -g agentln
agentln
```

Requires Node.js 18+.

## What it does

At the repository root, `agentln` looks for `CLAUDE.md` and `AGENTS.md` and
asks you a single question based on what it finds:

| Root state                  | Question                                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| Only `CLAUDE.md`            | Use `CLAUDE.md` as the source of truth across the repository?                  |
| Only `AGENTS.md`            | Use `AGENTS.md` as the source of truth across the repository?                  |
| Both exist                  | Which one should be the source of truth? `CLAUDE.md` / `AGENTS.md` / Cancel.   |
| Neither exists              | Which file should become the repository standard? `CLAUDE.md` / `AGENTS.md`.   |

Once you pick a source of truth (call it `SRC`), every directory in the repo
that contains either file is reconciled to the same convention:

| Directory contents     | Result                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `SRC` only             | Create `OTHER` as a symlink → `SRC`.                                  |
| `OTHER` only           | Rename `OTHER` → `SRC` (preserve content), then link `OTHER` → `SRC`. |
| Both exist             | Preserve `SRC`. Replace `OTHER` with a symlink → `SRC`.               |
| Neither                | Do nothing.                                                           |

`agentln` is idempotent. Running it twice in a row will say "already in sync."

### Symlink format

Symlinks are always **relative** (`AGENTS.md → CLAUDE.md`), never absolute.
This keeps the repo portable across machines and clones.

### Ignored directories

The scanner skips common build / vendor folders by default:

`node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `vendor`,
`.turbo`, `.cache`, `.parcel-cache`, `.svelte-kit`, `.nuxt`, `.output`,
`.vercel`, `.idea`, `.vscode`, and any other dotfile-prefixed directory.

## CLI flags

```text
agentln [options]

--root <path>        Repository root (default: current working directory).
--source <name>      Use CLAUDE.md or AGENTS.md as source of truth (skips prompt).
-y, --yes            Non-interactive mode. Accepts defaults for every prompt.
--dry-run            Show planned changes without writing anything.
--force              Overwrite divergent regular files when replacing with a symlink.
--copy-fallback      On Windows, copy the file instead of failing when symlink
                     creation is denied.
--no-copy-fallback   Disable the copy fallback (default).
--verbose            Print debug-level information.
-h, --help           Show help.
-v, --version        Show version.
```

### Examples

```bash
# Preview what would happen
npx agentln --dry-run

# Non-interactive, default to CLAUDE.md when both exist
npx agentln --yes --source CLAUDE.md

# Target a different repo
npx agentln --root ~/code/my-monorepo

# Replace existing AGENTS.md regular files (not just symlinks)
npx agentln --force
```

## Windows notes

Creating symbolic links on Windows requires either:

- **Developer Mode** enabled (Settings → Privacy & security → For developers), or
- an elevated shell, or
- the `SeCreateSymbolicLinkPrivilege` granted to your user.

If `agentln` cannot create a symlink, you have two options:

1. Re-run after enabling one of the above (recommended — symlinks keep both
   filenames in sync automatically).
2. Pass `--copy-fallback` to write a regular file copy instead. The two files
   will then diverge on subsequent edits until you reconcile them.

The fallback is **off by default** so you never silently lose the "single
source of truth" guarantee.

## Use cases

- Tools like Claude Code expect `CLAUDE.md`; other tools expect `AGENTS.md`.
  Symlink them so both worlds read the same file.
- Monorepos with multiple workspaces, each having their own per-package
  instructions: `agentln` reconciles every workspace in one pass.

## Publishing

```bash
npm run build
npm publish --access public
```

The `prepublishOnly` script rebuilds `dist/` and ships only `dist/` plus the
README and license.

## License

MIT
