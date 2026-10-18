import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'

export interface TextInputModel {
    title: string
    label: string
    value?: string
    placeholder?: string
    confirmLabel?: string
    /** Returns an error message to keep the dialog open, or '' when the value is acceptable. */
    validate?: (value: string) => string
}

export interface TextInputResult {
    value: string
}

/** Small single-field prompt (Electron has no window.prompt) — used for naming/renaming folders. */
export class TextInputDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    title = ''
    label = ''
    placeholder = ''
    confirmLabel = 'OK'
    value = ''
    errorMessage = ''
    private validate?: (value: string) => string

    activate(model: TextInputModel): void {
        this.title = model.title
        this.label = model.label
        this.placeholder = model.placeholder ?? ''
        this.confirmLabel = model.confirmLabel ?? 'OK'
        this.value = model.value ?? ''
        this.validate = model.validate
    }

    clearError(): void {
        this.errorMessage = ''
    }

    ok(): void {
        const value = this.value.trim()
        const error = this.validate?.(value) ?? ''
        if (error) {
            this.errorMessage = error
            return
        }
        const result: TextInputResult = { value }
        void this.$dialog.ok(result)
    }

    onKeydown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter') { this.ok(); return false }
        return true
    }

    cancel(): void {
        void this.$dialog.cancel()
    }
}
