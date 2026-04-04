# EX-Installer — Dev Mock Mode

Mock mode lets you run the full UI wizard and workspace without a physical Arduino connected. It does everything for real — real git clones, real compilation via Arduino CLI — the **only** thing that is faked is USB device scanning.

---

## How it works

Mock behaviour lives entirely in the **IPC layer** — the UI components have no knowledge of it and behave identically in both modes.

| IPC handler | Mock mode behaviour |
|---|---|
| `arduino-cli:list-boards` | Returns `MOCK_SERIAL_PORTS` from `dev-mock.ts` mapped to board name + FQBN via VID:PID lookup |
| `usb:list` / `usb:watch` | Returns / emits `MOCK_SERIAL_PORTS` |
| Everything else | **Real** — git clone/pull/checkout, version tag listing, reading/writing files, Arduino CLI `isInstalled`, `getVersion`, `compile`, `upload`, preferences storage |

### Per-device scratch folders

Every time a device is configured through the wizard, a unique scratch folder is created under `<install-dir>/repos/_build/<timestamp-id>`. Source files (`.cpp`, `.h`, `.ino`) are copied from the cloned repo; user-editable files (`config.h`, `myAutomation.h`, etc.) are preserved across reconfigures.

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
| `--mock-compile` | arduino-cli compile & upload responses (fast fake responses) |

| Launch command | Device mock | Compile mock |
|---|---|---|
| `pnpm dev` | **OFF** | **OFF** |
| `pnpm dev:mock` | **ON** | **ON** |
| `pnpm dev -- --mock-device` | **ON** | **OFF** |
| `pnpm dev -- --mock-device --mock-compile` | **ON** | **ON** |
| `pnpm build` (packaged) | **OFF** | **OFF** |

Flags are independent — for example, `--mock-device` lets you use virtual boards
while still running a real arduino-cli compile against the sketch.

E2E tests (Playwright) pass both `--mock-device` and `--mock-compile` by default
via the shared `launchApp(true)` helper in `tests/e2e/fixtures.ts`. Real-compiler
e2e tests use `workspacePageNative` (which calls `launchApp(false)`) and are
gated behind `COMPILE_E2E=1`.

---

## Customising the mock devices

Edit [`src/main/dev-mock.ts`](main/dev-mock.ts).

### Change which ports / boards appear

```ts
export const MOCK_SERIAL_PORTS: SerialDeviceInfo[] = [
    {
        path: 'MOCK_COM3',
        manufacturer: 'DCC-EX',
        serialNumber: 'DCCEX-MOCK-0001',
        vendorId: '2341',   // VID used for board name + FQBN lookup
        productId: '0042',  // 0042 = Mega 2560
    },
    // add more entries here
]
```

Common VID:PID values (full list in `arduino-cli-ipc.ts`):

| VID:PID | Board |
|---|---|
| `303a:1001` | EX-CSB1 (ESP32-S3) |
| `2341:0042` | Arduino Mega 2560 |
| `2341:0043` | Arduino Uno |
| `10c4:ea60` | ESP32 (CP2102) |

---

## UI differences in mock mode

- The toolbar shows a **Compile** button instead of **Compile & Upload** (upload requires a real connected device).
- The amber **DEV MOCK** badge is visible in the wizard header and workspace toolbar.

---

## File locations

```
src/
├── main/
│   ├── index.ts              ← IS_MOCK_DEVICE + IS_MOCK_COMPILE flag detection
│   ├── dev-mock.ts           ← MOCK_SERIAL_PORTS, mock data
│   └── ipc/
│       ├── arduino-cli-ipc.ts  ← list-boards mocked by IS_MOCK_DEVICE;
│       │                          compile/upload mocked by IS_MOCK_COMPILE
│       ├── git-ipc.ts          ← all real (no mock guards)
│       └── usb-ipc.ts          ← list + watch mocked by IS_MOCK_DEVICE
```
