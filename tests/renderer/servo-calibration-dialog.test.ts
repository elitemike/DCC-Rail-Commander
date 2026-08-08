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
    defaultState: 'CLOSED',
}

function makeDialog(turnout: ServoTurnout = BASE_TURNOUT) {
    const dialog = Object.create(ServoCalibrationDialog.prototype) as ServoCalibrationDialog

    const dialogOk = vi.fn()
    const dialogCancel = vi.fn()

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
        _prevLow: Math.min(turnout.inactiveAngle, turnout.activeAngle),
        _prevHigh: Math.max(turnout.inactiveAngle, turnout.activeAngle),
        sfSlider: undefined,
        sfClosedNum: undefined,
        sfThrownNum: undefined,
    })

    return { dialog, dialogOk, dialogCancel }
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

    it('does not send a live move', async () => {
        const { dialog } = makeDialog()

        dialog.swap()
        await Promise.resolve()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).not.toHaveBeenCalled()
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

// ── Slider drag (private _onSliderChange) — coarse positioning only ─────────
// Accessed via a loosely-typed alias since these are private implementation
// details, exercised the same way the public drag interaction would trigger them.

describe('ServoCalibrationDialog slider drag sync', () => {
    it('moving the low handle updates the field currently mapped to lowLabel', () => {
        const { dialog } = makeDialog()
        // BASE_TURNOUT: inactive(closed)=205 < active(thrown)=410, so lowLabel === 'closed'
        expect(dialog.lowLabel).toBe('closed')

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onSliderChange({ value: [150, 410] })

        expect(dialog.closedPosition).toBe(150)
        expect(dialog.thrownPosition).toBe(410)
    })

    it('moving the high handle updates the field mapped to the other end', () => {
        const { dialog } = makeDialog()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onSliderChange({ value: [205, 450] })

        expect(dialog.closedPosition).toBe(205)
        expect(dialog.thrownPosition).toBe(450)
    })

    it('respects lowLabel = thrown (post-swap) when mapping handles to fields', () => {
        const { dialog } = makeDialog()
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
    })

    it('never sends a live move, regardless of how far the handle moves', async () => {
        const { dialog } = makeDialog()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onSliderChange({ value: [0, 512] })
        await Promise.resolve()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).not.toHaveBeenCalled()
    })
})

// ── Numeric entry (private _onNumericChange) ─────────────────────────────────
// isStepperMove (3rd arg) mirrors what _isStepperEvent derives from the
// NumericTextBox change event: true for spin-button/arrow-key steps, false
// for typing a value directly.

describe('ServoCalibrationDialog numeric entry sync', () => {
    it('typing a closed value greater than thrown flips lowLabel and re-syncs the slider', () => {
        const { dialog } = makeDialog()
        const sfSlider = { value: [205, 410] as number[] }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any).sfSlider = sfSlider

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onNumericChange('closed', 460, false)

        expect(dialog.closedPosition).toBe(460)
        expect(dialog.thrownPosition).toBe(410)
        expect(dialog.lowLabel).toBe('thrown')
        expect(sfSlider.value).toEqual([410, 460])
    })

    it('typing a value directly (isStepperMove=false) does not send a live move', async () => {
        const { dialog } = makeDialog()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onNumericChange('closed', 260, false)
        await Promise.resolve()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).not.toHaveBeenCalled()
    })

    it('a stepper move (isStepperMove=true) sends an Instant live move to the new value', async () => {
        const { dialog } = makeDialog()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(dialog as any)._onNumericChange('closed', 206, true)
        await Promise.resolve()
        await Promise.resolve()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).toHaveBeenCalledWith('/dev/ttyACM1', '<D SERVO 25 206 0>\n')
    })
})

// ── _isStepperEvent ───────────────────────────────────────────────────────────

describe('ServoCalibrationDialog._isStepperEvent', () => {
    it('treats spin-button mousedown/mouseup as a stepper move', () => {
        const { dialog } = makeDialog()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isStepperEvent = (dialog as any)._isStepperEvent.bind(dialog)

        expect(isStepperEvent({ type: 'mousedown' })).toBe(true)
        expect(isStepperEvent({ type: 'mouseup' })).toBe(true)
    })

    it('treats a focused arrow-key keydown as a stepper move', () => {
        const { dialog } = makeDialog()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isStepperEvent = (dialog as any)._isStepperEvent.bind(dialog)

        expect(isStepperEvent({ type: 'keydown' })).toBe(true)
    })

    it('does not treat typing (native change event) as a stepper move', () => {
        const { dialog } = makeDialog()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isStepperEvent = (dialog as any)._isStepperEvent.bind(dialog)

        expect(isStepperEvent({ type: 'change' })).toBe(false)
    })

    it('does not treat a programmatic write (no event) as a stepper move', () => {
        const { dialog } = makeDialog()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isStepperEvent = (dialog as any)._isStepperEvent.bind(dialog)

        expect(isStepperEvent(undefined)).toBe(false)
    })
})

// ── Quick test-move triggers (Close / Mid / Throw) ───────────────────────────

describe('ServoCalibrationDialog test-move triggers', () => {
    it('midPosition rounds the average of closed and thrown', () => {
        const { dialog } = makeDialog()
        dialog.closedPosition = 205
        dialog.thrownPosition = 410
        expect(dialog.midPosition).toBe(308) // (205+410)/2 = 307.5 -> rounds to 308
    })

    it('canTestMove is true only when the port is connected', () => {
        const { dialog } = makeDialog()
        expect(dialog.canTestMove).toBe(true)

        dialog.portStatus = 'unavailable'
        expect(dialog.canTestMove).toBe(false)
    })

    it('testMove sends the position directly, using the selected profile', async () => {
        const { dialog } = makeDialog()
        // BASE_TURNOUT.profile is 'Slow' (numeric 3) — testMove must send that, not 'Instant'.

        dialog.testMove(dialog.midPosition)
        await Promise.resolve()
        await Promise.resolve()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).toHaveBeenCalledWith('/dev/ttyACM1', '<D SERVO 25 308 3>\n')
    })

    it('testMove reflects a changed profile selection', async () => {
        const { dialog } = makeDialog()
        dialog.profile = 'Bounce'

        dialog.testMove(dialog.closedPosition)
        await Promise.resolve()
        await Promise.resolve()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).toHaveBeenCalledWith('/dev/ttyACM1', '<D SERVO 25 205 4>\n')
    })

    it('stepper moves still send Instant regardless of the selected profile', async () => {
        const { dialog } = makeDialog()
        dialog.profile = 'Bounce'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (dialog as any)._sendLiveMove(300)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>
        expect(usbWrite).toHaveBeenCalledWith('/dev/ttyACM1', '<D SERVO 25 300 0>\n')
    })

    it('testMove is a no-op when the port is not connected', () => {
        const { dialog } = makeDialog()
        dialog.portStatus = 'unavailable'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usbWrite = (dialog as any).usb.write as ReturnType<typeof vi.fn>

        dialog.testMove(dialog.midPosition)

        expect(usbWrite).not.toHaveBeenCalled()
    })
})
