import type { IDialogService } from '@aurelia/dialog'

/**
 * Shows the shared red "Delete" confirm dialog and resolves true only if the user confirms.
 * Every destructive × / trash button in the GUI goes through this so a stray click can't
 * silently drop an entry. Falls back to window.confirm if the dialog can't be opened.
 */
export async function confirmAction(
    dialogService: IDialogService,
    title: string,
    message: string,
    options: { confirmLabel?: string } = {},
): Promise<boolean> {
    try {
        const { dialog } = await dialogService.open({
            component: () =>
                import('../components/dialogs/confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
            model: { title, message, ...options },
        })
        const result = await dialog.closed
        return result.status === 'ok'
    } catch {
        return window.confirm(`${title}\n\n${message}`)
    }
}
