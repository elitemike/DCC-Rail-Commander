import { describe, it, expect, vi } from 'vitest'
import { TurnoutCloneDialog } from '../../src/renderer/src/components/dialogs/turnout-clone-dialog'
import type { TurnoutCloneModel } from '../../src/renderer/src/components/dialogs/turnout-clone-dialog'

function makeDialog(model: Partial<TurnoutCloneModel> = {}) {
    const dialog = Object.create(TurnoutCloneDialog.prototype) as TurnoutCloneDialog
    const $dialog = { ok: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) }
    Object.assign(dialog, { $dialog, errorMessage: '', hidden: true, profile: 'Instant' })
    dialog.activate({ sourceType: 'SERVO', suggestedId: 8, takenIds: [6, 7], ...model })
    return { dialog, $dialog }
}

describe('TurnoutCloneDialog', () => {
    it('defaults to the suggested ID, hidden, and the Instant profile', () => {
        const { dialog } = makeDialog()
        expect(dialog.id).toBe(8)
        expect(dialog.hidden).toBe(true)
        expect(dialog.profile).toBe('Instant')
    })

    it('shows the profile choice only for servo sources', () => {
        expect(makeDialog({ sourceType: 'SERVO' }).dialog.isServo).toBe(true)
        expect(makeDialog({ sourceType: 'DCC' }).dialog.isServo).toBe(false)
        expect(makeDialog({ sourceType: 'VIRTUAL' }).dialog.isServo).toBe(false)
    })

    it('ok() returns the chosen ID, hidden flag and profile', () => {
        const { dialog, $dialog } = makeDialog()
        dialog.id = 20
        dialog.hidden = false
        dialog.profile = 'Slow'

        dialog.ok()

        expect($dialog.ok).toHaveBeenCalledWith({ id: 20, hidden: false, profile: 'Slow' })
    })

    it('ok() accepts the ID as a numeric string, as a bound number input may deliver it', () => {
        const { dialog, $dialog } = makeDialog()
        ;(dialog as unknown as { id: unknown }).id = '21'

        dialog.ok()

        expect($dialog.ok).toHaveBeenCalledWith(expect.objectContaining({ id: 21 }))
    })

    it('ok() rejects an ID that is already in use and stays open', () => {
        const { dialog, $dialog } = makeDialog()
        dialog.id = 7

        dialog.ok()

        expect($dialog.ok).not.toHaveBeenCalled()
        expect(dialog.errorMessage).toContain('ID 7')
    })

    it.each([-1, 1.5, NaN])('ok() rejects the invalid ID %s', bad => {
        const { dialog, $dialog } = makeDialog()
        dialog.id = bad

        dialog.ok()

        expect($dialog.ok).not.toHaveBeenCalled()
        expect(dialog.errorMessage).not.toBe('')
    })

    it('cancel() cancels the dialog', () => {
        const { dialog, $dialog } = makeDialog()
        dialog.cancel()
        expect($dialog.cancel).toHaveBeenCalled()
    })
})
