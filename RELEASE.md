# Release process (manual)

There is no CI release pipeline. Every release — including Windows-only alphas — is built and published
by hand, from a Windows machine, following the steps below. This is the process the `v0.1.0-alpha.1`
release actually followed; keep it up to date if the process changes.

## Prerequisites

- Windows machine (NSIS packaging only works from Windows; see `package.json`'s `build.win` target).
- `pnpm toolchain:fetch` has been run for Windows at some point (it also runs automatically via
  `postinstall` on `pnpm install`) — see `TOOLCHAIN.md` for what that downloads and why it must be redone
  per OS/arch being packaged.
- Logged in to GitHub CLI as the account that should own the release: `gh auth status`.
- Clean working tree on `main`, up to date with `origin/main`. If the release includes work from a feature
  branch, merge that branch into `main` first (see "Branching" below) — releases are always built from a
  commit on `main`, never from a feature branch.

## Branching

Releases are cut from `main`. If the change set to release lives on a feature branch:

1. Confirm the branch has no unmerged divergence from `main` that needs a PR/review — check with
   `git log origin/main..<branch>` (commits only on the branch) and `git log <branch>..origin/main`
   (commits only on `main`; if this is non-empty, rebase or merge `main` into the branch first and re-test).
2. Merge (or fast-forward) the branch into `main` and push.

## Steps

1. **Decide the version number.** `package.json`'s `version` is the single source of truth
   (semantic versioning — `<Major>.<Minor>.<Patch>`, with `-alpha.N` / `-beta.N` pre-release suffixes while
   the project is pre-1.0). Bump it in `package.json`.

2. **Quality gates** — all must pass before building an installer:
   ```shell
   pnpm typecheck
   pnpm test
   pnpm test:e2e
   ```
   (`pnpm lint` does not currently work in this repo — ESLint isn't installed — so it's not part of the
   gate; see `CLAUDE.md`.)

3. **Commit the version bump** on `main`, e.g. `Version this build as 0.1.0-alpha.2`. Do this as its own
   commit, not mixed with feature work — the release tag will point at this commit.

4. **Build the installer:**
   ```shell
   pnpm release
   ```
   This one command (`scripts/build-release.mjs`) checks the Node version, runs `pnpm install` (which
   re-fetches the toolchain via `postinstall` if it's missing/stale for this OS/arch), runs `pnpm build`,
   then runs `electron-builder`, and finally prints the path of the produced installer(s) under `release/`.
   For Windows this produces a single NSIS `.exe`
   (`release/DCC Rail Commander Setup <version>.exe`).

   (Equivalent manual steps, if you need to run them individually: `pnpm install`, `pnpm build`,
   `pnpm exec electron-builder`.)

5. **Smoke-test the installer** on a clean-ish Windows machine/VM before publishing:
   - Run the installer, launch the app.
   - Confirm the app reports the correct version (About / title bar).
   - Run through at least one real device flow (e.g. `--mock-device`/`--mock-upload` is for automated
     tests only — for a release smoke test, use a real board if available, or at minimum open the New
     Device Wizard and a config editor).

6. **Push `main`** (with the version-bump commit) to `origin`:
   ```shell
   git push origin main
   ```

7. **Publish the GitHub release**, tagging the version-bump commit pushed in step 6. Using `gh` creates
   the tag and the release together:
   ```shell
   gh release create v<version> "release/DCC Rail Commander Setup <version>.exe" \
     --title "<version>" \
     --notes "<release notes>" \
     --prerelease   # while the project is pre-1.0 / alpha / beta
   ```
   Write the release notes as user-facing highlights (see prior releases with
   `gh release view v0.1.0-alpha.1` for the tone/format to match), not a raw commit log. Include the
   "not an official DCC-EX project" disclaimer per `CLAUDE.md`'s guidance on user-facing copy, and note
   which platform(s) the attached installer covers (currently Windows only).

8. **Verify the published release:**
   ```shell
   gh release view v<version>
   ```
   Confirm the tag, asset, and notes look right, and that the tag (`git tag --list`, or
   `git log -1 v<version>`) points at the version-bump commit from step 3.

## Notes

- `README.md`'s "Versioning" section states the convention in one line: build and publish first, then the
  tag exists against that exact commit (which `gh release create` does in one step above).
- macOS/Linux targets (`dmg`, `AppImage`/`deb`) are defined in `package.json`'s `build` config but are not
  currently part of the release process — only Windows builds have been published so far. Building those
  requires running `pnpm toolchain:fetch` and `pnpm release` on a machine of that OS.
- Never edit or amend a tag/release after publishing to "fix" it — if something is wrong, ship a new
  patch/alpha release instead. Existing users may have already downloaded the asset.
