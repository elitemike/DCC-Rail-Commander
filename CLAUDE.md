# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

EX-Installer is an Electron + Aurelia 2 rewrite of a legacy Python/Tkinter installer for DCC-EX Arduino
products (EX-CommandStation, EX-IOExpander, EX-Turntable). The old Python app lives in `.old_ex_installer/`
and `tests/unit/*.py` / `requirements.txt` are leftovers from it — **do not edit or run those**; all active
development is TypeScript under `src/` with tests under `tests/main/`, `tests/renderer/`, `tests/e2e/`.
Product metadata in `src/renderer/src/models/product-details.ts` is a direct port of the old
`ex_installer/product_details.py`.

The `README.md` at the repo root still describes the old Python app's build/run process — ignore it for
anything under `src/`.

## Commands

```bash
pnpm dev              # electron-vite dev (hot reload)
pnpm dev:mock         # dev with --mock-device (no real hardware needed)
pnpm build            # electron-vite build -> out/ (required before e2e tests)
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

Known pre-existing TS errors unrelated to feature work: `electron.vite.config.ts:41`, `src/main/preferences.ts:43`.

## Architecture

### Process split (Electron)

- `src/main/` — main process. Each domain (usb, arduino-cli, git, files, preferences, python, config) has a
  service class (`usb-manager.ts`, `arduino-cli.ts`, `git-client.ts`, `file-manager.ts`, `preferences.ts`,
  `python-runner.ts`) and a matching IPC handler module in `src/main/ipc/`, registered once from
  `registerAllIpcHandlers()` in `src/main/ipc/index.ts`.
- `src/preload/index.ts` — the only bridge between main and renderer. Exposes one `contextBridge` namespace per
  domain (`window.usb`, `window.arduinoCli`, `window.git`, `window.files`, `window.preferences`, `window.config`,
  `window.electronWindow`). Adding an IPC call means touching main service → main IPC handler → preload → the
  matching `src/renderer/src/services/*.service.ts` wrapper, in that order.
- `src/renderer/` — the Aurelia 2 app, built by `@aurelia/vite-plugin` via `electron.vite.config.ts`. Renderer
  services (`services/*.service.ts`) are thin wrappers that just call `window.<namespace>.*` — no business logic
  should live in preload.
- Mock mode: `--mock-device` (fake USB/serial devices, see `src/main/dev-mock.ts`) and `--mock-compile` (skip
  the real arduino-cli toolchain) let E2E tests and local dev run without hardware. `--test-data-dir=<path>`
  redirects Electron's `userData` so preferences don't bleed between test runs.

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
