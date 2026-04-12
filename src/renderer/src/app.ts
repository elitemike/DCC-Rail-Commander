import { IDialogService } from '@aurelia/dialog'
import { resolve } from 'aurelia'
import { route } from '@aurelia/router'
import { ConfigEditorState } from './models/config-editor-state'

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
    private _unsubCloseRequested: (() => void) | null = null

    bound(): void {
        if (window.electronWindow) {
            this._unsubCloseRequested = window.electronWindow.onCloseRequested(() => {
                void this._handleCloseRequested()
            })
        }
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

