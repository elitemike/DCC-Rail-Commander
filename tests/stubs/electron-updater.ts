/**
 * Stand-in for `electron-updater` under Vitest — see README.md in this folder.
 * Tests that need behaviour declare their own `vi.mock('electron-updater', …)`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const autoUpdater: any = undefined
export type UpdateInfo = any
