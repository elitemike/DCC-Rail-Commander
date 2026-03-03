/**
 * app-config.ts — static application configuration for the Electron main process.
 *
 * These are developer/deployment-level flags. For user-controlled preferences
 * that persist between sessions (e.g. remembered window size) use electron-store.
 *
 * All values can be overridden at runtime via environment variables so that
 * CI, packaging, and different developer machines can opt in/out without
 * changing source.
 */

export interface AppConfig {
    /**
     * Disable Chromium GPU/hardware acceleration.
     * Required on Linux environments without GPU drivers or a display server
     * (e.g. remote dev, CI, WSL). Set DISABLE_HW_ACCEL=0 to override.
     */
    disableHardwareAcceleration: boolean

    /**
     * Suppress D-Bus connection errors on Linux systems without a session bus
     * (e.g. remote SSH, headless). Set DISABLE_DBUS=0 to override.
     */
    disableDBus: boolean

    /**
     * Disable the Chromium MediaSessionService which is the primary source of
     * D-Bus calls. Can also be disabled via DISABLE_MEDIA_SESSION=0.
     */
    disableMediaSession: boolean

    /** Initial and minimum window dimensions. */
    window: {
        width: number
        height: number
        minWidth: number
        minHeight: number
        resizable: boolean
        maximizable: boolean
    }
}

function bool(envVar: string | undefined, defaultValue: boolean): boolean {
    if (envVar === undefined) return defaultValue
    return envVar !== '0' && envVar !== 'false'
}

export const config: AppConfig = {
    disableHardwareAcceleration: bool(process.env['DISABLE_HW_ACCEL'], true),
    disableDBus: bool(process.env['DISABLE_DBUS'], process.platform === 'linux'),
    disableMediaSession: bool(process.env['DISABLE_MEDIA_SESSION'], process.platform === 'linux'),
    window: {
        width: 1920,
        height: 1080,
        minWidth: 900,
        minHeight: 600,
        resizable: true,
        maximizable: true,
    },
}
