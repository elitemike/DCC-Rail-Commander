import { bindable, resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { Slider, NumericTextBox } from '@syncfusion/ej2-inputs'
import { Button } from '@syncfusion/ej2-buttons'
import { ThrottleService, type ThrottleCabState } from '../../services/throttle.service'
import type { RosterFunction } from '../../utils/myAutomationParser'
import { buildFunctionSlots, type ThrottleFunctionSlot } from '../../utils/throttle-function-slots'

interface FunctionButton {
    el: HTMLButtonElement
    widget: Button
    slot: ThrottleFunctionSlot
}

/**
 * One loco's controls: speed slider, direction, function grid. Purely a
 * view over ThrottleService — every control calls straight into the
 * service, no serial writing happens here.
 *
 * The function grid is built imperatively (rather than an Aurelia
 * `repeat.for` template) because it's a variable-length list of Syncfusion
 * `Button` widgets — CLAUDE.md's "build DOM manually" rule for cases SF
 * template strings/declarative binding can't cover applies here the same way
 * it does to TreeView's `drawNode` hook elsewhere in the app.
 */
export class ThrottleCardCustomElement {
    private readonly throttleService = resolve(ThrottleService)
    private readonly dialogService = resolve(IDialogService)

    @bindable cab!: ThrottleCabState
    /** Function list from the matched roster loco — empty when isRosterMatch is false (freeform address). */
    @bindable rosterFunctions: RosterFunction[] = []
    /** Whether `cab` corresponds to a roster loco — see buildFunctionSlots() for how this changes the function grid. */
    @bindable isRosterMatch = false

    functionSlots: ThrottleFunctionSlot[] = []
    private functionButtons: FunctionButton[] = []

    sliderEl!: HTMLElement
    speedStepperEl!: HTMLInputElement
    functionsContainerEl!: HTMLElement
    private sfSlider?: Slider
    private sfSpeedStepper?: NumericTextBox
    /** Polls for state that changed from outside this card's own controls (another card/throttle on the same cab, a device broadcast, or this card's own direction/Stop buttons) and pushes it into the SF widgets, which have no way to observe external mutation of `cab.speed`/`cab.functions`. Compares each widget's own displayed value rather than a single shared "last synced" flag, since they can go stale independently of each other. */
    private syncTimer?: ReturnType<typeof setInterval>

    binding(): void {
        this._rebuildFunctionSlots()
    }

    rosterFunctionsChanged(): void {
        this._rebuildFunctionSlots()
    }

    isRosterMatchChanged(): void {
        this._rebuildFunctionSlots()
    }

    private _rebuildFunctionSlots(): void {
        this.functionSlots = buildFunctionSlots(this.rosterFunctions, this.isRosterMatch)
        this._rebuildFunctionButtons()
    }

    attached(): void {
        this.sfSlider = new Slider({
            min: 0,
            max: 126,
            value: this.cab.speed,
            change: (args) => {
                if (typeof args.value === 'number') this.setSpeed(args.value)
            },
        })
        this.sfSlider.appendTo(this.sliderEl)

        // 128 speed-step mode (DCC-EX's own term — see <D SPEED128> in
        // NATIVE_COMMAND_DOCS) tops out at 126 usable speed values; the
        // stepper mirrors the slider's range exactly.
        this.sfSpeedStepper = new NumericTextBox({
            min: 0,
            max: 126,
            format: 'n0',
            value: this.cab.speed,
            change: (args) => {
                if (typeof args.value === 'number') this.setSpeed(args.value)
            },
        })
        this.sfSpeedStepper.appendTo(this.speedStepperEl)

        // functionSlots was already computed in binding(), but the function
        // grid's container didn't exist yet for _rebuildFunctionButtons() to
        // render into — build it now that attached() guarantees it does.
        this._rebuildFunctionButtons()

        this.syncTimer = setInterval(() => {
            if (this.sfSlider && this.sfSlider.value !== this.cab.speed) {
                this.sfSlider.value = this.cab.speed
                this.sfSlider.refresh()
            }
            if (this.sfSpeedStepper && this.sfSpeedStepper.value !== this.cab.speed) {
                this.sfSpeedStepper.value = this.cab.speed
            }
            for (const fb of this.functionButtons) {
                if (fb.slot.isMomentary) continue
                const shouldBeActive = !!this.cab.functions[fb.slot.index]
                if (fb.el.classList.contains('e-active') !== shouldBeActive) {
                    fb.el.classList.toggle('e-active', shouldBeActive)
                }
            }
        }, 200)
    }

    detaching(): void {
        if (this.syncTimer) clearInterval(this.syncTimer)
        this.sfSlider?.destroy()
        this.sfSlider = undefined
        this.sfSpeedStepper?.destroy()
        this.sfSpeedStepper = undefined
        this._destroyFunctionButtons()
    }

    private _destroyFunctionButtons(): void {
        for (const fb of this.functionButtons) {
            fb.widget.destroy()
            fb.el.remove()
        }
        this.functionButtons = []
    }

    private _rebuildFunctionButtons(): void {
        if (!this.functionsContainerEl) return // not attached yet — attached() calls this again once it is
        this._destroyFunctionButtons()
        for (const slot of this.functionSlots) {
            if (slot.disabled) continue
            const el = document.createElement('button')
            el.type = 'button'
            el.title = slot.label
            this.functionsContainerEl.appendChild(el)

            const widget = new Button({
                content: slot.label,
                // Latching functions get real SF toggle-button behaviour
                // (click flips them, state persists visually); momentary
                // functions are driven entirely by the pointerdown/up
                // handlers below instead.
                isToggle: !slot.isMomentary,
                cssClass: 'e-small throttle-fn-btn',
            })
            widget.appendTo(el)

            if (slot.isMomentary) {
                // Not an SF toggle — 'e-active' here is purely visual feedback
                // while the button is physically held down.
                el.addEventListener('pointerdown', () => {
                    el.classList.add('e-active')
                    this.pressFunction(slot)
                })
                el.addEventListener('pointerup', () => {
                    el.classList.remove('e-active')
                    this.releaseFunction(slot)
                })
                el.addEventListener('pointerleave', () => {
                    el.classList.remove('e-active')
                    this.releaseFunction(slot)
                })
            } else {
                if (this.cab.functions[slot.index]) el.classList.add('e-active')
                el.addEventListener('click', () => {
                    // SF's own click handling has already flipped 'e-active'
                    // by the time this listener runs, so it reflects the new
                    // desired state.
                    this.throttleService.setFunction(this.cab.cab, slot.index, el.classList.contains('e-active'))
                })
            }

            this.functionButtons.push({ el, widget, slot })
        }
    }

    setSpeed(speed: number): void {
        this.throttleService.setSpeed(this.cab.cab, speed, this.cab.direction)
    }

    setDirection(direction: 0 | 1): void {
        this.throttleService.setSpeed(this.cab.cab, this.cab.speed, direction)
    }

    stop(): void {
        this.setSpeed(0)
    }

    pressFunction(slot: ThrottleFunctionSlot): void {
        if (slot.disabled) return
        this.throttleService.setFunction(this.cab.cab, slot.index, true)
    }

    releaseFunction(slot: ThrottleFunctionSlot): void {
        if (slot.disabled) return
        this.throttleService.setFunction(this.cab.cab, slot.index, false)
    }

    async release(): Promise<void> {
        const confirmed = await this._confirm(
            'Release Throttle',
            `Stop controlling "${this.cab.name}" (Cab ${this.cab.cab})? This does not stop the loco — it keeps running at its current speed.`,
        )
        if (!confirmed) return
        this.throttleService.release(this.cab.cab)
    }

    private async _confirm(title: string, message: string): Promise<boolean> {
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('../dialogs/confirm-dialog').then((m) => m.ConfirmDialog).catch(() => null),
                // Releasing isn't destructive (the loco just keeps running,
                // and it can be re-added any time) — use the neutral action
                // color rather than ConfirmDialog's red "Delete" default.
                model: { title, message, confirmLabel: 'Release', confirmClass: 'bg-blue-600 hover:bg-blue-500' },
            })
            const result = await dialog.closed
            return (result as { status: string }).status === 'ok'
        } catch {
            return window.confirm(`${title}\n\n${message}`)
        }
    }
}
