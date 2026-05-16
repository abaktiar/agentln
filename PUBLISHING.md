# Publishing `agentln` to npm

A step-by-step guide for publishing this package to the public npm registry,
from creating an account through verifying the live release. Run every command
from the package root (`agentln/`) unless a step says otherwise.

---

## 1. Prerequisites

- **Node.js 18 or newer** and **npm 9+** installed locally
  ```bash
  node -v
  npm -v
  ```
- An **npm account** at <https://www.npmjs.com/signup>
- The account must have a **verified email address** — npm refuses publishes
  from accounts with unverified emails.
- **Two-factor authentication (2FA)** strongly recommended. Enable it at
  <https://www.npmjs.com/settings/~/profile> (Account → Two-Factor
  Authentication). Choose "Authorization and publishing" so 2FA is required
  for `npm publish` as well as login.

---

## 2. Log in to npm from the CLI

```bash
npm login
```

You will be prompted for:

- **Username**
- **Password**
- **Email** (must be verified)
- **One-time password** (if 2FA is enabled)

Modern npm versions open a browser window for OAuth — follow the link, sign
in, then return to the terminal. If you prefer the legacy flow:

```bash
npm login --auth-type=legacy
```

Verify you are logged in:

```bash
npm whoami
```

If this prints your username, you are good to go. Your auth token is stored
in `~/.npmrc`.

---

## 3. Confirm the package name is available

The package name in `package.json` is `agentln` (unscoped). Check whether it
is already taken:

```bash
npm view agentln
```

- If the command returns metadata, the name is taken — pick a different name
  or use a scoped name like `@your-username/agentln`. Update the `name`
  field in `package.json` accordingly.
- If it returns `404`, the name is free.

> **Scoped packages**: if you switch to `@your-username/agentln`, every
> `npm publish` must include `--access public`, otherwise npm publishes it
> as a private package (which requires a paid plan).

---

## 4. Sanity-check `package.json`

Open `package.json` and verify:

- `name` — matches what you intend to publish.
- `version` — follows [semver](https://semver.org/). First release is
  typically `0.1.0` or `1.0.0`.
- `description`, `keywords`, `license`, `author` — fill in if blank.
- `repository.url`, `bugs.url`, `homepage` — point at the real GitHub repo.
- `bin` — confirms the CLI entry point: `"agentln": "dist/bin.js"`.
- `files` — controls what ships. Currently `["dist", "README.md", "LICENSE"]`.
- `engines.node` — set to `">=18.0.0"`.

Then make sure the lockfile is up to date:

```bash
npm install
```

---

## 5. Build a clean `dist/`

The `prepublishOnly` script does this for you, but running it manually
catches problems earlier:

```bash
npm run clean
npm run build
```

You should now see compiled `.js`, `.d.ts`, and source-map files in `dist/`.
Confirm the CLI runs locally:

```bash
node dist/bin.js --version
node dist/bin.js --help
```

---

## 6. Preview the exact tarball that will be published

`npm pack --dry-run` shows every file that would be included and the final
package size:

```bash
npm pack --dry-run
```

Inspect the output. The list should contain:

- `package.json`
- `README.md`
- `LICENSE`
- `dist/bin.js`, `dist/cli.js`, all other `dist/*.js` and `.d.ts`

It should **not** contain `src/`, `node_modules/`, `.git/`, `tsconfig.json`,
or test files. If extra files leak in, adjust `.npmignore` or the `files`
field in `package.json` and re-run the dry pack.

To actually write the tarball to disk for manual inspection:

```bash
npm pack
tar -tzf agentln-0.1.0.tgz
```

Delete the `.tgz` once you have looked at it.

---

## 7. Smoke-test the package locally (recommended)

Install the packaged tarball into a throwaway directory and run the CLI from
there. This catches bugs that only appear after packing (missing `dist`,
wrong `bin` path, ESM resolution issues, etc.).

```bash
npm pack
mkdir -p /tmp/agentln-smoke && cd /tmp/agentln-smoke
npm init -y >/dev/null
npm install /Users/david/CODE/personal/PROJECTS/agentln/code/agentln/agentln-0.1.0.tgz
npx agentln --version
npx agentln --help
cd -
rm /Users/david/CODE/personal/PROJECTS/agentln/code/agentln/agentln-*.tgz
```

If `--version` and `--help` work, the package is ready.

---

## 8. Tag and commit (optional but recommended)

If this is the first release, make sure everything is committed and then bump
the version with `npm version`. It updates `package.json`, creates a commit,
and adds a git tag in one step.

```bash
git status                 # working tree should be clean
git add .
git commit -m "release: 0.1.0"

# Then later, for subsequent releases:
npm version patch          # 0.1.0 → 0.1.1
# or
npm version minor          # 0.1.0 → 0.2.0
# or
npm version major          # 0.1.0 → 1.0.0
```

This creates a `v0.1.1` (etc.) git tag on the new commit.

---

## 9. Publish

For an **unscoped** package (current setup, `name: "agentln"`):

```bash
npm publish
```

For a **scoped** package (e.g. `@your-username/agentln`), you must opt into
public access on every publish:

```bash
npm publish --access public
```

If 2FA is enabled for publishing, npm will prompt for your OTP. Have your
authenticator app ready.

Optional flags:

- `--dry-run` — show what would happen without uploading anything.
- `--tag beta` — publish under a non-`latest` dist-tag (use this for pre-
  releases like `0.2.0-beta.1`; users get them via `npm install agentln@beta`).
- `--otp=123456` — pass the 2FA code inline.

---

## 10. Verify the live release

```bash
# Show the published metadata
npm view agentln

# Show the version you just published
npm view agentln version

# List the files inside the published tarball
npm view agentln dist.fileCount dist.unpackedSize
```

Then, in a clean directory, run it the way a user would:

```bash
npx agentln@latest --version
```

If `npx` reports the version you just shipped, the publish succeeded. The
package will also be visible at:

```
https://www.npmjs.com/package/agentln
```

---

## 11. Push the git tag

```bash
git push
git push --tags
```

Create a GitHub release from the tag if you want changelog visibility:

```bash
gh release create v0.1.0 --generate-notes
```

---

## 12. Publishing subsequent versions

The short version of the loop, once the first release is out:

```bash
# 1. Make your code changes, commit them.
# 2. Bump the version (also creates a git tag).
npm version patch         # or minor / major
# 3. Build, pack-check, publish.
npm publish               # add --otp=... if needed
# 4. Push.
git push && git push --tags
```

`prepublishOnly` (defined in `package.json`) automatically runs
`npm run clean && npm run build` before every `npm publish`, so you cannot
accidentally ship a stale `dist/`.

---

## 13. Fixing mistakes

- **Wrong files shipped / unpublishable bug discovered in the first few
  minutes**: `npm unpublish agentln@<version>` (only allowed within 72 hours
  of publish and only if no other package depends on it). Then bump the
  version and republish.
- **Need to retract an older release**: `npm deprecate agentln@<version> "do
  not use — see <new version>"`. This leaves the tarball in place but warns
  on install.
- **Locked out of the package**: confirm `npm whoami` shows the same account
  that owns the package. List owners with `npm owner ls agentln`.

---

## 14. Common errors and fixes

| Error                                                | Cause                                                  | Fix                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `E402 Payment Required`                              | Publishing a scoped package without `--access public`  | Add `--access public` or make the package unscoped.                                |
| `E403 You do not have permission to publish`         | Name is taken by another user, or you are not an owner | Pick a new name (scoped works) or get added as an owner.                           |
| `E409 Conflict — cannot publish over previous`       | That exact version is already on npm                   | Run `npm version patch` to bump, then publish.                                     |
| `OTP required`                                       | 2FA enabled for publishing                             | Run `npm publish --otp=123456` or enter the code at the prompt.                    |
| `npm ERR! need auth`                                 | Not logged in / token expired                          | `npm login` again.                                                                 |
| `ENOENT: no such file or directory, open '.../dist'` | `dist/` is missing from the tarball                    | Run `npm run build` and confirm `files` in `package.json` includes `"dist"`.       |

---

## 15. Pre-publish checklist (TL;DR)

- [ ] `npm whoami` shows the correct account
- [ ] `package.json` `name`, `version`, `description`, `repository`, `bin`,
      `files`, `engines` all look right
- [ ] `git status` is clean
- [ ] `npm run clean && npm run build` succeeds
- [ ] `node dist/bin.js --version` and `--help` work
- [ ] `npm pack --dry-run` includes only the intended files
- [ ] Local install test from the tarball works
- [ ] `npm publish` (with `--access public` if scoped)
- [ ] `npm view agentln version` matches
- [ ] `npx agentln@latest --version` works
- [ ] `git push && git push --tags`
