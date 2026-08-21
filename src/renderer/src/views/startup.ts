import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { PlatformIoService } from '../services/platformio.service'
import { ConfigService } from '../services/config.service'
import { PreferencesService } from '../services/preferences.service'
import { ThemeService, type ThemeMode } from '../services/theme.service'
import { EditorDefaultViewService, type EditorViewMode } from '../services/editor-default-view.service'
import type { SavedConfiguration } from '../models/saved-configuration'

/**
 * Startup is no longer an installer.
 *
 * The build toolchain (Python, PlatformIO Core and the platform packs) ships
 * inside the application, so the only work left at launch is copying the
 * bundled packs into the writable core directory the first time a given build
 * of the app runs. Nothing here downloads anything.
 */
type SetupPhase =
    | 'splash'
    | 'welcome'
    | 'checking'
    | 'seeding'
    | 'toolchain-prompt'
    | 'ready'
    | 'error'

export class Startup {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly pio = resolve(PlatformIoService)
    private readonly config = resolve(ConfigService)
    private readonly preferences = resolve(PreferencesService)
    readonly theme = resolve(ThemeService)
    readonly editorDefaultView = resolve(EditorDefaultViewService)

    phase: SetupPhase = 'splash'
    statusMessage = 'Checking build toolchain...'
    progress = 0
    installedVersion: string | null = null
    bundledVersion = ''
    /** General error shown in the error card. */
    error: string | null = null
    /** Inline error shown inside prompt cards. */
    browseError: string | null = null
    /** True while a browse+import flow is in progress. */
    browseBusy = false

    async attached(): Promise<void> {
        await this.config.ready
        if (this.config.skipStartup) {
            this.markReady()
            return
        }
        if (!(await this.preferences.get<boolean>('hasCompletedOnboarding'))) {
            this.phase = 'welcome'
            return
        }
        await this.checkAndSetup()
    }

    // ── First-run welcome ────────────────────────────────────────────────────
    // Shown once, before the toolchain check, so the choice is made before the
    // user starts actually using the app rather than buried in a menu they may
    // never open. Theme/default-view changes here apply immediately via the
    // same services the Settings dialog uses — there is nothing to "save".

    setTheme(mode: ThemeMode): void {
        void this.theme.setMode(mode)
    }

    setDefaultEditorView(mode: EditorViewMode): void {
        void this.editorDefaultView.setValue(mode)
    }

    async finishWelcome(): Promise<void> {
        await this.preferences.set('hasCompletedOnboarding', true)
        await this.checkAndSetup()
    }

    private async checkAndSetup(): Promise<void> {
        this.phase = 'checking'
        this.error = null
        this.browseError = null
        this.progress = 0

        try {
            this.bundledVersion = await this.pio.getBundledVersion()
            this.installedVersion = await this.pio.getVersion()

            if (await this.pio.isRuntimeReady()) {
                if (await this.needsToolchainPack()) {
                    this.phase = 'toolchain-prompt'
                    return
                }
                this.markReady()
                return
            }

            // No runnable interpreter at all: nothing to seed, and nothing the
            // user can do about it here.
            if (!this.installedVersion) {
                await this.continueWithoutToolchain('bundled runtime is missing or not runnable')
                return
            }

            await this.seed()
        } catch (err) {
            this.error = (err as Error).message
            this.phase = 'error'
        }
    }

    /**
     * Copies the bundled platform packs into the writable core dir. Runs once
     * per build of the app; the progress messages come from the main process.
     */
    private async seed(): Promise<void> {
        this.phase = 'seeding'
        this.statusMessage = 'Preparing build toolchain...'
        this.progress = 10

        const unsubscribe = this.pio.subscribeToProgress((payload) => {
            if (payload.phase !== 'seed') return
            this.statusMessage = payload.message
            // The seed step has no meaningful total, so creep towards 90% and
            // let completion take it the rest of the way.
            this.progress = Math.min(90, this.progress + 5)
        })

        try {
            const result = await this.pio.seedRuntime()
            if (!result.success) throw new Error(result.error ?? 'Could not prepare the build toolchain.')
            this.progress = 100
            if (await this.needsToolchainPack()) {
                this.phase = 'toolchain-prompt'
                return
            }
            this.markReady()
        } finally {
            unsubscribe()
        }
    }

    /**
     * True when a board the user has already configured needs a toolchain this
     * build doesn't bundle (STM32) and hasn't been imported yet.
     *
     * Checked against saved configurations rather than asked unconditionally,
     * so the overwhelming majority of users — on AVR and ESP32 boards — never
     * see this prompt.
     */
    private async needsToolchainPack(): Promise<boolean> {
        try {
            const saved = await this.preferences.get('savedConfigurations') as SavedConfiguration[] | undefined
            if (!Array.isArray(saved)) return false
            const fqbns = [...new Set(saved.map((c) => c.deviceFqbn).filter(Boolean))]
            for (const fqbn of fqbns) {
                if (!(await this.pio.checkToolchain(fqbn)).installed) return true
            }
            return false
        } catch {
            // Never block launch on this check.
            return false
        }
    }

    /**
     * A build toolchain that is missing outright — a development checkout that
     * hasn't run `pnpm toolchain:fetch`, or a broken package — must not lock the
     * user out of the app: editing and saving configurations still works fine
     * without it, and compile/upload already fail with the same message at the
     * point where it is actionable.
     */
    private async continueWithoutToolchain(reason: string): Promise<void> {
        console.warn('[startup] build toolchain unavailable:', reason)
        this.markReady(false)
    }

    // ── Toolchain pack import ────────────────────────────────────────────────
    // Boards outside the bundled set (STM32) need a toolchain pack supplied by
    // the user. Nothing is downloaded — the pack is a local archive.

    async browseToolchainPack(): Promise<void> {
        this.browseError = null
        this.browseBusy = true
        try {
            const filePath = await this.pio.browseToolchainPack()
            if (!filePath) return // cancelled

            this.phase = 'seeding'
            this.progress = 20
            this.statusMessage = 'Installing toolchain pack...'

            const result = await this.pio.importToolchainPack(filePath)
            if (!result.success) throw new Error(result.error ?? 'Toolchain pack import failed')
            this.progress = 100
            this.markReady()
        } catch (err) {
            // Return to the prompt so the user can try again
            this.browseError = (err as Error).message
            this.phase = 'toolchain-prompt'
        } finally {
            this.browseBusy = false
        }
    }

    skipToolchainPack(): void {
        this.markReady()
    }

    // ── error card ───────────────────────────────────────────────────────────

    async retry(): Promise<void> {
        await this.checkAndSetup()
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private markReady(toolchainReady = true): void {
        this.phase = 'ready'
        this.state.toolchainReady = toolchainReady
        this.router.load('home')
    }
}
