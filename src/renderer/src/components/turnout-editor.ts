import { IObserverLocator, queueTask, resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../models/config-editor-state'
import type { Turnout, ServoTurnout, TurnoutProfile, TurnoutDefaultState } from '../utils/myAutomationParser'
import { commentInvalidTurnoutLines } from '../utils/myAutomationParser'
import { ToastService } from '../services/toast.service'

type ViewTab = 'visual' | 'raw'

export class TurnoutEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)
    private readonly observerLocator = resolve(IObserverLocator)
    private splitterObj: Splitter | null = null

    private readonly _aliasSubscriber = {
        handleChange: () => {
            if (this.editBuffer !== null) {
                this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.id)
            }
        },
    }

    readonly profiles: TurnoutProfile[] = ['Instant', 'Fast', 'Medium', 'Slow', 'Bounce']
    readonly defaultStates: TurnoutDefaultState[] = ['NORMAL', 'THROWN']

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
        // Refresh alias display in case aliases changed while this editor was inactive
        if (this.editBuffer !== null) {
            this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.id)
        }
        this.observerLocator.getObserver(this.state, 'aliases').subscribe(this._aliasSubscriber)
        queueTask(() => {
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
        this.observerLocator.getObserver(this.state, 'aliases').unsubscribe(this._aliasSubscriber)
        if (this.activeTab === 'raw') {
            const text = this.rawEditor?.flush() ?? this._rawText
            this._processRawLeave(text)
        } else if (this.editBuffer !== null) {
            this.commitBuffer()
        }
        this.splitterObj?.destroy()
        this.splitterObj = null
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
    warningMessage = ''

    get turnouts(): Turnout[] {
        return this.state.turnouts
    }

    private _setBuffer(index: number, entry: Turnout): void {
        this.editBufferIndex = index
        this.editBuffer = { ...entry }
        this.aliasInput = this.state.getPrimaryAliasNameForId(entry.id)
        this.errorMessage = ''
        this.warningMessage = this.state.getCrossTypeIdWarning?.(entry.id, 'Turnout') ?? ''
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
        this.warningMessage = ''
    }

    commitBuffer(): void {
        if (this.editBuffer === null || this.editBufferIndex === null) return
        const existing = this.state.turnouts?.[this.editBufferIndex]
        const existingAliasName = existing ? this.state.getPrimaryAliasNameForId(existing.id) : ''
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
                this.warningMessage = this.state.getCrossTypeIdWarning?.(this.editBuffer.id, 'Turnout') ?? ''
                return
            }
        }
        this.errorMessage = ''
        this.warningMessage = this.state.getCrossTypeIdWarning?.(this.editBuffer.id, 'Turnout') ?? ''
    }

    // ── Field blur handlers (commit on leave) ─────────────────────────────────
    onFieldBlur(): void {
        if (this.editBuffer) {
            this.warningMessage = this.state.getCrossTypeIdWarning?.(this.editBuffer.id, 'Turnout') ?? ''
        }
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
            defaultState: 'NORMAL',
        }
        this.state.addTurnoutEntry(newEntry)
        const idx = this.state.turnouts.length - 1
        this._setBuffer(idx, this.state.turnouts[idx])
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

    private async _confirm(title: string, message: string): Promise<boolean> {
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('./confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
                model: { title, message },
            })
            const result = await dialog.closed
            return result.status === 'ok'
        } catch {
            return window.confirm(`${title}\n\n${message}`)
        }
    }
}
