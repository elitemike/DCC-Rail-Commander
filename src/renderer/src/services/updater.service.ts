import { resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import type { UpdateState } from '../../../types/ipc'
import { PreferencesService } from './preferences.service'
import { ConfigEditorState } from '../models/config-editor-state'

export const AUTO_CHECK_PREF = 'autoCheckForUpdates'
export const SKIPPED_VERSION_PREF = 'skippedUpdateVersion'

/** Long enough that the startup check never competes with the app's own first-load work. */
const STARTUP_CHECK_DELAY_MS = 5000

/**
 * Renderer side of app self-update. The main process owns the actual lifecycle (AppUpdaterService);
 * this mirrors its state for binding, runs the once-per-launch background check, and decides when
 * to put the update dialog (with release notes) in front of the user.
 */
export class UpdaterService {
    private readonly preferences = resolve(PreferencesService)
    private readonly dialogService = resolve(IDialogService)
    private readonly configEditorState = resolve(ConfigEditorState)

    state: UpdateState = { status: 'unsupported' }
    readonly appVersion = __APP_VERSION__
    autoCheck = true

    private dialogOpen = false
    private unsubscribe: (() => void) | null = null

    get isSupported(): boolean {
        return this.state.status !== 'unsupported'
    }

    /** Call once at startup. Schedules the background check unless the user turned it off. */
    async init(): Promise<void> {
        if (!window.updater || this.unsubscribe) return
        this.unsubscribe = window.updater.onStateChanged((state) => {
            this.state = state
        })
        const [state, autoCheck] = await Promise.all([
            window.updater.getState(),
            this.preferences.get<boolean | undefined>(AUTO_CHECK_PREF),
        ])
        this.state = state
        this.autoCheck = autoCheck !== false
        if (this.isSupported && this.autoCheck) {
            setTimeout(() => void this.checkInBackground(), STARTUP_CHECK_DELAY_MS)
        }
    }

    /**
     * Startup check: silent unless there's an update the user hasn't chosen to skip. Being offline
     * is normal for this app (see TOOLCHAIN.md), so a failed check is never surfaced here.
     */
    private async checkInBackground(): Promise<void> {
        const result = await window.updater.check()
        if (result.status !== 'available') return
        const skipped = await this.preferences.get<string | undefined>(SKIPPED_VERSION_PREF)
        if (skipped === result.update.version) return
        await this.showUpdateDialog()
    }

    /** User-initiated check (Settings). Ignores a skipped version — asking explicitly means they want to know. */
    async checkNow(): Promise<void> {
        const result = await window.updater.check()
        if (result.status === 'available' || result.status === 'downloading' || result.status === 'downloaded') {
            await this.showUpdateDialog()
        }
    }

    async setAutoCheck(enabled: boolean): Promise<void> {
        this.autoCheck = enabled
        await this.preferences.set(AUTO_CHECK_PREF, enabled)
    }

    /** Stops the startup check from prompting about this version again. A newer release still prompts. */
    async skipVersion(version: string): Promise<void> {
        await this.preferences.set(SKIPPED_VERSION_PREF, version)
    }

    download(): Promise<void> {
        return window.updater.download()
    }

    /**
     * Installing quits the app, so unsaved configuration changes get the same prompt as closing
     * the window. Returns false if the user backed out.
     */
    async installAndRestart(): Promise<boolean> {
        if (this.configEditorState.hasChanges) {
            const { dialog } = await this.dialogService.open({
                component: () => import('../components/dialogs/confirm-dialog').then((m) => m.ConfirmDialog),
                model: {
                    title: 'Unsaved Changes',
                    message: 'You have unsaved configuration changes.',
                    detail: 'Installing the update restarts the app, and your changes will be lost. Save first if you want to keep them.',
                    confirmLabel: 'Discard & Restart',
                    cancelLabel: 'Keep Editing',
                },
            })
            const result = await dialog.closed
            if (result.status !== 'ok') return false
        }
        await window.updater.install()
        return true
    }

    async showUpdateDialog(): Promise<void> {
        if (this.dialogOpen) return
        this.dialogOpen = true
        try {
            const { dialog } = await this.dialogService.open({
                component: () => import('../components/dialogs/update-dialog').then((m) => m.UpdateDialog),
            })
            await dialog.closed
        } finally {
            this.dialogOpen = false
        }
    }
}
