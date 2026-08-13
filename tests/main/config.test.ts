/**
 * Unit tests for main/config.ts
 *
 * Tests the AppConfig shape, window defaults, and the bool() environment-variable
 * helper behaviour by re-importing the module with a controlled process.env.
 */
import { describe, it, expect, vi } from 'vitest'

describe('AppConfig shape', () => {
    it('exports a config object', async () => {
        const { config } = await import('../../src/main/config')
        expect(config).toBeDefined()
        expect(typeof config).toBe('object')
    })

    it('has a window section', async () => {
        const { config } = await import('../../src/main/config')
        expect(config.window).toBeDefined()
    })

    it('window width is 1920', async () => {
        const { config } = await import('../../src/main/config')
        expect(config.window.width).toBe(1920)
    })

    it('window height is 1080', async () => {
        const { config } = await import('../../src/main/config')
        expect(config.window.height).toBe(1080)
    })

    it('window minWidth is 900', async () => {
        const { config } = await import('../../src/main/config')
        expect(config.window.minWidth).toBe(900)
    })

    it('window minHeight is 600', async () => {
        const { config } = await import('../../src/main/config')
        expect(config.window.minHeight).toBe(600)
    })

    it('window is resizable', async () => {
        const { config } = await import('../../src/main/config')
        expect(config.window.resizable).toBe(true)
    })

    it('window is maximizable', async () => {
        const { config } = await import('../../src/main/config')
        expect(config.window.maximizable).toBe(true)
    })

    it('disableHardwareAcceleration is boolean', async () => {
        const { config } = await import('../../src/main/config')
        expect(typeof config.disableHardwareAcceleration).toBe('boolean')
    })

    it('disableDBus is boolean', async () => {
        const { config } = await import('../../src/main/config')
        expect(typeof config.disableDBus).toBe('boolean')
    })

    it('disableMediaSession is boolean', async () => {
        const { config } = await import('../../src/main/config')
        expect(typeof config.disableMediaSession).toBe('boolean')
    })
})

describe('bool() helper via env-var overrides', () => {
    /**
     * bool() is a private function but its behaviour is observable through the
     * exported `config` values.  We test it by dynamically importing a fresh
     * module instance with a mutated process.env.
     */
    async function loadConfigWithEnv(env: Record<string, string | undefined>) {
        // Snapshot current env
        const saved: Record<string, string | undefined> = {}
        for (const key of Object.keys(env)) saved[key] = process.env[key]

        // Apply overrides
        for (const [k, v] of Object.entries(env)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }

        // Clear module cache so config is re-evaluated with updated env vars
        vi.resetModules()
        const mod = await import('../../src/main/config')

        // Restore env
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }

        return mod.config
    }

    it('DISABLE_HW_ACCEL=0 sets disableHardwareAcceleration to false', async () => {
        const config = await loadConfigWithEnv({ DISABLE_HW_ACCEL: '0' })
        expect(config.disableHardwareAcceleration).toBe(false)
    })

    it('DISABLE_HW_ACCEL=false sets disableHardwareAcceleration to false', async () => {
        const config = await loadConfigWithEnv({ DISABLE_HW_ACCEL: 'false' })
        expect(config.disableHardwareAcceleration).toBe(false)
    })

    it('DISABLE_HW_ACCEL=1 sets disableHardwareAcceleration to true', async () => {
        const config = await loadConfigWithEnv({ DISABLE_HW_ACCEL: '1' })
        expect(config.disableHardwareAcceleration).toBe(true)
    })

    it('DISABLE_DBUS=0 sets disableDBus to false', async () => {
        const config = await loadConfigWithEnv({ DISABLE_DBUS: '0' })
        expect(config.disableDBus).toBe(false)
    })

    it('DISABLE_DBUS=1 sets disableDBus to true', async () => {
        const config = await loadConfigWithEnv({ DISABLE_DBUS: '1' })
        expect(config.disableDBus).toBe(true)
    })

    it('DISABLE_MEDIA_SESSION=0 sets disableMediaSession to false', async () => {
        const config = await loadConfigWithEnv({ DISABLE_MEDIA_SESSION: '0' })
        expect(config.disableMediaSession).toBe(false)
    })

    it('DISABLE_MEDIA_SESSION=1 sets disableMediaSession to true', async () => {
        const config = await loadConfigWithEnv({ DISABLE_MEDIA_SESSION: '1' })
        expect(config.disableMediaSession).toBe(true)
    })
})

describe('disableDBus auto-detection on Linux (no explicit DISABLE_DBUS)', () => {
    /**
     * On Linux with no override, disableDBus should only default to true when
     * there's no display (truly headless: CI, remote SSH, WSL without an X
     * server) — a real desktop session needs D-Bus for things like OS
     * dark/light theme detection (see ThemeService), so it must stay enabled
     * whenever DISPLAY or WAYLAND_DISPLAY is set.
     */
    async function loadConfigAsLinux(env: Record<string, string | undefined>) {
        const originalPlatform = process.platform
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

        const saved: Record<string, string | undefined> = {}
        for (const key of ['DISABLE_DBUS', 'DISPLAY', 'WAYLAND_DISPLAY']) saved[key] = process.env[key]
        for (const key of ['DISABLE_DBUS', 'DISPLAY', 'WAYLAND_DISPLAY']) delete process.env[key]
        for (const [k, v] of Object.entries(env)) {
            if (v !== undefined) process.env[k] = v
        }

        vi.resetModules()
        const mod = await import('../../src/main/config')

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }

        return mod.config
    }

    it('defaults to true (disabled) when neither DISPLAY nor WAYLAND_DISPLAY is set', async () => {
        const config = await loadConfigAsLinux({})
        expect(config.disableDBus).toBe(true)
    })

    it('defaults to false (enabled) when DISPLAY is set', async () => {
        const config = await loadConfigAsLinux({ DISPLAY: ':0' })
        expect(config.disableDBus).toBe(false)
    })

    it('defaults to false (enabled) when WAYLAND_DISPLAY is set', async () => {
        const config = await loadConfigAsLinux({ WAYLAND_DISPLAY: 'wayland-0' })
        expect(config.disableDBus).toBe(false)
    })

    it('explicit DISABLE_DBUS still wins over a present DISPLAY', async () => {
        const config = await loadConfigAsLinux({ DISPLAY: ':0', DISABLE_DBUS: '1' })
        expect(config.disableDBus).toBe(true)
    })
})
