import { describe, it, expect, vi } from 'vitest'
import { ServoCalibrationDialog } from '../../src/renderer/src/components/dialogs/servo-calibration-dialog'
import type { ServoTurnout } from '../../src/renderer/src/utils/myAutomationParser'

// ── Factory ───────────────────────────────────────────────────────────────────
// Built like tests/renderer/turnout-editor.test.ts: a bare prototype instance
// with fields assigned manually, avoiding a full Aurelia DI bootstrap.

const BASE_TURNOUT: ServoTurnout = {
    type: 'SERVO',
    id: 200,
    pin: 25,
    activeAngle: 410,
    inactiveAngle: 205,
    profile: 'Slow',
    description: 'Main Line Junction',
    defaultState: 'NORMAL',
}

function makeDialog(turnout: ServoTurnout = BASE_TURNOUT) {
    const dialog = Object.create(ServoCalibrationDialog.prototype) as ServoCalibrationDialog

    const dialogOk = vi.fn()
    const dialogCancel = vi.fn()
    const closedDebouncerCall = vi.fn()
    const thrownDebouncerCall = vi.fn()

    Object.assign(dialog, {
        $dialog: { ok: dialogOk, cancel: dialogCancel },
        usb: { openPort: vi.fn(), write: vi.fn(), closePort: vi.fn(), isPortOpen: vi.fn().mockResolvedValue(false) },
        turnout: { ...turnout },
        devicePort: '/dev/ttyACM1',
        closedPosition: turnout.inactiveAngle,
        thrownPosition: turnout.activeAngle,
        lowLabel: turnout.inactiveAngle <= turnout.activeAngle ? 'closed' : 'thrown',
        profile: turnout.profile,
        errorMessage: '',
        sendError: null,
        portStatus: 'connected',
        portOpenedByUs: false,
        liveUpdateEnabled: true,
        hasPendingMove: false,
        _pendingMove: null,
        _prevLow: Math.min(turnout.inactiveAngle, turnout.activeAngle),
        _prevHigh: Math.max(turnout.inactiveAngle, turnout.activeAngle),
        sfSlider: undefined,
        sfClosedNum: undefined,
        sfThrownNum: undefined,
        _closedDebouncer: { call: closedDebouncerCall, cancel: vi.fn() },
        _thrownDebouncer: { call: thrownDebouncerCall, cancel: vi.fn() },
    })

    return { dialog, dialogOk, dialogCancel, closedDebouncerCall, thrownDebouncerCall }
}

// ── swap() ────────────────────────────────────────────────────────────────────

describe('ServoCalibrationDialog.swap', () => {
    it('exchanges the closed and thrown values and flips lowLabel', () => {
        const { dialog } = makeDialog()

        dialog.swap()

        expect(dialog.closedPosition).toBe(410)
        expect(dialog.thrownPosition).toBe(205)
        expect(dialog.lowLabel).toBe('thrown')
    })

    it('does not queue a live move command', () => {
        const { dialog, closedDebouncerCall, thrownDebouncerCall } = makeDialog()

        dialog.swap()

        expect(closedDebouncerCall).not.toHaveBeenCalled()
        expect(thrownDebouncerCall).not.toHaveBeenCalled()
    })

    it('swapping twice restores the original values', () => {
        const { dialog } = makeDialog()

        dialog.swap()
        dialog.swap()

        expect(dialog.closedPosition).toBe(205)
        expect(dialog.thrownPosition).toBe(410)
        expect(dialog.lowLabel).toBe('closed')
    })
})

// ── save() ────────────────────────────────────────────────────────────────────

describe('ServoCalibrationDialog.save', () => {
    it('maps thrownPosition -> activeAngle and closedPosition -> inactiveAngle (not inverted)', () => {
        const { dialog, dialogOk } = makeDialog()
        dialog.closedPosition = 150
        dialog.thrownPosition = 460
        dialog.profile = 'Fast'

        dialog.save()

        expect(dialogOk).toHaveBeenCalledOnce()
        expect(dialogOk).toHaveBeenCalledWith({ activeAngle: 460, inactiveAngle: 150, profile: 'Fast' })
    })

    it('blocks $dialog.ok when closedPosition is out of range', () => {
        const { dialog, dialogOk } = makeDialog()
        dialog.closedPosition = 600

        dialog.save()

        expect(dialogOk).not.toHaveBeenCalled()
        expect(dialog.errorMessage).toMatch(/between/i)
    })

    it('blocks $dialog.ok when thrownPosition is out of range', () => {
        const { dialog, dialogOk } = makeDialog()
        dialog.thrownPosition = -10

        dialog.save()

        expect(dialogOk).not.toHaveBeenCalled()
        expect(dialog.errorMessage).toMatch(/between/i)
    })
})

// ── cancel() ──────────────────────────────────────────────────────────────────

describe('ServoCalibrationDialog.cancel', () => {
    it('calls $dialog.cancel and not $dialog.ok', () => {
        const { dialog, dialogCancel, dialogOk } = makeDialog()

        dialog.cancel()

        expect(dialogCancel).toHaveBeenCalledOnce()
        expect(dialogOk).not.toHaveBeenCalled()
    })
})

// ── Slider <-> field sync (private _onSliderChange) ─────────────────────────
// Accessed via a loosely-typed alias since these are private implementation
// details, exercised the same way the public drag interaction would trigger them.

describe('ServoCalibrationDialog slider drag sync', () => {
    it('moving the low handle updates the field currently mapped to lowLabel', () => {
        const { dialog, closedDebouncerCall, thrownDebouncerCall } = makeDialog()
        // BASE_TURNOUT: inactive(closed)=205 < active(thrown)=410, so lowLabel === 'closed'
        expect(dialog.lowLabel).toBe('closed')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onSliderChange({ value: [150, 410] })

        expect(dialog.closedPosition).toBe(150)
        expect(dialog.thrownPosition).toBe(410)
        expect(closedDebouncerCall).toHaveBeenCalledWith(150)
        expect(thrownDebouncerCall).not.toHaveBeenCalled()
    })

    it('moving the high handle updates the field mapped to the other end', () => {
        const { dialog, closedDebouncerCall, thrownDebouncerCall } = makeDialog()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onSliderChange({ value: [205, 450] })

        expect(dialog.closedPosition).toBe(205)
        expect(dialog.thrownPosition).toBe(450)
        expect(thrownDebouncerCall).toHaveBeenCalledWith(450)
        expect(closedDebouncerCall).not.toHaveBeenCalled()
    })

    it('respects lowLabel = thrown (post-swap) when mapping handles to fields', () => {
        const { dialog, closedDebouncerCall, thrownDebouncerCall } = makeDialog()
        dialog.swap() // closed=410, thrown=205, lowLabel='thrown'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._prevLow = 205
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._prevHigh = 410

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onSliderChange({ value: [150, 410] })

        // Low handle now represents 'thrown' since lowLabel flipped after swap.
        expect(dialog.thrownPosition).toBe(150)
        expect(dialog.closedPosition).toBe(410)
        expect(thrownDebouncerCall).toHaveBeenCalledWith(150)
        expect(closedDebouncerCall).not.toHaveBeenCalled()
    })
})

// ── Numeric entry can invert ordering (private _onNumericChange) ────────────

describe('ServoCalibrationDialog numeric entry sync', () => {
    it('typing a closed value greater than thrown flips lowLabel and re-syncs the slider', () => {
        const { dialog } = makeDialog()
        const sfSlider = { value: [205, 410] as number[] }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).sfSlider = sfSlider

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onNumericChange('closed', 460)

        expect(dialog.closedPosition).toBe(460)
        expect(dialog.thrownPosition).toBe(410)
        expect(dialog.lowLabel).toBe('thrown')
        expect(sfSlider.value).toEqual([410, 460])
    })
})

// ── Manual ("live update" off) move flow ─────────────────────────────────────

describe('ServoCalibrationDialog manual move flow', () => {
    it('defaults to live update enabled', () => {
        const { dialog } = makeDialog()
        expect(dialog.liveUpdateEnabled).toBe(true)
    })

    it('queues a change instead of sending it when live update is off', () => {
        const { dialog, closedDebouncerCall } = makeDialog()
        dialog.liveUpdateEnabled = false

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._debounceLiveMove('closed', 300)

        expect(closedDebouncerCall).not.toHaveBeenCalled()
        expect(dialog.hasPendingMove).toBe(true)
    })

    it('sendPendingMove writes the queued command and clears the pending flag', async () => {
        const { dialog } = makeDialog()
        dialog.liveUpdateEnabled = false

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._debounceLiveMove('thrown', 300)
        expect(dialog.hasPendingMove).toBe(true)

        dialog.sendPendingMove()
        expect(dialog.hasPendingMove).toBe(false)

        // _sendLiveMove is async (fire-and-forget from sendPendingMove) — flush microtasks.
        await Promise.resolve()
        await Promise.resolve()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).toHaveBeenCalledWith('/dev/ttyACM1', '<D SERVO 25 300 0>\n')
    })

    it('sendPendingMove is a no-op when nothing is queued', () => {
        const { dialog } = makeDialog()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>

        dialog.sendPendingMove()

        expect(usbWrite).not.toHaveBeenCalled()
        expect(dialog.hasPendingMove).toBe(false)
    })

    it('re-enabling live update flushes a queued change through the debouncer', () => {
        const { dialog, closedDebouncerCall } = makeDialog()
        dialog.liveUpdateEnabled = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._debounceLiveMove('closed', 300)
        expect(dialog.hasPendingMove).toBe(true)

        // Simulate the CheckBox's change handler flow.
        dialog.liveUpdateEnabled = true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pending = (dialog as any)._pendingMove
        if (pending) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(dialog as any)._pendingMove = null
            dialog.hasPendingMove = false
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(dialog as any)._debounceLiveMove(pending.field, pending.value)
        }

        expect(dialog.hasPendingMove).toBe(false)
        expect(closedDebouncerCall).toHaveBeenCalledWith(300)
    })
})
