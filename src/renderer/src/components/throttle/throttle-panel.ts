import { resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { DropDownList } from '@syncfusion/ej2-dropdowns'
import { NumericTextBox } from '@syncfusion/ej2-inputs'
import { ThrottleService } from '../../services/throttle.service'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { RosterFunction } from '../../utils/myAutomationParser'

const EMPTY_FUNCTIONS: RosterFunction[] = []

const ADD_MODE_OPTIONS = [
    { text: 'Roster', value: 'roster' },
    { text: 'Address', value: 'address' },
] as const

export type ThrottlePanelTab = 'throttles' | 'turnoutsRoutes'

/**
 * Track power / E-Stop-All + "add throttle" controls, and the grid of
 * acquired throttle-cards. Only rendered by workspace.html while the
 * selected device is connected via serial.
 */
export class ThrottlePanelCustomElement {
    readonly throttleService = resolve(ThrottleService)
    private readonly configEditorState = resolve(ConfigEditorState)
    private readonly dialogService = resolve(IDialogService)

    readonly addModeOptions = ADD_MODE_OPTIONS
    addMode: 'roster' | 'address' = 'roster'
    selectedRosterAddress: number | null = null
    freeformAddress = 3
    /** Expands the whole panel (all acquired throttle cards) to fill the window — not any single card. */
    isFullscreen = false
    /** Purely local — switching tabs never touches isFullscreen, so it works without leaving full screen. */
    activeTab: ThrottlePanelTab = 'throttles'

    addModeEl!: HTMLInputElement
    rosterDropdownEl!: HTMLInputElement
    freeformAddressEl!: HTMLInputElement
    private sfAddMode?: DropDownList
    private sfRosterDropdown?: DropDownList
    private sfFreeformAddress?: NumericTextBox
    private unsubFullScreenChanged?: () => void

    /** Roster locos not already acquired — an acquired loco drops out of the picker until released. */
    get availableRosterOptions(): Array<{ text: string; value: number }> {
        const acquired = new Set(this.throttleService.throttles.map((t) => t.cab))
        return this.configEditorState.roster
            .filter((r) => !acquired.has(r.dccAddress))
            .map((r) => ({ text: `${r.name} (${r.dccAddress})`, value: r.dccAddress }))
    }

    /** Function list for the matched roster loco, or a stable empty array (never a fresh `[]` per call) so the bindable on throttle-card doesn't churn every digest cycle. */
    rosterFunctionsFor(cab: number): RosterFunction[] {
        return this.configEditorState.roster.find((r) => r.dccAddress === cab)?.functions ?? EMPTY_FUNCTIONS
    }

    isRosterLoco(cab: number): boolean {
        return this.configEditorState.roster.some((r) => r.dccAddress === cab)
    }

    attached(): void {
        this.throttleService.initialize()

        this.sfAddMode = new DropDownList({
            dataSource: [...this.addModeOptions],
            fields: { text: 'text', value: 'value' },
            value: this.addMode,
            change: (args) => {
                this.addMode = (args.value as 'roster' | 'address') ?? 'roster'
            },
        })
        this.sfAddMode.appendTo(this.addModeEl)

        this.sfRosterDropdown = new DropDownList({
            dataSource: this.availableRosterOptions,
            fields: { text: 'text', value: 'value' },
            placeholder: 'Select a roster loco…',
            // Refreshed lazily right before the popup opens (rather than
            // reactively) since an acquire/release happening elsewhere
            // (e.g. a throttle-card's own Release button) doesn't otherwise
            // notify this SF widget that its dataSource is stale.
            open: () => {
                if (this.sfRosterDropdown) this.sfRosterDropdown.dataSource = this.availableRosterOptions
            },
            change: (args) => {
                this.selectedRosterAddress = typeof args.value === 'number' ? args.value : null
            },
        })
        this.sfRosterDropdown.appendTo(this.rosterDropdownEl)

        this.sfFreeformAddress = new NumericTextBox({
            min: 1,
            max: 10293,
            format: 'n0',
            value: this.freeformAddress,
            change: (args) => {
                if (args.value != null) this.freeformAddress = args.value
            },
        })
        this.sfFreeformAddress.appendTo(this.freeformAddressEl)

        // Stay in sync if native full screen is exited via an OS-level
        // shortcut (Esc, the traffic-light button, F11) rather than our own
        // toggle button — otherwise the CSS overlay would keep showing while
        // the OS chrome has already come back.
        this.unsubFullScreenChanged = window.electronWindow?.onFullScreenChanged((value) => {
            this.isFullscreen = value
        })
    }

    detaching(): void {
        this.throttleService.dispose()
        this.sfAddMode?.destroy()
        this.sfAddMode = undefined
        this.sfRosterDropdown?.destroy()
        this.sfRosterDropdown = undefined
        this.sfFreeformAddress?.destroy()
        this.sfFreeformAddress = undefined
        this.unsubFullScreenChanged?.()
        this.unsubFullScreenChanged = undefined
        // Don't leave the OS window stuck in native full screen once the
        // panel itself is gone (e.g. the user switched to Configuration).
        if (this.isFullscreen) {
            this.isFullscreen = false
            void window.electronWindow?.setFullScreen(false)
        }
    }

    addSelected(): void {
        if (this.addMode === 'roster') {
            this.acquireFromRoster()
        } else {
            this.acquireFreeform()
        }
    }

    private acquireFromRoster(): void {
        if (this.selectedRosterAddress == null) return
        const entry = this.configEditorState.roster.find((r) => r.dccAddress === this.selectedRosterAddress)
        this.throttleService.acquire(this.selectedRosterAddress, entry?.name)
        this.selectedRosterAddress = null
        if (this.sfRosterDropdown) this.sfRosterDropdown.value = null
    }

    private acquireFreeform(): void {
        if (!this.freeformAddress || this.freeformAddress < 1) return
        this.throttleService.acquire(this.freeformAddress)
    }

    setTab(tab: ThrottlePanelTab): void {
        this.activeTab = tab
    }

    toggleFullscreen(): void {
        this.isFullscreen = !this.isFullscreen
        // Native full screen hides the OS title bar entirely — the CSS
        // overlay (isFullscreen) alone only fills the app's own content area.
        void window.electronWindow?.setFullScreen(this.isFullscreen)
    }

    powerOn(): void {
        this.throttleService.powerOn()
    }

    async powerOff(): Promise<void> {
        const confirmed = await this._confirm(
            'Power Off Track',
            'Cut track power? Every loco on the layout will stop immediately.',
        )
        if (!confirmed) return
        this.throttleService.powerOff()
    }

    emergencyStopAll(): void {
        this.throttleService.emergencyStopAll()
    }

    /** Single button bound to the actual track-power state — turns power on directly, or off (with confirmation) if it's currently on. */
    async togglePower(): Promise<void> {
        if (this.throttleService.trackPower === true) {
            await this.powerOff()
        } else {
            this.powerOn()
        }
    }

    private async _confirm(title: string, message: string): Promise<boolean> {
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('../dialogs/confirm-dialog').then((m) => m.ConfirmDialog).catch(() => null),
                model: { title, message, confirmLabel: 'Power Off', confirmClass: 'bg-red-600 hover:bg-red-500' },
            })
            const result = await dialog.closed
            return (result as { status: string }).status === 'ok'
        } catch {
            return window.confirm(`${title}\n\n${message}`)
        }
    }
}
