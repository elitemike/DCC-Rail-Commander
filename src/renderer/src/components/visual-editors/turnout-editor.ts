import { IObserverLocator, queueTask, resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ComboBox, type ChangeEventArgs } from '@syncfusion/ej2-dropdowns'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import type { Turnout, ServoTurnout, TurnoutProfile, TurnoutDefaultState } from '../../utils/myAutomationParser'
import { commentInvalidTurnoutLines } from '../../utils/myAutomationParser'
import { ToastService } from '../../services/toast.service'
import type { ServoCalibrationResult } from '../dialogs/servo-calibration-dialog'

type ViewTab = 'visual' | 'raw'

export class TurnoutEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)
    private readonly observerLocator = resolve(IObserverLocator)
    private splitterObj: Splitter | null = null
    /** Guards the queueTask() below — the component (or its #turnout-splitter, gated behind activeTab === 'visual') can be torn down before the deferred Splitter creation runs, which would otherwise append a live widget into a detached/stale element and leave a broken splitterObj for detaching() to (potentially) throw on. */
    private _detached = false

    /** Host `<input>` for the alias ComboBox — lives inside the `if.bind="editBuffer"` detail pane, so it only exists once a turnout is selected. Set via `ref` in the template. */
    aliasComboEl: HTMLInputElement | null = null
    private aliasCombo: ComboBox | null = null

    private readonly _aliasSubscriber = {
        handleChange: () => {
            if (this.editBuffer !== null) {
                this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.id, 'Turnout')
                // Deferred: this subscriber can fire synchronously from inside the alias
                // ComboBox's own `change` event (via commitBuffer -> syncAliasForId
                // mutating state.aliases), and refreshing the widget's dataSource/value
                // mid-event clobbers the selection it's still in the middle of applying.
                queueTask(() => {
                    if (this._detached) return
                    this._ensureAliasCombo()
                })
            }
        },
    }

    readonly profiles: TurnoutProfile[] = ['Instant', 'Fast', 'Medium', 'Slow', 'Bounce']
    readonly defaultStates: TurnoutDefaultState[] = ['CLOSED', 'THROWN']

    // ── View tabs ─────────────────────────────────────────────────────────────
    activeTab: ViewTab = 'visual'

    setTab(tab: ViewTab): void {
        if (tab === 'raw' && this.editBuffer !== null) {
            this.commitBuffer()
        }
        if (tab === 'visual' && this.activeTab === 'raw') {
            // flush() cancels the debounce and returns the live model text.
            // Fall back to _rawText (last text received via onRawChange) in case
            // rawEditor is somehow null (e.g. race during component teardown).
            const text = this.rawEditor?.flush() ?? this._rawText
            this._processRawLeave(text)
            if (this.editBufferIndex !== null) {
                const fresh = this.state.turnouts[this.editBufferIndex]
                if (fresh) this._setBuffer(this.editBufferIndex, fresh)
                else this.clearBuffer()
            }
        }
        if (tab === 'raw') {
            this.rawSnapshot = this.state.turnoutsRaw
            this._rawText = this.rawSnapshot
        }
        this.activeTab = tab
    }

    // ── Lifecycle ──────────────────────────────────────────────────────
    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles by default — reset the guard set by the previous
        // detaching() or the queued Splitter creation below would skip itself
        // forever after the first time this editor is left and revisited.
        this._detached = false
        // Refresh alias display in case aliases changed while this editor was inactive
        if (this.editBuffer !== null) {
            this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.id, 'Turnout')
        }
        this.observerLocator.getObserver(this.state, 'aliases').subscribe(this._aliasSubscriber)
        queueTask(() => {
            if (this._detached) return
            this._ensureAliasCombo()
            if (!document.getElementById('turnout-splitter')) return
            const savedWidth = this._loadSidebarWidth()
            this.splitterObj = new Splitter({
                paneSettings: [
                    { size: savedWidth, min: '200px', max: '600px' },
                    {},
                ],
                width: '100%',
                height: '100%',
                resizeStop: () => {
                    const pane = document.querySelector('#turnout-splitter > div:first-child') as HTMLElement
                    if (pane) this._saveSidebarWidth(`${pane.offsetWidth}px`)
                },
            })
            this.splitterObj.appendTo('#turnout-splitter')
        })
    }

    detaching(): void {
        this._detached = true
        this.observerLocator.getObserver(this.state, 'aliases').unsubscribe(this._aliasSubscriber)
        if (this.activeTab === 'raw') {
            const text = this.rawEditor?.flush() ?? this._rawText
            this._processRawLeave(text)
        } else if (this.editBuffer !== null) {
            this.commitBuffer()
        }
        // A Splitter left in a broken/partially-appended state (see the queueTask
        // guard above) must not be allowed to throw here — that would abort
        // Aurelia's own teardown of this component mid-sequence and leave its DOM
        // stuck in place instead of being removed.
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.splitterObj = null
        try { this.aliasCombo?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.aliasCombo = null
    }

    /**
     * Called whenever the user navigates away from raw mode.
     *
     * 1. Comments out any newly-invalid SERVO_TURNOUT lines and fires a toast.
     * 2. Persists ALL `// [INVALID]` lines (new + pre-existing) so they survive
     *    subsequent raw ↔ visual round-trips and don't silently disappear.
     */
    _processRawLeave(text: string): void {
        const { processedText, invalidLines } = commentInvalidTurnoutLines(text)

        // Must be set BEFORE setTurnoutsFromRaw so _syncToInstallerState (called
        // inside setTurnoutsFromRaw) reads the updated turnoutsRaw getter.
        const allInvalidComments = processedText
            .split('\n')
            .filter(l => l.trimStart().startsWith('// [INVALID]'))

        this.state.turnoutPreservedComments = allInvalidComments.join('\n')
        this.state.setTurnoutsFromRaw(processedText)

        // Toast only when NEW invalid lines are found on this pass.
        // Already-commented lines are not re-toasted on subsequent toggles.
        if (invalidLines.length > 0) {
            this.toastService.show({
                title: 'Invalid Lines Commented Out',
                content: `${invalidLines.length} invalid turnout line${invalidLines.length > 1 ? 's are' : ' is'} commented out to prevent data loss. Switch to Raw to review and fix.`,
                cssClass: 'e-toast-warning',
            })
        }
    }

    private _loadSidebarWidth(): string {
        try { return localStorage.getItem('turnout-editor-sidebar-width') ?? '256px' } catch { return '256px' }
    }
    private _saveSidebarWidth(size: string): void {
        try { localStorage.setItem('turnout-editor-sidebar-width', size) } catch { /* ignore */ }
    }

    // ── Raw snapshot for Monaco ───────────────────────────────────────────────
    rawEditor: { flush(): string } | null = null
    rawSnapshot = ''
    /** Last text received from Monaco (via onRawChange or on raw-tab entry). */
    private _rawText = ''

    // Arrow function so it can be passed as a bindable callback without losing `this`.
    onRawChange = (text: string): void => {
        this._rawText = text
        this.state.setTurnoutsFromRaw(text)
        if (this.editBufferIndex !== null) {
            const fresh = this.state.turnouts[this.editBufferIndex]
            if (fresh) this._setBuffer(this.editBufferIndex, fresh)
            else this.clearBuffer()
        }
    }

    // ── Selection / edit buffer ───────────────────────────────────────────────
    editBuffer: Turnout | null = null
    editBufferIndex: number | null = null
    aliasInput = ''
    errorMessage = ''

    get turnouts(): Turnout[] {
        return this.state.turnouts
    }

    private _setBuffer(index: number, entry: Turnout): void {
        this.editBufferIndex = index
        this.editBuffer = { ...entry }
        this.aliasInput = this.state.getPrimaryAliasNameForId(entry.id, 'Turnout')
        this.errorMessage = ''
        // The detail pane (and its alias ComboBox host element) may not exist in
        // the DOM yet — e.g. first selection after the editor mounts with nothing
        // selected — so defer to the next task like the Splitter setup above.
        queueTask(() => {
            if (this._detached) return
            this._ensureAliasCombo()
        })
    }

    selectEntry(entry: Turnout): void {
        if (this.editBuffer !== null) this.commitBuffer()
        const idx = this.state.turnouts.indexOf(entry)
        if (idx !== -1) this._setBuffer(idx, entry)
    }

    clearBuffer(): void {
        this.editBuffer = null
        this.editBufferIndex = null
        this.aliasInput = ''
        this.errorMessage = ''
        try { this.aliasCombo?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.aliasCombo = null
    }

    /** Alias names already defined for turnouts (or untyped, so still assignable) — offered as ComboBox suggestions. */
    private _aliasOptions(): string[] {
        return this.state.aliases
            .filter(a => !a.aliasType || a.aliasType === 'Turnout')
            .map(a => a.name)
    }

    /** Creates the alias ComboBox on first mount of the detail pane, or refreshes its options/value on later calls. */
    private _ensureAliasCombo(): void {
        if (this._detached || !this.aliasComboEl) return
        if (!this.aliasCombo) {
            this.aliasCombo = new ComboBox({
                dataSource: this._aliasOptions(),
                value: this.aliasInput || null,
                allowCustom: true,
                placeholder: 'Optional alias from myAliases.h',
                change: (args: ChangeEventArgs) => {
                    this.aliasInput = (args.value as string | null) ?? ''
                    this.commitBuffer()
                },
                blur: () => this.onAliasBlur(),
            })
            this.aliasCombo.appendTo(this.aliasComboEl)
            return
        }
        this.aliasCombo.dataSource = this._aliasOptions()
        this.aliasCombo.refresh()
        if (this.aliasCombo.value !== (this.aliasInput || null)) {
            this.aliasCombo.value = this.aliasInput || null
        }
    }

    /**
     * `value.bind` on `<input type="number">` round-trips through the DOM's `.value`,
     * which is always a string — so id/pin/angle/addr fields land back in `editBuffer`
     * as strings after any edit. Left uncoerced, strict-equality lookups elsewhere
     * (alias type resolution, EXRAIL reference validation) silently fail to match a
     * numeric target and can resolve to the wrong object type.
     */
    private _coerceNumericFields(t: Turnout): Turnout {
        const id = Number(t.id)
        if (t.type === 'SERVO') {
            return { ...t, id, pin: Number(t.pin), activeAngle: Number(t.activeAngle), inactiveAngle: Number(t.inactiveAngle) }
        }
        if (t.type === 'DCC') {
            return { ...t, id, addr: Number(t.addr), subAddr: Number(t.subAddr) }
        }
        return { ...t, id, pin: Number(t.pin) }
    }

    commitBuffer(): void {
        if (this.editBuffer === null || this.editBufferIndex === null) return
        this.editBuffer = this._coerceNumericFields(this.editBuffer)
        const conflict = this.state.turnouts?.find(
            (t, i) => i !== this.editBufferIndex && t.id === this.editBuffer!.id,
        )
        if (conflict) {
            this.errorMessage = `Turnout ID ${this.editBuffer.id} is already used by "${this.getDisplayName(conflict)}".`
            return
        }
        const existing = this.state.turnouts?.[this.editBufferIndex]
        const existingAliasName = existing ? this.state.getPrimaryAliasNameForId(existing.id, 'Turnout') : ''
        const aliasChanged = !!existing && (existing.id !== this.editBuffer.id || existingAliasName !== this.aliasInput.trim())
        this.state.updateTurnoutEntry(this.editBufferIndex, { ...this.editBuffer })
        if (existing && (aliasChanged || this.aliasInput.trim() !== '')) {
            const aliasResult = this.state.syncAliasForId(
                existing.id,
                this.editBuffer.id,
                this.aliasInput,
                'Turnout',
                existingAliasName,
            )
            if (!aliasResult.ok) {
                this.errorMessage = aliasResult.reason
                return
            }
        }
        this.errorMessage = ''
    }

    // ── Field blur handlers (commit on leave) ─────────────────────────────────
    onFieldBlur(): void {
        this.commitBuffer()
    }

    onAliasBlur(): void {
        this.commitBuffer()
    }

    updateProfile(profile: TurnoutProfile): void {
        if (!this.editBuffer || this.editBuffer.type !== 'SERVO') return
        this.editBuffer.profile = profile
        this.commitBuffer()
    }

    updateDefaultState(defaultState: TurnoutDefaultState): void {
        if (!this.editBuffer) return
        this.editBuffer.defaultState = defaultState
        this.commitBuffer()
    }

    // ── Add / remove entries ──────────────────────────────────────────────────
    addEntry(): void {
        if (this.editBuffer !== null) this.commitBuffer()
        const ts = this.state.turnouts
        const maxId = ts.length > 0 ? Math.max(...ts.map(t => t.id)) + 1 : 200
        const servoEntries = ts.filter((t): t is ServoTurnout => t.type === 'SERVO')
        const maxPin = servoEntries.length > 0 ? Math.max(...servoEntries.map(t => t.pin)) + 1 : 101
        const newEntry: Turnout = {
            type: 'SERVO',
            id: maxId,
            pin: maxPin,
            activeAngle: 400,
            inactiveAngle: 100,
            profile: 'Slow',
            description: 'New Turnout',
            comment: '',
            defaultState: 'CLOSED',
        }
        this.state.addTurnoutEntry(newEntry)
        const idx = this.state.turnouts.length - 1
        this._setBuffer(idx, this.state.turnouts[idx])
        // New entries are always SERVO — jump straight into calibration so
        // the user can set a sensible position before doing anything else.
        void this.openServoCalibration()
    }

    async removeEntryByIndex(index: number, event?: Event): Promise<void> {
        event?.stopPropagation()
        const entry = this.state.turnouts[index]
        const name = this.getDisplayName(entry)
        const confirmed = await this._confirm(`Delete "${name}"?`, `Are you sure you want to remove this turnout?`)
        if (!confirmed) return
        if (this.editBufferIndex === index) this.clearBuffer()
        else if (this.editBufferIndex !== null && this.editBufferIndex > index) {
            this.editBufferIndex--
        }
        this.state.removeTurnoutEntry(index)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    getDisplayName(t: Turnout): string {
        return t.description ? `${t.description} (${t.id})` : `Turnout ${t.id}`
    }

    profileColor(profile: TurnoutProfile): string {
        const map: Record<TurnoutProfile, string> = {
            Instant: 'bg-red-500',
            Fast: 'bg-amber-500',
            Medium: 'bg-blue-500',
            Slow: 'bg-green-500',
            Bounce: 'bg-purple-500',
        }
        return map[profile] ?? 'bg-gray-500'
    }

    get selectedIndex(): number | null {
        return this.editBufferIndex
    }

    async openServoCalibration(): Promise<void> {
        if (!this.editBuffer || this.editBuffer.type !== 'SERVO' || this.editBufferIndex === null) return
        const turnout = this.editBuffer as ServoTurnout
        const index = this.editBufferIndex
        const { dialog } = await this.dialogService.open({
            component: () =>
                import('../dialogs/servo-calibration-dialog').then(m => m.ServoCalibrationDialog).catch(() => null),
            model: { turnout: { ...turnout }, devicePort: this.installerState.selectedDevice?.port ?? null },
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return
        // Re-check after the await: the user may have selected a different
        // turnout (or deleted this one) while the dialog was open.
        if (!this.editBuffer || this.editBufferIndex !== index || this.editBuffer.type !== 'SERVO') return
        const updates = result.value as ServoCalibrationResult
        this.editBuffer = { ...this.editBuffer, ...updates }
        this.commitBuffer()
    }

    private async _confirm(title: string, message: string): Promise<boolean> {
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('../dialogs/confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
                model: { title, message },
            })
            const result = await dialog.closed
            return result.status === 'ok'
        } catch {
            return window.confirm(`${title}\n\n${message}`)
        }
    }
}
