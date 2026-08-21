import { describe, it, expect, vi } from 'vitest'
import { Startup } from '../../src/renderer/src/views/startup'

// ── Factory ───────────────────────────────────────────────────────────────────
// Built like tests/renderer/workspace.test.ts: a bare prototype instance with
// fields assigned manually, avoiding a full Aurelia DI bootstrap.

function makeStartup(opts: { hasCompletedOnboarding?: boolean; skipStartup?: boolean } = {}) {
    const startup = Object.create(Startup.prototype) as Startup

    const preferencesGet = vi.fn().mockImplementation((key: string) => {
        if (key === 'hasCompletedOnboarding') return Promise.resolve(opts.hasCompletedOnboarding ?? false)
        return Promise.resolve(undefined)
    })
    const preferencesSet = vi.fn().mockResolvedValue(undefined)

    const routerLoad = vi.fn()
    const themeSetMode = vi.fn()
    const editorDefaultViewSetValue = vi.fn()

    Object.assign(startup, {
        router: { load: routerLoad },
        state: { toolchainReady: false },
        pio: {
            getBundledVersion: vi.fn().mockResolvedValue('1.0.0'),
            getVersion: vi.fn().mockResolvedValue('1.0.0'),
            isRuntimeReady: vi.fn().mockResolvedValue(true),
            checkToolchain: vi.fn().mockResolvedValue({ installed: true }),
        },
        config: { ready: Promise.resolve(), skipStartup: opts.skipStartup ?? false },
        preferences: { get: preferencesGet, set: preferencesSet },
        theme: { mode: 'dark', setMode: themeSetMode },
        editorDefaultView: { value: 'visual', setValue: editorDefaultViewSetValue },
        phase: 'splash',
        statusMessage: '',
        progress: 0,
        installedVersion: null,
        bundledVersion: '',
        error: null,
        browseError: null,
        browseBusy: false,
    })

    return { startup, preferencesGet, preferencesSet, routerLoad, themeSetMode, editorDefaultViewSetValue }
}

// ── attached(): first-run welcome gate ────────────────────────────────────────
// The welcome phase must show exactly once — on a genuinely first launch — and
// never when skip-startup is set (e2e/dev-mock mode bypasses it entirely, same
// as the toolchain check).

describe('Startup.attached', () => {
    it('shows the welcome phase on first launch (no hasCompletedOnboarding preference)', async () => {
        const { startup, preferencesGet } = makeStartup({ hasCompletedOnboarding: false })

        await startup.attached()

        expect(preferencesGet).toHaveBeenCalledWith('hasCompletedOnboarding')
        expect(startup.phase).toBe('welcome')
    })

    it('skips the welcome phase for a returning user and proceeds straight to the toolchain check', async () => {
        const { startup, routerLoad } = makeStartup({ hasCompletedOnboarding: true })

        await startup.attached()

        expect(startup.phase).toBe('ready')
        expect(routerLoad).toHaveBeenCalledWith('home')
    })

    it('skips the welcome phase entirely when skipStartup is set', async () => {
        const { startup, preferencesGet } = makeStartup({ hasCompletedOnboarding: false, skipStartup: true })

        await startup.attached()

        expect(preferencesGet).not.toHaveBeenCalled()
        expect(startup.phase).toBe('ready')
    })
})

// ── finishWelcome(): persists the flag and proceeds ───────────────────────────

describe('Startup.finishWelcome', () => {
    it('persists the onboarding flag and proceeds to the toolchain check', async () => {
        const { startup, preferencesSet } = makeStartup({ hasCompletedOnboarding: false })

        await startup.finishWelcome()

        expect(preferencesSet).toHaveBeenCalledWith('hasCompletedOnboarding', true)
        expect(startup.phase).toBe('ready')
    })
})

// ── setTheme / setDefaultEditorView: apply immediately via the shared services ─
// Same services (and the same "applies immediately, nothing to save" behaviour)
// as the Settings dialog — see settings-dialog.ts.

describe('Startup.setTheme', () => {
    it('applies the theme via ThemeService', () => {
        const { startup, themeSetMode } = makeStartup()

        startup.setTheme('light')

        expect(themeSetMode).toHaveBeenCalledWith('light')
    })
})

describe('Startup.setDefaultEditorView', () => {
    it('applies the default editor view via EditorDefaultViewService', () => {
        const { startup, editorDefaultViewSetValue } = makeStartup()

        startup.setDefaultEditorView('raw')

        expect(editorDefaultViewSetValue).toHaveBeenCalledWith('raw')
    })
})
