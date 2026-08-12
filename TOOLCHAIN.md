# The bundled Python/PlatformIO toolchain

EX-Installer builds firmware with **PlatformIO Core**, running on **its own bundled Python
interpreter** — never the user's system Python, never PlatformIO's usual `~/.platformio` install, and
never anything downloaded at runtime. This doc explains how that bundle is built, how it's laid out on
disk, how the app turns it into a running build, and the offline guarantee the whole thing exists to
provide. For where this fits in the wider app, see `CLAUDE.md`'s "Build backend" section; this file goes
one level deeper.

## Why bundle at all

PlatformIO normally expects to manage itself: `pip install platformio` puts the package wherever your
active Python environment is, and on first use it downloads the toolchains/frameworks/boards it needs
into `~/.platformio`. Both of those steps assume internet access and a Python the user already has.
Neither assumption holds for EX-Installer's users, so the app instead ships:

1. A complete, relocatable **CPython interpreter** — nothing is installed into or read from the user's
   system Python, if they even have one.
2. **PlatformIO Core + esptool**, pip-installed at build time into a plain directory rather than a venv.
3. The **platform packages** (toolchains, frameworks, board defs) PlatformIO would otherwise fetch from
   its own registry on first use.
4. A couple of **vendored Arduino libraries** the sketches need, so the PlatformIO library registry is
   never touched either.

The only thing on the network at runtime is `git clone`/`git pull` of the DCC-EX product repos — nothing
toolchain-related.

## Two stages: build time vs. runtime

There are two separate copies of this tree, produced by two separate steps, and it's important not to
conflate them:

| | **`resources/`** (read-only, shipped with the app) | **`~/ex-installer/platformio/`** (writable, per-machine) |
|---|---|---|
| Populated by | `scripts/fetch-toolchain.mjs` (`pnpm toolchain:fetch`) | `seedRuntime()` in `src/main/pio-runtime.ts` |
| Runs | At build time, on the machine producing the release, once per OS/arch being packaged | At app startup, once per machine, guarded by a stamp file |
| Touches the network | Yes — this is the only part of the project that does | No — copies from `resources/` only |
| Why it exists | PlatformIO needs `platforms`/`packages` to be *writable* (it writes its own metadata into them), and Windows directory symlinks need elevation, so they can't be used directly from the read-only install location | |

### Stage 1 — `pnpm toolchain:fetch`

Implemented in `scripts/fetch-toolchain.mjs`. Downloads and assembles, into `resources/`:

```
resources/
├── python/                  Relocatable CPython (python-build-standalone, "install_only" build)
├── pio/site-packages/       PlatformIO Core + esptool, `pip install --target` (real PyPI wheels)
├── pio-core/
│   ├── platforms/           atmelavr, espressif32 — platform definitions
│   └── packages/            toolchain-atmelavr, toolchain-xtensa-esp32, framework-arduino-avr,
│                             framework-arduinoespressif32, tool-scons, tool-esptoolpy, tool-avrdude, …
├── pio-libs/                Vendored Arduino libraries (currently just Ethernet) that would
│                             otherwise resolve from the PlatformIO registry
└── toolchain-manifest.json  Pinned versions + a content stamp (see below)
```

Versions are pinned at the top of the script (`PYTHON_VERSION`, `PYTHON_RELEASE`, `PLATFORMIO_VERSION`,
`ESPTOOL_VERSION`, `PLATFORMS`, `LIBRARIES`) — bump them deliberately, since each one changes what a
user's firmware is built with.

The interpreter and the PlatformIO install are fetched by two different mechanisms, worth keeping
straight:

- **`resources/python`** comes from a GitHub release of
  [`astral-sh/python-build-standalone`](https://github.com/astral-sh/python-build-standalone) — a
  per-platform `.tar.gz` containing a complete, relocatable CPython build (interpreter binary, stdlib,
  shared libs). This is **not** a wheel and can't be one: a wheel installs a library into an *existing*
  interpreter, it has no way to carry the interpreter itself.
- **`resources/pio/site-packages`** *is* a normal wheel install underneath — `pip install --target
  resources/pio/site-packages platformio==<version> esptool==<version>` resolves and unpacks real PyPI
  wheels, just into a plain directory instead of an activated venv, so the app can point `PYTHONPATH` at
  it without any environment activation step.

`resources/` is gitignored (hundreds of MB, platform-specific) and also runs as the project's
`postinstall` script — so a fresh `pnpm install` fetches it automatically for local dev, but a *packaged
release* still needs `pnpm toolchain:fetch` re-run explicitly on each OS being built for, since the
Python build and platform toolchains are architecture-specific downloads.

`toolchain-manifest.json`'s `stamp` is a hash of the pinned versions and library list — it's what tells
a running app "the bundle I shipped with has changed since you last seeded" (see Stage 2).

### Stage 2 — `seedRuntime()`

Implemented in `src/main/pio-runtime.ts`, called once from `views/startup.ts` on launch, before
`isRuntimeReady()` says otherwise. It copies `resources/pio-core/{platforms,packages}` into the writable
core dir:

```
~/ex-installer/platformio/
├── platforms/                     copied from resources/pio-core/platforms
├── packages/                      copied from resources/pio-core/packages
└── .ex-installer-toolchain        the seeded stamp — compared against the manifest's stamp
```

`isRuntimeReady()` is just `hasBundledRuntime() && (seededStamp === manifest.stamp)` — cheap, so it's
safe to check on every launch. When the stamps don't match (first run, or the app shipped a toolchain
update), `seedRuntime()` runs again; each top-level entry that's already present on disk is skipped, so
a re-seed after a version bump only copies what actually changed.

**Copies are atomic.** Each package/platform is copied to a sibling temp path and then `rename()`d into
its final location — never written directly to the target path. This matters because the per-entry skip
check is a plain `existsSync(target)`: without the rename being atomic, a process crash mid-copy (or two
app instances racing to seed the same shared `~/ex-installer/platformio/` concurrently) can leave a
directory that *exists* but is missing files, and nothing would ever detect or repair it afterward — the
skip check would treat it as done forever. This is exactly what happened on 2026-08-11: a WSL crash
truncated `packages/framework-arduinoespressif32` mid-copy (missing ~2,749 files, including its
`.piopm`), which made every ESP32/CSB1 build fail with an `HTTPClientError` — PlatformIO saw an
incomplete package and tried to fetch a fresh one over the network, which the offline fuse below blocks.
If you ever see that failure signature again, compare file counts between the two trees for the affected
package/platform; a mismatch there is the tell.

## The offline fuse

Every PlatformIO subprocess runs through `pioEnv()` in `pio-runtime.ts`, which:

- Points `PLATFORMIO_CORE_DIR` / `PLATFORMIO_PLATFORMS_DIR` / `PLATFORMIO_PACKAGES_DIR` at
  `~/ex-installer/platformio/...` instead of PlatformIO's default `~/.platformio`.
- Sets `PYTHONPATH` to `resources/pio/site-packages` and `PYTHONNOUSERSITE=1`, so nothing on the bundled
  interpreter's path resolves through the user's own Python packages, even if they have some.
- Routes `HTTP_PROXY`/`HTTPS_PROXY` at `http://127.0.0.1:9` — a guaranteed-dead local port. If PlatformIO
  ever decides a package needs fetching (as in the incident above), the build fails immediately and
  loudly with a connection error, instead of silently pulling an unpinned toolchain version over the
  wire. **Don't remove this** even to "fix" a build — an offline fetch succeeding silently is worse than
  a build failing loudly, since it would mean two users' builds are no longer reproducible from the same
  app version.

## Board coverage and STM32

Bundled toolchains cover **AVR and ESP32 only** (`atmelavr`, `espressif32` in `PLATFORMS`, matched to
FQBNs in `src/main/board-targets.ts`). STM32 Nucleo boards aren't bundled — they'd add ~450MB for a small
slice of users — and instead get an actionable in-app error plus an "import toolchain pack" route
(`pio:browse-toolchain-pack` / `pio:import-toolchain-pack`, landing in `importToolchainPack()` in
`src/main/platformio.ts`), which extracts a user-supplied archive into the same `platforms/`/`packages/`
layout `seedRuntime()` uses. Build one by running `fetch-toolchain.mjs --platforms ststm32@19.0.0` and
archiving the resulting `resources/pio-core`.

## Debugging checklist

- **"The bundled build runtime is missing…"** — `hasBundledRuntime()` is false: `resources/python` or
  `resources/pio/site-packages` isn't there. Run `pnpm toolchain:fetch`.
- **A specific board's compile fails with a network/HTTP error despite the fuse** — almost certainly a
  corrupted seed, not a missing platform. Compare file counts:
  `diff <(find resources/pio-core/packages/<pkg> -type f | sort) <(find ~/ex-installer/platformio/packages/<pkg> -type f | sort)`.
  Delete the mismatched package directory under `~/ex-installer/platformio/packages/` (or the whole
  `~/ex-installer/platformio/` dir, plus its `.ex-installer-toolchain` stamp) and relaunch to force a
  clean re-seed.
- **Other boards on the same machine compile fine** — the seed is per-package, so corruption is usually
  scoped to whichever package was mid-copy when something interrupted it; unaffected packages keep
  working.
