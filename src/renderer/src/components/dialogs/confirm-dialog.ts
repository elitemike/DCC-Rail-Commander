import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { resolve } from 'aurelia'

interface ConfirmDialogModel {
    title: string
    message: string
    detail?: string
    confirmLabel?: string
    cancelLabel?: string
    confirmClass?: string
}

export class ConfirmDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    title = ''
    message = ''
    detail = ''
    confirmLabel = 'Delete'
    cancelLabel = 'Cancel'
    confirmClass = 'bg-red-600 hover:bg-red-500'

    activate(model: ConfirmDialogModel): void {
        this.title = model.title
        this.message = model.message
        this.detail = model.detail ?? ''
        this.confirmLabel = model.confirmLabel ?? 'Delete'
        this.cancelLabel = model.cancelLabel ?? 'Cancel'
        this.confirmClass = model.confirmClass ?? 'bg-red-600 hover:bg-red-500'
    }

    ok(): void {
        void this.$dialog.ok()
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
