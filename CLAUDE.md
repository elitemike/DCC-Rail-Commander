# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

EX-Installer is an Electron + Aurelia 2 rewrite of a legacy Python/Tkinter installer for DCC-EX Arduino
products (EX-CommandStation, EX-IOExpander, EX-Turntable). The old Python app lives in `.old_ex_installer/`
and `tests/unit/*.py` / `requirements.txt` are leftovers from it — **do not edit or run those**; all active
development is TypeScript under `src/` with tests under `tests/main/`, `tests/renderer/`, `tests/e2e/`.
Product metadata in `src/renderer/src/models/product-details.ts` is a direct port of the old
`ex_installer/product_details.py`.

The `README.md` at the repo root has a "Getting started" section for the current Electron/pnpm stack; the
"Legacy Python installer" section further down still describes the old Python app's build/run process and
does not apply to anything under `src/`.

## Commands

```bash
pnpm dev              # electron-vite dev (hot reload)
pnpm dev:mock         # dev with --mock-device (no real hardware needed)
pnpm build            # electron-vite build -> out/ (required before e2e tests)
pnpm toolchain:fetch  # download the bundled Python/PlatformIO runtime into resources/ (also runs as postinstall)
pnpm package          # pnpm build && electron-builder -> release/
pnpm typecheck        # tsc --noEmit against tsconfig.node.json + tsconfig.web.json
pnpm test             # vitest run (unit tests: tests/main/, tests/renderer/)
pnpm test:watch       # vitest watch mode
pnpm test:e2e         # pnpm build && playwright test (tests/e2e/)
pnpm test:all         # test + test:e2e
```

Run a single test file/case:
```bash
pnpm vitest run tests/renderer/turnout-editor.test.ts
pnpm test:e2e --grep "regression: pasting raw content"
```

`pnpm lint` exists in `package.json` but ESLint is not installed in this repo — it will fail. `pnpm typecheck`
is the real static check to run before considering a change done.

**Tests are required for behavior changes.** Prefer a Vitest unit test for pure logic (parsers, config
generators, validators). Use a Playwright E2E test in `tests/e2e/` when the bug/feature only manifests through
the Aurelia UI, Monaco editor, or Syncfusion controls — see `tests/e2e/fixtures.ts` for the mock-Electron
fixtures (`workspacePage`, `csb1StackedPage`, `ioExpanderPage`, `rosterGroupedPage`) that seed config files and
launch the app with `--mock-device --mock-compile --skip-startup --test-data-dir=<tmp>`.

Known pre-existing E2E failures unrelated to feature work (27 of them, same set before and after any change):
`throttle.spec.ts` (whole file — the throttle nav item never appears), four `load-from-folder.spec.ts` cases,
and two `turnout-editor.spec.ts` AUTOSTART cases. The raw↔visual round-trip cases in `turnout-editor.spec.ts`
are flaky under full-suite parallelism and pass in isolation.

`electron`, `python-shell`, `simple-git`, `serialport`, `usb` and `tar` are aliased to stubs in
`tests/stubs/` (wired up in `vitest.config.ts`) — without that, a test file's `vi.mock('<pkg>', …)` does not
reach the source modules that import them and every main-process test fails. See `tests/stubs/README.md`.

## Architecture

### Process split (Electron)

- `src/main/` — main process. Each domain (usb, platformio, git, files, preferences, python, config) has a
  service class (`usb-manager.ts`, `platformio.ts`, `git-client.ts`, `file-manager.ts`, `preferences.ts`,
  `python-runner.ts`) and a matching IPC handler module in `src/main/ipc/`, registered once from
  `registerAllIpcHandlers()` in `src/main/ipc/index.ts`.
- `src/preload/index.ts` — the only bridge between main and renderer. Exposes one `contextBridge` namespace per
  domain (`window.usb`, `window.platformio`, `window.git`, `window.files`, `window.preferences`, `window.config`,
  `window.electronWindow`). Adding an IPC call means touching main service → main IPC handler → preload → the
  matching `src/renderer/src/services/*.service.ts` wrapper, in that order.
- `src/renderer/` — the Aurelia 2 app, built by `@aurelia/vite-plugin` via `electron.vite.config.ts`. Renderer
  services (`services/*.service.ts`) are thin wrappers that just call `window.<namespace>.*` — no business logic
  should live in preload.
- Mock mode: `--mock-device` (fake USB/serial devices, see `src/main/dev-mock.ts`) and `--mock-compile` (skip
  the real PlatformIO toolchain) let E2E tests and local dev run without hardware. `--test-data-dir=<path>`
  redirects Electron's `userData` so preferences don't bleed between test runs.

### Build backend (PlatformIO, fully offline)

Firmware is built by **PlatformIO Core running on a Python interpreter bundled with the app** — nothing is
downloaded at runtime, so `git clone`/`git pull` of the DCC-EX product repos is the app's only network access.
See `TOOLCHAIN.md` for the full picture (build-time fetch vs. runtime seed, on-disk layout, offline fuse,
debugging a corrupted seed); the summary below is just the pointers you need day to day.

- `src/main/pio-runtime.ts` — resolves the bundled runtime (`resources/python`, `resources/pio/site-packages`,
  `resources/pio-core`, `resources/pio-libs`), seeds the writable core dir at `~/ex-installer/platformio` once
  per build (guarded by the manifest `stamp`), and builds `pioEnv()`. That environment points all HTTP at
  `http://127.0.0.1:9`, so if PlatformIO ever decides it wants to download a package the build fails loudly
  instead of quietly pulling an unpinned toolchain — do not remove that fuse. `seedRuntime()`'s copies are
  atomic (temp path + rename) specifically so a crash or a second app instance racing to seed the same shared
  core dir can't leave a package that looks installed but is missing files — see `TOOLCHAIN.md` if you hit
  that failure mode (compile fails with an HTTP error despite the fuse, only on one board type).
- `src/main/board-targets.ts` — the FQBN → PlatformIO target table, transcribed from the `platformio.ini` that
  CommandStation-EX ships upstream. **FQBN remains the app-wide board identity** (persisted in
  `SavedConfiguration.deviceFqbn` and embedded in every user's `config.h` device header); PlatformIO targets are
  an internal detail of the main process.
- `src/main/platformio.ts` — writes a generated `platformio.ini` into the scratch dir on every build (with
  `src_dir = .`, no `lib_deps`), then runs `python -m platformio run`. Builds are serialised so two runs never
  race over the shared core dir. `listBoards()` needs no subprocess: serial ports come from `UsbManager`, board
  identity from the shared VID/PID table in `src/types/boards.ts`.
- Bundled toolchains are **AVR and ESP32 only**. STM32 boards get an actionable error plus the in-app
  "import toolchain pack" route (`pio:browse-toolchain-pack` / `pio:import-toolchain-pack`).
- `scripts/fetch-toolchain.mjs` (`pnpm toolchain:fetch`) is the only code in the project that downloads
  anything, and it runs at build time. It must be run on each OS being packaged.

### Multi-board isolation

Scratch dirs are `repos/_build/<board-slug>-<id>/<repoFolder>`, where the slug is derived from the board's FQBN
plus its serial number (falling back to its port) — see `src/renderer/src/utils/board-key.ts`. PlatformIO build
output lives in `<scratch>/.pio/build/<env>`, and every board maps to a distinct env, so two boards never share
build artefacts. `findReusableConfig()` seeds a new configuration from the same physical board first, then any
board of the same type, and otherwise not at all — never from a different board type.

### Renderer state model

Two singletons (Aurelia DI, resolved via `resolve(...)`) hold nearly all cross-view state:

- `models/installer-state.ts` (`InstallerState`) — wizard-level state: selected device/product/version,
  `repoPath` (cloned product repo), `scratchPath` (per-device build dir), `sourceFolder` (set only when a
  config was loaded from a user folder without a `.ino`, so Save also writes back there), `configFiles`
  (the in-memory list of `{ name, content }` written to disk on Save).
- `models/config-editor-state.ts` (`ConfigEditorState`) — the single source of truth for every config file's
  *structured* representation (roster, turnouts, sensors, signals, routes, sequences, aliases, config.h) plus
  raw-text getters for each. `loadFromInstallerState()` parses `InstallerState.configFiles` into structured
  state; `syncAll()` (called by `workspace.saveFiles()` before writing to disk) serializes structured state back
  into `InstallerState.configFiles`.

  `myAutomation.h` is special: most of it is regenerated from other state (`#include` block from which files
  have content, turnout-defaults `AUTOSTART` block from turnout `defaultState`), but the TrackManager block has
  no other source of truth than the file itself — see `extractManagedBlockBody()` / `MANAGED_TRACK_MANAGER_TAG`.
  Whenever changing regeneration logic here, be careful about *where* raw-editor content gets re-absorbed into
  state: it must happen in `_syncToInstallerState()` (the save path), not inside `_ensureAutomationFile()`, which
  is also called synchronously by the TrackManager form's own write path (`syncTrackManager()`) and would
  otherwise clobber the value the form just set with stale on-disk content.

- Each config file has a matching visual editor under `components/visual-editors/` (e.g. `roster-editor`,
  `turnout-editor`, `sensors-editor`) with a Visual/Raw toggle. The Raw side is a Monaco editor; because Monaco
  debounces `onDidChangeContent` (~300ms) before pushing into Aurelia's two-way binding, any raw editor that
  needs its latest content flushed before a save/tab-switch must expose `component.ref` + an explicit `flush()`
  call (see `file-editor-panel.ts` and `workspace.ts`'s `flushPendingFormEdits()`) — don't rely on blur alone.
- Product-specific config forms live in `components/config-forms/` (`commandstation-config-form`,
  `ioexpander-config-form`) and read/write `ConfigEditorState` directly.

### Syncfusion controls

Syncfusion EJ2 components are used for all non-trivial form controls (dropdowns, checkboxes, radios, numeric
inputs) instead of native HTML controls. **Never use SF template strings** (`nodeTemplate`, `itemTemplate`,
etc.) — they compile via `new Function()`, which Electron's CSP blocks. Build DOM manually or use event hooks
(e.g. TreeView's `drawNode`) instead. Tab/section visibility inside forms with SF controls must be done by
toggling CSS classes (`class="${cond ? '...' : 'hidden'}"`), not `if.bind` — `if.bind` fully destroys/recreates
the element, which destroys the SF widget instance too.

### Routing

Three routes only, defined in `app.ts`: `startup` → `home` → `workspace`. `workspace` is where all config
editing happens; `home` handles picking/loading a saved configuration or an existing folder
(`resolveSketchPath()` in `views/home.ts` decides whether a loaded folder becomes the scratch dir directly or
gets copied into an internal `repos/_build/<id>/` scratch dir alongside `sourceFolder` tracking).
