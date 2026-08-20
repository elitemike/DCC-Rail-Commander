# EX-Installer — Dev Mock Mode

Mock mode lets you run the full UI wizard and workspace without a physical Arduino connected. It does everything for real — real git clones, real compilation via the bundled PlatformIO toolchain — what's faked is USB device scanning and, separately, firmware upload (flashing a physical device), since mock mode never has real hardware to write to.

---

## How it works

Mock behaviour lives entirely in the **IPC layer** — the UI components have no knowledge of it and behave identically in both modes.

| IPC handler | Mock mode behaviour |
|---|---|
| `pio:list-boards` | Gated by `IS_MOCK_DEVICE`. Returns `MOCK_SERIAL_PORTS` from `dev-mock.ts` mapped to board name + FQBN via VID:PID lookup |
| `pio:compile` | **Always real.** Runs the bundled PlatformIO toolchain regardless of any mock flag — it never touches hardware, so there's nothing to fake |
| `pio:upload` | Gated by `IS_MOCK_UPLOAD`. Fast fake success response instead of a real PlatformIO flash |
| `usb:list-serial-ports` | Gated by `IS_MOCK_DEVICE`. Returns `MOCK_SERIAL_PORTS` |
| `usb:list-usb-devices` | Gated by `IS_MOCK_DEVICE`. Returns `[]` |
| `usb:open-port` / `usb:write-to-port` / `usb:close-port` / `usb:is-port-open` | Gated by `IS_MOCK_DEVICE`. Served by `MockSerialTransport` (`src/main/mock-serial-transport.ts`) instead of the real `UsbManager`, since mock port paths don't correspond to real hardware |
| Everything else | **Real** — git clone/pull/checkout, version tag listing, reading/writing files, PlatformIO `isRuntimeReady`, `getVersion`, `getPlatforms`, `checkToolchain`, toolchain pack import, preferences storage |

### Per-device scratch folders

Every time a device is configured through the wizard, a unique scratch folder is created under `<install-dir>/repos/_build/<board-slug>-<id>`. The folder name is keyed on the board (FQBN plus serial number or port), so two boards running the same product never share build output or settings. Source files (`.cpp`, `.h`, `.ino`) are copied from the cloned repo; user-editable files (`config.h`, `myAutomation.h`, etc.) are preserved across reconfigures.

Compile and upload operations always use the scratch path, never the git source repo.

---

## Default behaviour

| Command | Mock mode |
|---|---|
| `pnpm dev` | **OFF** |
| `pnpm build` (packaged) | **OFF** |

A small amber **DEV MOCK** badge is shown in the wizard header and the workspace top bar whenever mock mode is active.

---

## Controlling mock mode

Two independent flags control mocking. They are separate so developers can use
device mocking without bypassing the real compiler:

| Flag | Controls |
|---|---|
| `--mock-device` | USB/device scanning (virtual boards, no real hardware needed) |
| `--mock-upload` | PlatformIO upload response only (fast fake response). Compile is never gated by any flag — it's always real |

| Launch command | Device mock | Upload mock |
|---|---|---|
| `pnpm dev` | **OFF** | **OFF** |
| `pnpm dev:mock` | **ON** | **OFF** |
| `pnpm dev -- --mock-device --mock-upload` | **ON** | **ON** |
| `pnpm build` (packaged) | **OFF** | **OFF** |

`pnpm dev:mock` only passes `--mock-device` (see the `dev:mock` script in `package.json`) — add
`--mock-upload` yourself if you also want a fake upload response.

Flags are independent — for example, `--mock-device` lets you use virtual boards
while still running a real PlatformIO compile against the sketch.

E2E tests (Playwright) pass both `--mock-device` and `--mock-upload` by default
via the shared `launchApp()` helper in `tests/e2e/fixtures.ts`. Compile is real
in every e2e run — there's no mock-compile flag or opt-in gate anymore; only
upload is faked, since these tests never have a real device to flash.

---

## Customising the mock devices

Edit [`src/main/dev-mock.ts`](main/dev-mock.ts).

### Change which ports / boards appear

`MOCK_SERIAL_PORTS` ships with eight boards out of the box (EX-CSB1, Mega 2560, Uno, Nano, Nano Every, an
ESP32 via CP2102, a CH340 clone, and an FTDI adapter). Each entry looks like:

```ts
{
    // Arduino Mega 2560
    path: '/dev/ttyACM1',
    manufacturer: 'Arduino (www.arduino.cc)',
    serialNumber: 'DEV-MEGA-0001',
    vendorId: '2341',   // VID used for board name + FQBN lookup
    productId: '0042',  // 0042 = Mega 2560
},
// add more entries here
```

Common VID:PID values (full list in `src/types/boards.ts`):

| VID:PID | Board |
|---|---|
| `303a:1001` | EX-CSB1 (ESP32-S3) |
| `2341:0042` | Arduino Mega 2560 |
| `2341:0043` | Arduino Uno |
| `10c4:ea60` | CP2102 serial adapter (board type unknown) |
| `1a86:7523` | CH340 clone (Nano/Mega) |
| `0403:6001` | FTDI USB-Serial adapter |

---

## UI differences in mock mode

- The toolbar shows a **Compile** button instead of **Compile & Upload** (upload requires a real connected device).
- The amber **DEV MOCK** badge is visible in the wizard header and workspace toolbar.

---

## File locations

```
src/
├── main/
│   ├── index.ts               ← IS_MOCK_DEVICE + IS_MOCK_UPLOAD flag detection
│   ├── dev-mock.ts            ← MOCK_SERIAL_PORTS
│   ├── mock-serial-transport.ts ← fake open/write/close/is-open for mock ports
│   └── ipc/
│       ├── platformio-ipc.ts   ← list-boards mocked by IS_MOCK_DEVICE;
│       │                          compile always real; upload mocked by
│       │                          IS_MOCK_UPLOAD
│       ├── git-ipc.ts          ← all real (no mock guards)
│       └── usb-ipc.ts          ← list-serial-ports/list-usb-devices mocked by
│                                  IS_MOCK_DEVICE; open/write/close/is-open served
│                                  by MockSerialTransport under IS_MOCK_DEVICE
```
