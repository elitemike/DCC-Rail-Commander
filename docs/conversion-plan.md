# EX-Installer: Python → Electron/Aurelia 2 Conversion Plan

## Part 1 — How the Python `ex_installer` Works

### Architecture Overview

EX-Installer is a **CustomTkinter** desktop GUI that guides users through installing DCC-EX model railroad firmware (EX-CommandStation, EX-IOExpander, EX-Turntable) onto Arduino-compatible boards. It uses a **wizard-style, multi-view architecture** with a single root window (`EXInstaller`) that swaps child frames in and out via `switch_view()`.

### Module Map

```
__main__.py              Entry point — CLI args, logging, DPI scaling, mainloop
ex_installer.py          Root window — view registry, menu bar, navigation controller
├── welcome.py           Step 1: Welcome / landing page
├── manage_arduino_cli.py Step 2: Download/install/refresh Arduino CLI + platforms + libraries
├── select_device.py     Step 3: Scan USB, select connected Arduino board
├── select_product.py    Step 4: Choose product (CommandStation, IOExpander, Turntable)
├── select_version_config.py Step 5: Choose version (Prod/Devel/tag), clone repo, choose config source
├── ex_commandstation.py Step 6a: CommandStation config (motor driver, WiFi, TrackManager, etc.)
├── ex_ioexpander.py     Step 6b: IOExpander config (I2C address, diagnostics)
├── ex_turntable.py      Step 6c: Turntable config (stepper, sensors, phase switching)
├── advanced_config.py   Step 7 (optional): Direct text editing of generated config files
├── compile_upload.py    Step 8: Compile sketch + upload to board via Arduino CLI
├── serial_monitor.py    Utility: Live serial port monitor with color highlighting
├── arduino_cli.py       Service: Arduino CLI wrapper (download, install, compile, upload)
├── git_client.py        Service: pygit2 wrapper (clone, pull, list versions)
├── file_manager.py      Service: File I/O, downloads, archive extraction, user preferences
├── common_widgets.py    UI: Base view layout (WindowLayout), navigation bar (NextBack), tooltip, textbox
├── common_fonts.py      UI: Shared font definitions
├── product_details.py   Data: Product metadata (repos, supported devices, config files)
└── version.py           Data: App version string
```

### Core Patterns

#### 1. View Navigation
`EXInstaller` maintains a `views` dict mapping string keys to view classes and a `frames` dict caching instantiated views. `switch_view(view_class, product, version)` either raises an existing frame or creates a new one. Some views (compile_upload, advanced_config) are always re-created to reset state.

#### 2. Layout
Every view inherits from `WindowLayout(ctk.CTkFrame)`, which provides:
- **Title frame** (top) — product logo + title text
- **Main frame** (center) — view-specific content
- **Status frame** (bottom) — `NextBack` navigation bar with Back/Next/Log/Monitor buttons

`WindowLayout` also provides properties that reach up to the root `EXInstaller` to access shared singletons: `self.acli` (ArduinoCLI), `self.git` (GitClient), `self.common_fonts`, `self.app_version`.

#### 3. Async Processing
Long-running operations (download, extract, git clone, Arduino CLI compile/upload) run in **daemon threads** (`ThreadedArduinoCLI`, `ThreadedGitClient`, `ThreadedDownloader`, `ThreadedExtractor`). Each thread posts `QueueMessage(status, topic, data)` namedtuples to a `queue.Queue`. The view polls with `self.after(100, self.process_monitor)`, reads from the queue, and generates **custom tkinter events** (`<<Event_Name>>`) that trigger state-machine handler methods dispatched by `process_phase` / `process_status`.

#### 4. State Machines
`manage_arduino_cli`, `select_version_config`, and `compile_upload` use `match/case` blocks on `(process_phase, process_status)` to sequence multi-step workflows. For example, `manage_arduino_cli`'s install flow: `install_cli` → `download` → `extract` → `init` → `update_index` → `install_packages` → `install_libraries` → `refresh_boards`.

#### 5. Config Generation
Product views (`ex_commandstation`, `ex_ioexpander`, `ex_turntable`) collect UI form values, validate them, and produce lists of C `#define` lines written to files like `config.h`, `myConfig.h`, and `myAutomation.h` in the cloned repo directory via `FileManager.write_config_file()`.

#### 6. External Tools
- **Arduino CLI** (v0.35.3 binary) — downloaded per-platform, invoked via subprocess for board detection, platform/library installation, sketch compilation, and firmware upload.
- **pygit2** — clones DCC-EX repos, pulls updates, lists tags/branches for version selection.
- **pyserial** — serial port enumeration and communication for the serial monitor.
- **requests** — HTTP downloads for Arduino CLI binary.

### Data Flow Summary

```
USB Board Detection:
  Arduino CLI `board list` → JSON → SelectDevice radio buttons → acli.selected_device

Version Selection:
  pygit2 clone/pull → tag list → SelectVersionConfig combos → checkout tag → source tree on disk

Config Generation:
  Product form values → validation → #define lines → write to <repo>/config.h

Compile & Upload:
  Arduino CLI compile(sketch_dir, fqbn) → Arduino CLI upload(hex, port) → success/error
```

---

## Part 2 — Conversion Plan to Electron / Aurelia 2

### What Already Exists in the Electron App

The Electron shell is functional with:
- **Main process**: `BrowserWindow`, IPC handler registration, `PythonRunner` (python-shell wrapper), `UsbManager` (serial port + USB hotplug via `serialport` + `usb` packages)
- **Preload**: `contextBridge` exposes `window.python` and `window.usb` APIs
- **Renderer**: Aurelia 2 app with `PythonService`, `UsbService`, a `DeviceList` component, and Syncfusion UI library (buttons, base styles, Tailwind CSS v4)
- **IPC types**: Shared TypeScript interfaces for serial/USB/Python contracts

### Conversion Strategy

The conversion replaces the **Python/CustomTkinter GUI layer** while preserving (and eventually replacing) the Python **service layer** underneath. The approach is:

1. **Views → Aurelia 2 components** (HTML templates + TypeScript view-models)
2. **WindowLayout base → Aurelia 2 layout component** with slot-based composition
3. **Threading + Queues → Electron IPC + async/await** (already partially built)
4. **Arduino CLI wrapper → main-process service** exposed via IPC
5. **Git operations → main-process service** (isomorphic-git or shell git) exposed via IPC
6. **File management → main-process service** using Node.js `fs` via IPC
7. **Serial monitor → renderer component** backed by existing `UsbService`
8. **Config generation → pure TypeScript functions** (no file I/O needed until write)

### Phase Breakdown

#### Phase 1 — Core Infrastructure (Foundation)

| Task | Details |
|------|---------|
| **Router + navigation** | Install `@aurelia/router`. Define route graph matching Python view flow: `welcome` → `manage-cli` → `select-device` → `select-product` → `select-version` → `[product-config]` → `advanced-config?` → `compile-upload`. |
| **Shell layout component** | Create `<app-layout>` with `<slot name="title">`, `<slot>` (main), `<slot name="status">`. Replaces `WindowLayout`. |
| **Navigation bar component** | `<nav-bar>` with back/next buttons, bindable `back-command`, `next-command`, `back-text`, `next-text`, `show-monitor` etc. Replaces `NextBack`. |
| **Shared state store** | Aurelia 2 DI singleton `InstallerState` holding: `selectedDevice`, `selectedProduct`, `selectedVersion`, `preferences`, `appVersion`. Replaces class-level variables on `EXInstaller`. |
| **Preferences service** | Main-process `electron-store` (or JSON file via IPC) replacing `FileManager.get_user_preferences()`. |

#### Phase 2 — Main-Process Services (Backend)

| Task | Details |
|------|---------|
| **ArduinoCLI service** | New `src/main/arduino-cli.ts`: download binary per-platform, spawn `arduino-cli` subprocess (JSON mode), parse output. Methods: `isInstalled()`, `getVersion()`, `downloadCli()`, `installCli()`, `deleteCLI()`, `initConfig()`, `updateIndex()`, `installPlatform()`, `installLibrary()`, `getPlatforms()`, `getLibraries()`, `listBoards()`, `compile()`, `upload()`. Expose all via IPC handlers in `src/main/ipc/arduino-cli-ipc.ts`. |
| **Git service** | New `src/main/git-client.ts`: use `simple-git` (or shell `git`). Methods: `clone()`, `pull()`, `listTags()`, `checkout()`, `checkLocalChanges()`, `hardReset()`. Expose via IPC. |
| **File service** | New `src/main/file-manager.ts`: wraps Node.js `fs/promises`. Methods: `readFile()`, `writeFile()`, `listDir()`, `copyFiles()`, `deleteFiles()`, `downloadFile()`, `extractArchive()`, `getInstallDir()`. Expose via IPC. |
| **Preload expansion** | Add `window.arduinoCli`, `window.git`, `window.files` API surfaces via `contextBridge`. |
| **IPC type contracts** | Extend `src/types/ipc.ts` with interfaces for all new APIs. |

#### Phase 3 — Renderer Views (UI Step-by-Step)

Each Python view becomes an Aurelia 2 routed component. Build them in wizard order:

| # | Python View | Aurelia Component | Key UI Elements (Syncfusion / Tailwind) |
|---|-------------|-------------------|----------------------------------------|
| 1 | `welcome.py` | `welcome-view` | Bullet-point intro text, product logos. Next only. |
| 2 | `manage_arduino_cli.py` | `manage-cli-view` | Status labels, Install/Refresh button, progress indicator, ESP32/STM32 platform toggle switches. State-machine progress via async generators or observable status. |
| 3 | `select_device.py` | `select-device-view` | Scan button, radio-button list of detected devices (from `window.arduinoCli.listBoards()` + `window.usb.listSerialPorts()`), combo box for ambiguous boards. |
| 4 | `select_product.py` | `select-product-view` | Product cards with logos: EX-CommandStation, EX-IOExpander, EX-Turntable. Device compatibility check gating. |
| 5 | `select_version_config.py` | `select-version-view` | Version radio buttons (Latest Prod / Latest Devel / Select), version dropdown, config source radio (New / Existing / Load). Git clone/pull progress. |
| 6a | `ex_commandstation.py` | `commandstation-config-view` | Tabbed form (General / WiFi / TrackManager). Motor driver combo, display radios, WiFi AP/STA config, track mode combos, current limit, EEPROM toggle. |
| 6b | `ex_ioexpander.py` | `ioexpander-config-view` | I2C address stepper, pullup toggle, diagnostic switches. |
| 6c | `ex_turntable.py` | `turntable-config-view` | Tabbed form (General / Stepper / Advanced). I2C address, mode toggle, stepper driver combo, sensor toggles, phase switching angle, acceleration/speed entries. |
| 7 | `advanced_config.py` | `advanced-config-view` | Code editor textboxes (or Monaco/CodeMirror lite) for generated config files. |
| 8 | `compile_upload.py` | `compile-upload-view` | Compile button, progress bar, log output textbox, backup config popup. |
| — | `serial_monitor.py` | `serial-monitor` | Panel/modal with output textbox, command input, color-highlighted log, save button. Wired to existing `UsbService`. |

#### Phase 4 — Config Generation (Business Logic)

| Task | Details |
|------|---------|
| **Product details** | Port `product_details.py` → `src/renderer/src/models/product-details.ts` as typed constants. |
| **Config generators** | Port `generate_config()` / `generate_myAutomation()` from each product view into pure TypeScript functions: `generate-commandstation-config.ts`, `generate-ioexpander-config.ts`, `generate-turntable-config.ts`. Each takes a typed options object, validates, returns `{ valid: boolean, files: { name: string, content: string }[] }`. |
| **Motor driver parser** | Port `get_motor_drivers()` logic — read `MotorDrivers.h` from cloned repo (via file IPC), regex-extract driver names. |
| **Stepper parser** | Port `get_steppers()` — read `standard_steppers.h`, extract stepper definitions. |

#### Phase 5 — Polish & Feature Parity

| Task | Details |
|------|---------|
| **Error handling** | Global error boundary component. Electron `dialog.showErrorBox()` for critical failures. Log file access via IPC. |
| **Menu bar** | Electron native menu: Info (About, Website, Instructions, News, Debug toggle), Tools (Scaling via `webFrame.setZoomFactor()`). |
| **Logging** | `electron-log` in main process. Renderer console forwarded to main log file. |
| **Fake device mode** | CLI flag / env var `--fake` that makes `ArduinoCLIService` return mock data. |
| **User preferences** | Screen scaling, remembered settings via `electron-store`. |
| **Packaging** | `electron-builder` config (already partially done in `package.json`). Bundle Arduino CLI binary + Python scripts as `extraResources`. |

### Suggested File Structure (Final)

```
src/
  main/
    index.ts                    # App lifecycle, window creation
    config.ts                   # Static app config
    python-runner.ts            # Python subprocess wrapper (existing)
    usb-manager.ts              # Serial/USB manager (existing)
    arduino-cli.ts              # NEW — Arduino CLI subprocess wrapper
    git-client.ts               # NEW — Git operations (simple-git)
    file-manager.ts             # NEW — File I/O operations
    ipc/
      index.ts                  # Register all IPC handlers
      python-ipc.ts             # (existing)
      usb-ipc.ts                # (existing)
      arduino-cli-ipc.ts        # NEW
      git-ipc.ts                # NEW
      file-ipc.ts               # NEW
  preload/
    index.ts                    # contextBridge (extend with new APIs)
  types/
    ipc.ts                      # Shared type contracts (extend)
  renderer/
    index.html
    src/
      main.ts                   # Aurelia bootstrap
      app.ts                    # Root component (router host)
      app.html                  # Router outlet + shell layout
      styles.css                # Tailwind + Syncfusion imports
      models/
        product-details.ts      # Product metadata constants
        installer-state.ts      # Shared state singleton (DI)
      services/
        python.service.ts       # (existing)
        usb.service.ts          # (existing)
        arduino-cli.service.ts  # NEW — wraps window.arduinoCli
        git.service.ts          # NEW — wraps window.git
        file.service.ts         # NEW — wraps window.files
        preferences.service.ts  # NEW — wraps window.preferences
      config/
        commandstation.ts       # Config generator (pure logic)
        ioexpander.ts           # Config generator
        turntable.ts            # Config generator
        motor-drivers.ts        # MotorDrivers.h parser
        steppers.ts             # standard_steppers.h parser
      components/
        app-layout.html         # Shell layout (title / main / status slots)
        app-layout.ts
        nav-bar.html            # Back/Next navigation bar
        nav-bar.ts
        device-list.html        # (existing)
        device-list.ts          # (existing)
        serial-monitor.html     # Serial monitor panel
        serial-monitor.ts
      views/
        welcome.html + .ts
        manage-cli.html + .ts
        select-device.html + .ts
        select-product.html + .ts
        select-version.html + .ts
        commandstation-config.html + .ts
        ioexpander-config.html + .ts
        turntable-config.html + .ts
        advanced-config.html + .ts
        compile-upload.html + .ts
```

### Migration Priority Order

1. **Phase 1** (routing, layout, state) — unblocks all view work
2. **Phase 2** (Arduino CLI + Git services) — unblocks the real workflows
3. **Phase 3** views 1–3 (welcome, manage CLI, select device) — first end-to-end flow
4. **Phase 3** views 4–5 (select product, select version) — complete pre-config wizard
5. **Phase 4** (config generators) + **Phase 3** views 6a–6c — product configuration
6. **Phase 3** views 7–8 (advanced config, compile/upload) — complete the wizard
7. **Phase 5** (polish, menus, logging, packaging) — production readiness

### Key Design Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **Routing library** | `@aurelia/router` | Native Aurelia 2 router with lifecycle hooks matching the wizard flow. |
| **State management** | Aurelia DI singleton | Simple, no extra library. A single `InstallerState` class registered as a singleton covers all shared state. |
| **Arduino CLI invocation** | Node.js `child_process.spawn` in main process | Direct subprocess control, JSON output parsing, progress streaming via IPC. No Python dependency for this. |
| **Git operations** | `simple-git` npm package in main | Pure JS, no native deps, well-maintained. Replaces pygit2. |
| **Config file editing** | CodeMirror 6 or plain `<textarea>` | CodeMirror gives syntax highlighting for C `#define` files; plain textarea is simpler to start. |
| **Syncfusion components** | Use for forms (ComboBox, Switch, RadioButton, NumericTextBox, Tab) | Already installed; rich component library matches the dense config forms. |
| **Python scripts** | Keep for board detection initially; phase out as Node.js services mature | `detect_boards.py` can be replaced by `arduino-cli board list --json` directly. |
