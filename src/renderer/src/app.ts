import { IDialogService } from '@aurelia/dialog'
import { resolve } from 'aurelia'
import { route } from '@aurelia/router'
import { ConfigEditorState } from './models/config-editor-state'
import { UsbService } from './services/usb.service'
import { ThemeService } from './services/theme.service'
import { BlocklySoundsService } from './services/blockly-sounds.service'
import { EditorDefaultViewService } from './services/editor-default-view.service'

@route({
    routes: [
        { path: '', redirectTo: 'startup' },
        { path: 'startup', component: () => import('./views/startup'), title: 'Starting Up' },
        { path: 'home', component: () => import('./views/home'), title: 'Home' },
        { path: 'workspace', component: () => import('./views/workspace'), title: 'Workspace' },
    ],
})
export class App {
    private readonly configEditorState = resolve(ConfigEditorState)
    private readonly dialogService = resolve(IDialogService)
    private readonly usb = resolve(UsbService)
    readonly themeService = resolve(ThemeService)
    private readonly blocklySounds = resolve(BlocklySoundsService)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    private _unsubCloseRequested: (() => void) | null = null

    bound(): void {
        if (window.electronWindow) {
            this._unsubCloseRequested = window.electronWindow.onCloseRequested(() => {
                void this._handleCloseRequested()
            })
        }
        // Kick off the USB/serial-port scan as early as possible — not awaited,
        // since nothing here should block startup on it. UsbService.initialize()
        // is idempotent and caches its result, so by the time a device picker or
        // the servo calibration dialog calls it later, the scan (or its hotplug
        // subscriptions) is already in place instead of starting cold.
        void this.usb.initialize()
        // Not awaited for the same reason — index.html's inline bootstrap
        // script already applied the last-known theme from localStorage
        // before first paint, so this just reconciles it against the
        // authoritative (async) preference and wires up live switching.
        void this.themeService.init()
        void this.blocklySounds.init()
        void this.editorDefaultView.init()
    }

    unbinding(): void {
        this._unsubCloseRequested?.()
        this._unsubCloseRequested = null
    }

    private async _handleCloseRequested(): Promise<void> {
        if (!this.configEditorState.hasChanges) {
            await window.electronWindow.forceClose()
            return
        }

        let confirmed = false
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('./components/dialogs/confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
                model: {
                    title: 'Unsaved Changes',
                    message: 'You have unsaved configuration changes.',
                    detail: 'If you close now, your changes will be lost.',
                    confirmLabel: 'Discard & Close',
                    cancelLabel: 'Keep Editing',
                },
            })
            const result = await dialog.closed
            confirmed = result.status === 'ok'
        } catch {
            confirmed = window.confirm('You have unsaved changes. Close anyway?')
        }

        if (confirmed) {
            await window.electronWindow.forceClose()
        }
    }
}

