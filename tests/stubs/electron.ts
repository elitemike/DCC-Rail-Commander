/**
 * Stand-in for the `electron` module under Vitest.
 *
 * `electron`'s npm package is a CommonJS shim that exports a path string and
 * only resolves to the real API inside an Electron process. Vitest externalises
 * it, and since v4.1 a `vi.mock('electron', …)` factory declared in a test file
 * no longer reaches the main-process source modules under test — they end up
 * importing an empty namespace and fail with "Cannot read properties of
 * undefined". Aliasing `electron` to this local module (see `vitest.config.ts`)
 * keeps it inside Vitest's module graph so mocks apply everywhere.
 *
 * Nothing here is meant to behave like Electron: every test that touches these
 * declares its own `vi.mock('electron', …)` with just the surface it needs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const app: any = undefined
export const dialog: any = undefined
export const ipcMain: any = undefined
export const ipcRenderer: any = undefined
export const BrowserWindow: any = undefined
export const shell: any = undefined
export const contextBridge: any = undefined
export type IpcRendererEvent = unknown
