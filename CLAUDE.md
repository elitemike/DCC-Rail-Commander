# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

EX-Commander is an Electron + Aurelia 2 rewrite of a legacy Python/Tkinter installer for DCC-EX Arduino
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
launch the app with `--mock-device --mock-upload --skip-startup --test-data-dir=<tmp>`. Compile always runs for
real against the bundled PlatformIO toolchain (it never touches hardware, so there's nothing to fake); only
upload is mocked, since e2e tests never have a real device to flash. There is no more mock-compile flag or
COMPILE_E2E opt-in gate — real compile is simply the default everywhere now.

As of 2026-08-20, all 259 tests pass individually and in most full runs (`pnpm test:e2e`), but the full suite has
a residual intermittent failure mode under `workers` parallelism (`playwright.config.ts`) that is **not** fixed by
lowering the worker count: at `workers: 6` a run was observed with an Electron child process (a Chromium zygote
helper, normally near-0% CPU) pegged at 200%+ CPU indefinitely, starving sibling workers and causing unrelated
tests to fail with "Tearing down electronApp exceeded the test timeout." Lowering to `workers: 4` and `workers: 2`
both still hit the same failure signature on a different, unpredictable subset of tests (never the same tests
twice, and not correlated with which spec does real work) — `workers: 2` failed too, just after a slower run, which
rules out simple CPU contention as the root cause. Passing `--no-zygote` to the Electron launch args (a common
mitigation for this exact Chromium zygote pattern) breaks Electron's own startup entirely in this environment, so
that fix is unavailable here. This predates the 2026-08-20 changes below — it reproduces with unrelated specs
(never `compile.spec.ts` specifically) — so treat any full-run failure as this known issue first: re-run the
specific failing test in isolation (`--grep` or a direct file path) before treating it as a regression, and if it
passes in isolation, it almost certainly is this issue, not new breakage. `workers: 4` is left as the default as a
reasonable balance; it is not a fix, just a value that produced clean runs at least as often as any other tried.

Believed to be a WSL2-specific Electron/Chromium sandbox quirk (zygote helper process hang), not a bug in this
codebase or its tests. Not investigated further — root-causing it means digging into Chromium sandbox internals
under WSL2, a materially different and open-ended task from fixing the test suite itself. If this box's Electron/
Chromium version changes, or the suite runs on native Linux/CI, re-check whether it still reproduces before
assuming it still applies.

Do not use `locator.isVisible({ timeout })` to wait for something to appear — Playwright documents that option
as ignored; `isVisible()` never polls, it checks current DOM state and returns immediately. This bit two Aurelia
confirm-dialog flows (`roster-editor.spec.ts`, `turnout-editor.spec.ts`, `config-editor.spec.ts`) where the
dialog is opened via a dynamic `import()`: the check ran before the dialog rendered, silently skipped the click,
and the test then hung waiting on a state change that could never happen. Use `locator.waitFor({ state: 'visible',
timeout })` (which does poll) before checking, or `expect(locator).toBeVisible()`.

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
- Mock mode: `--mock-device` (fake USB/serial devices, see `src/main/dev-mock.ts`) fakes hardware discovery, and
  `--mock-upload` fakes the upload (flash-to-device) response only — compile is never gated by a flag and always
  runs for real against the bundled PlatformIO toolchain, since it never touches hardware. `--test-data-dir=<path>`
  redirects Electron's `userData` so preferences don't bleed between test runs. See `src/DEV-MOCK.md` for the
  full per-IPC-handler breakdown of what's faked vs. real.

### Build backend (PlatformIO, fully offline)

Firmware is built by **PlatformIO Core running on a Python interpreter bundled with the app** — nothing is
downloaded at runtime, so `git clone`/`git pull` of the DCC-EX product repos is the app's only network access.
See `TOOLCHAIN.md` for the full picture (build-time fetch vs. runtime seed, on-disk layout, offline fuse,
debugging a corrupted seed); the summary below is just the pointers you need day to day.

- `src/main/pio-runtime.ts` — resolves the bundled runtime (`resources/python`, `resources/pio/site-packages`,
  `resources/pio-core`, `resources/pio-libs`), seeds the writable core dir at `~/ex-commander/platformio` once
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

  `myAutomation.h`'s role is deliberately narrow: it's the file that links other files together, plus the HAL
  Devices block. It's regenerated from other state (`#include` block from which files have content, the
  `MANAGED_HAL_DEVICES_TAG` block from `generatedHalDevicesContent`) plus whatever free-form custom EXRAIL code
  the user typed directly (`preservedAutomationContent`). Track power/mode and turnout defaults live in a
  separate generated file, **`myStartup.h`** (included from `myAutomation.h`'s `#include` block when non-empty):
  the `MANAGED_TRACK_MANAGER_TAG` block has no other source of truth than the file itself, while the
  `MANAGED_TURNOUT_DEFAULTS_TAG` block is purely derived from turnout `defaultState` on every turnout mutation
  (`_syncGeneratedTurnoutDefaultsContent()`) — see `extractManagedBlockBody()` in `config-editor-state.ts`.
  Loading an old project whose `myAutomation.h` still has these blocks in the pre-split format migrates them
  into a new `myStartup.h` on load (see the migration block in `loadFromInstallerState()`).

  Whenever changing regeneration logic here, be careful about *where* raw-editor content gets re-absorbed into
  state: TrackManager/HAL re-extraction from the *current* on-disk file must happen only in
  `_syncToInstallerState()` (the save path), never inside `_ensureAutomationFile()`/`_ensureStartupFile()`, which
  are also called synchronously by their own write paths (`syncTrackManager()`/`syncHalDevices()`) and would
  otherwise clobber the value the form just set with stale on-disk content. Turnout defaults are the odd one out
  here — they're *never* re-derived inside `_syncToInstallerState()`, since `_syncGeneratedTurnoutDefaultsContent()`
  (called by every turnout mutator immediately before `_syncToInstallerState()`) is their only write path; re-deriving
  them from stale file content there would silently undo the mutation that's still in flight.

- Each config file has a matching visual editor under `components/visual-editors/` (e.g. `roster-editor`,
  `turnout-editor`, `sensors-editor`, `startup-editor`) with a Visual/Raw toggle. The Raw side is a Monaco editor;
  because Monaco debounces `onDidChangeContent` (~300ms) before pushing into Aurelia's two-way binding, any raw
  editor that needs its latest content flushed before a save/tab-switch must expose `component.ref` + an explicit
  `flush()` call (see `file-editor-panel.ts` and `workspace.ts`'s `flushPendingFormEdits()`) — don't rely on blur
  alone. `automation-editor` (`myAutomation.h`) is the one exception: it's always-raw now, since nothing
  structured is left in that file to justify a Visual tab.
- Product-specific config forms live in `components/config-forms/` (`commandstation-config-form`,
  `ioexpander-config-form`, `track-manager-form`, `turnout-defaults-summary`, `hal-devices-form`) and read/write
  `ConfigEditorState` directly.
- **Any custom element that needs to fill its flex parent's height** (so height cascades down to a nested
  Monaco editor or scrollable form) must be added to the explicit tag-name allowlist in `styles.css` (the
  "Custom element host sizing" rule) — Aurelia renders custom elements as `display: inline` by default, which
  silently collapses Monaco's container to zero height with no error, only a visibly broken/empty editor.

### Device Settings nav (left sidebar tree)

"Device Settings" is a tree parent in `workspace.html`'s left nav (defaults expanded —
`workspace.ts`'s `deviceSettingsExpanded`), with four children: **General + WiFi** (`config.h`/`myConfig.h`,
via `config-h-editor`), **Accessories** (HAL devices — `accessories-editor`, Visual = `hal-devices-form`, Raw =
just the HAL Devices block slice via `generatedHalDevicesContent`/`syncHalDevices()`, not the whole
`myAutomation.h` file), **Startup** (`myStartup.h`, via `startup-editor`), and **Advanced** (`myAutomation.h`,
via `automation-editor`, always-raw). General + WiFi, Startup, and Advanced are real `configFiles` entries and
route through `activeFileIndex` + `file-editor-panel`'s filename-keyed dispatch like any other file; Accessories
has no `configFiles` entry of its own (it's a slice of `myAutomation.h`) and is mounted directly in
`workspace.html` via a third `activeSection === 'accessories'` branch, sibling to `file-editor-panel` — see
`workspace.ts`'s `selectGeneralWifi()`/`selectAccessoriesSection()`/`selectStartup()`/`selectAdvanced()`.
**Advanced is deliberately not labeled "Automation"** (`file-configs.ts`'s `friendlyName` for `myAutomation.h`
is `'Advanced'`, not `'Automation'`) — that name would collide with EXRAIL's own `AUTOMATION()` blocks, a
different, user-facing concept. `automation-editor.html` also carries an inline note that this file just links
the other config files together and shouldn't normally be hand-edited; custom EXRAIL code belongs in a new,
purpose-named file instead (created via the Configuration list's + button), which gets `#include`d automatically
— see `automationPreview` in `config-editor-state.ts`.

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
