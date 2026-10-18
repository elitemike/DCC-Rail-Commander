import { IObserverLocator, queueTask, resolve } from 'aurelia'
import { loadTreeWidth, saveTreeWidth } from '../../utils/tree-width'
import { IDialogService } from '@aurelia/dialog'
import { TreeView, ContextMenu } from '@syncfusion/ej2-navigations'
import type { BeforeOpenCloseMenuEventArgs, MenuEventArgs, NodeSelectEventArgs, DrawNodeEventArgs, DragAndDropEventArgs, NodeExpandEventArgs } from '@syncfusion/ej2-navigations'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import type { Turnout, ServoTurnout, TurnoutType, TurnoutProfile, TurnoutDefaultState } from '../../utils/myAutomationParser'
import { commentInvalidTurnoutLines } from '../../utils/myAutomationParser'
import { getBoardSources, isCsb1Project } from '../../utils/vpin-picker-logic'
import { virtualEventStatus, type VirtualEventStatus } from '../../utils/virtual-turnout-events'
import { allFolderPaths, buildTurnoutTree, isValidFolderName, locationOf, wouldCreateCycle, type TurnoutLocation, type TurnoutTreeNode } from '../../utils/turnout-tree'
import { ToastService } from '../../services/toast.service'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'
import type { ServoCalibrationResult } from '../dialogs/servo-calibration-dialog'
import type { TurnoutCloneResult } from '../dialogs/turnout-clone-dialog'
import type { TextInputResult } from '../dialogs/text-input-dialog'

type ViewTab = 'visual' | 'raw'

// ── Tree node data (Syncfusion TreeView) ─────────────────────────────────────
// Node ids: `folder:<path>` for organisation-only folders, `t:<index>` for turnouts (index into
// state.turnouts — the tree is rebuilt whenever that array changes, so ids never go stale).

interface TurnoutTreeData {
    id: string
    text: string
    nodeType: 'folder' | 'turnout'
    expanded: boolean
    /** Folder path (folders) — empty for turnouts. */
    path: string
    /** Index into state.turnouts (turnouts) — -1 for folders. */
    index: number
    childCount: number
    children?: TurnoutTreeData[]
}

const FOLDER_PREFIX = 'folder:'
const TURNOUT_PREFIX = 't:'

export class TurnoutEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)
    private readonly observerLocator = resolve(IObserverLocator)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    private splitterObj: Splitter | null = null
    /** Guards the queueTask() below — the component (or its #turnout-splitter, gated behind activeTab === 'visual') can be torn down before the deferred Splitter creation runs, which would otherwise append a live widget into a detached/stale element and leave a broken splitterObj for detaching() to (potentially) throw on. */
    private _detached = false

    private readonly _aliasSubscriber = {
        handleChange: () => {
            if (this.editBuffer !== null) {
                this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.id, 'Turnout')
            }
            this._syncTree()
        },
    }

    /** Repaints the tree when turnouts/folders change from anywhere (visual edit, raw edit, aliases). */
    private readonly _treeSubscriber = {
        handleChange: () => this._syncTree(),
    }

    readonly profiles: TurnoutProfile[] = ['Instant', 'Fast', 'Medium', 'Slow', 'Bounce']
    readonly defaultStates: TurnoutDefaultState[] = ['CLOSED', 'THROWN']
    readonly turnoutTypes: { value: TurnoutType; label: string }[] = [
        { value: 'SERVO', label: 'Servo' },
        { value: 'DCC', label: 'DCC accessory (addr + sub-addr)' },
        { value: 'DCCL', label: 'DCC accessory (linear address)' },
        { value: 'PIN', label: 'GPIO pin' },
        { value: 'VIRTUAL', label: 'Virtual (no hardware)' },
    ]

    // ── View tabs ─────────────────────────────────────────────────────────────
    activeTab: ViewTab = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false

    setTab(tab: ViewTab): void {
        this._userChoseTab = true
        this._applyTab(tab)
    }

    /** Applies the current default-editor-view preference, unless the user has already picked a tab for this file this session. Called from attached() on every visit — see there for why. */
    private _applyDefaultViewIfUnset(): void {
        if (!this._userChoseTab) this._applyTab(this.editorDefaultView.value)
    }

    /** setTab()'s actual work, factored out so attached() can (re)apply the default-editor-view preference without marking it as a user choice. */
    private _applyTab(tab: ViewTab): void {
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
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session.
        this._applyDefaultViewIfUnset()
        // Reset the guard set by the previous detaching() — or the queued Splitter
        // creation below would skip itself forever after the first time this
        // editor is left and revisited.
        this._detached = false
        // Refresh alias display in case aliases changed while this editor was inactive
        if (this.editBuffer !== null) {
            this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.id, 'Turnout')
        }
        this.observerLocator.getObserver(this.state, 'aliases').subscribe(this._aliasSubscriber)
        this.observerLocator.getObserver(this.state, 'turnouts').subscribe(this._treeSubscriber)
        this.observerLocator.getObserver(this.state, 'turnoutFolders').subscribe(this._treeSubscriber)
        queueTask(() => {
            if (this._detached) return
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
            this._createTree()
        })
    }

    detaching(): void {
        this._detached = true
        this.observerLocator.getObserver(this.state, 'aliases').unsubscribe(this._aliasSubscriber)
        this.observerLocator.getObserver(this.state, 'turnouts').unsubscribe(this._treeSubscriber)
        this.observerLocator.getObserver(this.state, 'turnoutFolders').unsubscribe(this._treeSubscriber)
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
        try { this.sfContextMenu?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.sfContextMenu = null
        try { this.sfTree?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.sfTree = null
        this._treeSignature = ''
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
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
        return `${loadTreeWidth()}px`
    }
    private _saveSidebarWidth(size: string): void {
        saveTreeWidth(parseInt(size, 10))
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
    /** Path of the folder node selected in the tree (mutually exclusive with editBuffer), or null. */
    selectedFolder: string | null = null
    /** Value of the detail panel's Location select for the selected turnout: 'root' | `folder:<path>` | `parent:<id>`. */
    locationValue = 'root'

    get turnouts(): Turnout[] {
        return this.state.turnouts
    }

    private _setBuffer(index: number, entry: Turnout): void {
        this.editBufferIndex = index
        this.editBuffer = { ...entry }
        this.selectedFolder = null
        this.locationValue = this._locationKey(entry)
        this.aliasInput = this.state.getPrimaryAliasNameForId(entry.id, 'Turnout')
        this.errorMessage = ''
    }

    clearBuffer(): void {
        this.editBuffer = null
        this.editBufferIndex = null
        this.locationValue = 'root'
        this.aliasInput = ''
        this.errorMessage = ''
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
        if (t.type === 'DCCL') {
            return { ...t, id, addr: Number(t.addr) }
        }
        if (t.type === 'PIN') {
            return { ...t, id, pin: Number(t.pin) }
        }
        return { ...t, id }
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
        if (this.state.strictAliases && this.aliasInput.trim() === '') {
            this.errorMessage = 'This turnout requires an alias when Strict aliases is enabled.'
            return
        }
        const existing = this.state.turnouts?.[this.editBufferIndex]
        const existingAliasName = existing ? this.state.getPrimaryAliasNameForId(existing.id, 'Turnout') : ''
        const aliasChanged = !!existing && (existing.id !== this.editBuffer.id || existingAliasName !== this.aliasInput.trim())
        // Tree placement (folder / parentId) is owned by state, not the edit buffer: folder
        // renames, drag-and-drop and parent deletion all change it behind the buffer's back, and
        // writing the buffer's copy back would silently undo them.
        const { folder: _folder, parentId: _parentId, ...bufferFields } = this.editBuffer
        this.state.updateTurnoutEntry(this.editBufferIndex, { ...bufferFields, ...(existing ? locationOf(existing) : {}) } as Turnout)
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
    // Arrow-function field (not a method) so the bare reference stays bound to
    // `this` when passed to <vpin-picker on-commit.bind="onFieldBlur">.
    onFieldBlur = (): void => {
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

    /**
     * DCC-EX hides a turnout from throttles when its description is the literal
     * string "HIDDEN" (see TURNOUT()/SERVO_TURNOUT() docs) — there's no separate
     * hidden flag in the underlying macros, so that literal IS the hidden state.
     */
    get isHidden(): boolean {
        return this.editBuffer?.description === 'HIDDEN'
    }

    toggleHidden(hidden: boolean): void {
        if (!this.editBuffer) return
        this.editBuffer.description = hidden ? 'HIDDEN' : ''
        this.commitBuffer()
    }

    /** Next VPin not already claimed by a servo turnout, sensor, signal, or HAL accessory board. */
    private _nextFreeVpin(): number {
        const servoEntries = this.state.turnouts.filter((t): t is ServoTurnout => t.type === 'SERVO')
        let pin = servoEntries.length > 0 ? Math.max(...servoEntries.map(t => t.pin)) + 1 : 101
        while (this.state.findVpinConflicts(pin, 1).length > 0) {
            pin += 1
        }
        return pin
    }

    /**
     * Switches the selected entry to a different turnout kind, converting to that kind's
     * shape (fresh sensible defaults for any newly-required fields) while preserving the
     * fields common to every kind (id, description, comment, defaultState). Used both for
     * changing an existing entry's kind and, indirectly, by addEntry() below (which asks
     * for the kind up front via TurnoutTypeDialog, then builds the shape the same way).
     */
    async updateType(type: TurnoutType): Promise<void> {
        if (!this.editBuffer || this.editBuffer.type === type) return
        const base = {
            id: this.editBuffer.id,
            description: this.editBuffer.description,
            comment: this.editBuffer.comment,
            defaultState: this.editBuffer.defaultState,
        }
        if (type === 'SERVO') {
            if (!(await this._ensureServoBoard())) return
            const pin = await this._pickPin(this._nextFreeVpin())
            if (pin === null) return
            this.editBuffer ={ ...base, type: 'SERVO', pin, activeAngle: 400, inactiveAngle: 100, profile: 'Slow' }
        } else if (type === 'DCC') {
            this.editBuffer = { ...base, type: 'DCC', addr: 0, subAddr: 0 }
        } else if (type === 'DCCL') {
            this.editBuffer = { ...base, type: 'DCCL', addr: 0 }
        } else if (type === 'PIN') {
            this.editBuffer = { ...base, type: 'PIN', pin: this._nextFreeVpin() }
        } else {
            this.editBuffer = { ...base, type: 'VIRTUAL' }
        }
        this.commitBuffer()
    }

    // ── Add / remove entries ──────────────────────────────────────────────────
    async addEntry(location?: TurnoutLocation): Promise<void> {
        if (this.editBuffer !== null) this.commitBuffer()
        // New entries land in the selected folder / next to the selected turnout, unless told otherwise.
        const placement = location ?? this._defaultContainer()

        // Ask which kind to create up front, rather than always creating a SERVO
        // and making the user switch kind afterward via the detail panel's Kind
        // dropdown.
        const type = await this._pickType()
        if (type === null) return

        const ts = this.state.turnouts
        const maxId = ts.length > 0 ? Math.max(...ts.map(t => t.id)) + 1 : 200
        const base = { id: maxId, description: 'New Turnout', comment: '', defaultState: 'CLOSED' as TurnoutDefaultState, ...placement }

        let newEntry: Turnout
        if (type === 'SERVO') {
            // Pick the driving pin up front (Direct MCU pin, or a channel on a
            // PWM-capable HAL board) before creating the entry, rather than
            // silently assigning one and letting the user hunt for the pin
            // field afterwards.
            if (!(await this._ensureServoBoard())) return
            const pin = await this._pickPin(this._nextFreeVpin())
            if (pin === null) return
            newEntry ={ ...base, type: 'SERVO', pin, activeAngle: 400, inactiveAngle: 100, profile: 'Slow' }
        } else if (type === 'DCC') {
            newEntry = { ...base, type: 'DCC', addr: 0, subAddr: 0 }
        } else if (type === 'DCCL') {
            newEntry = { ...base, type: 'DCCL', addr: 0 }
        } else if (type === 'PIN') {
            newEntry = { ...base, type: 'PIN', pin: this._nextFreeVpin() }
        } else {
            newEntry = { ...base, type: 'VIRTUAL' }
        }

        this.state.addTurnoutEntry(newEntry)
        const idx = this.state.turnouts.length - 1
        this._setBuffer(idx, this.state.turnouts[idx])
        // Servo entries jump straight into calibration so the user can set a
        // sensible position before doing anything else.
        if (type === 'SERVO') void this.openServoCalibration()
    }

    /** Opens the kind-picker popup. Returns the chosen kind, or null if cancelled. */
    private async _pickType(): Promise<TurnoutType | null> {
        const { dialog } = await this.dialogService.open({
            component: () =>
                import('../dialogs/turnout-type-dialog').then(m => m.TurnoutTypeDialog).catch(() => null),
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return null
        return (result.value as { type: TurnoutType }).type
    }

    /**
     * An EX-CSB1 has no free MCU pins, so a servo turnout needs a PCA9685 (or other servo-role) board
     * declared on the Accessories tab. When there isn't one, explains that and offers to jump there.
     * Returns true when a servo board exists and the pin picker can proceed.
     */
    private async _ensureServoBoard(): Promise<boolean> {
        const isCsb1 = isCsb1Project(this.installerState.selectedDevice?.name, this.state.configHContent)
        if (!isCsb1 || getBoardSources(this.state.halDevices, 'servo').length > 0) return true

        const { dialog } = await this.dialogService.open({
            component: () =>
                import('../dialogs/confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
            model: {
                title: 'Servo board required',
                message: 'The EX-CSB1 has no free pins for a servo, so servo turnouts need a PCA9685 servo module.',
                detail: 'Add one on the Accessories tab (Device Settings), then come back to add the turnout.',
                confirmLabel: 'Go to Accessories',
                confirmClass: 'bg-blue-600 hover:bg-blue-500 text-white',
            },
        })
        const result = await dialog.closed
        if (result.status === 'ok') window.dispatchEvent(new CustomEvent('exinst:navigate-accessories'))
        return false
    }

    /** Opens the small pin-select popup, pre-filled with `defaultPin`. Returns the chosen pin, or null if cancelled. */
    private async _pickPin(defaultPin: number): Promise<number | null> {
        const { dialog } = await this.dialogService.open({
            component: () =>
                import('../dialogs/pin-select-dialog').then(m => m.PinSelectDialog).catch(() => null),
            model: {
                pin: defaultPin,
                role: 'servo',
                message: 'New turnouts use a servo — choose the accessory board and channel the servo is wired to.',
            },
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return null
        return (result.value as { pin: number }).pin
    }

    /** One past the highest existing turnout ID (200 when there are none). */
    private _nextTurnoutId(): number {
        const ts = this.state.turnouts
        return ts.length > 0 ? Math.max(...ts.map(t => t.id)) + 1 : 200
    }

    /**
     * Asks how to clone an entry (new ID, hidden or not, servo profile) via a small modal, then
     * creates the twin. DCC-EX allows any number of turnout entries on one physical output; the
     * default — hidden, Instant — gives EXRAIL automation a second ID that snaps the same
     * servo/pin/accessory instantly without appearing on a throttle or easing through the
     * original's profile.
     */
    async cloneEntry(index: number): Promise<void> {
        if (this.editBuffer !== null) this.commitBuffer()
        const source = this.state.turnouts[index]
        if (!source) return

        const { dialog } = await this.dialogService.open({
            component: () =>
                import('../dialogs/turnout-clone-dialog').then(m => m.TurnoutCloneDialog).catch(() => null),
            model: {
                sourceType: source.type,
                suggestedId: this._nextTurnoutId(),
                takenIds: this.state.turnouts.map(t => t.id),
            },
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return
        this.applyClone(index, result.value as TurnoutCloneResult)
    }

    /**
     * Appends a copy of `state.turnouts[index]` using the dialog's choices and selects it. A hidden
     * clone gets the HIDDEN description; a visible one keeps the source's description (rename it
     * after). Servo clones take the chosen profile; other kinds have no profile.
     */
    applyClone(index: number, opts: TurnoutCloneResult): void {
        const source = this.state.turnouts[index]
        if (!source) return

        const base = {
            ...source,
            id: opts.id,
            description: opts.hidden ? 'HIDDEN' : source.description,
            comment: '',
        }
        const clone: Turnout = base.type === 'SERVO' ? { ...base, profile: opts.profile } : base

        this.state.addTurnoutEntry(clone)
        const idx = this.state.turnouts.length - 1
        this._setBuffer(idx, this.state.turnouts[idx])
    }

    // ── Tree view (Syncfusion TreeView + ContextMenu) ─────────────────────────
    treeEl!: HTMLDivElement
    contextMenuEl!: HTMLUListElement
    private sfTree: TreeView | null = null
    private sfContextMenu: ContextMenu | null = null
    /** Id of the node last targeted by right-click or the ⋯ button. Cleared on menu close. */
    private _contextMenuNodeId: string | null = null
    /** True while we set selectedNodes programmatically, to keep nodeSelected from re-entering. */
    private _suppressNodeSelected = false
    /** Nodes the user collapsed; everything else renders expanded (also across rebuilds). */
    private readonly _collapsed = new Set<string>()
    /** child node id → parent node id, from the last _buildTreeData(); used to reveal a selection. */
    private readonly _parentOf = new Map<string, string>()
    /** Fingerprint of everything the tree displays — rebuild only when it changes (commits that change nothing must not refresh the tree mid-click). */
    private _treeSignature = ''

    private _createTree(): void {
        if (!this.treeEl) return
        // drawNode (DOM API) instead of nodeTemplate: SF's template engine uses new Function(),
        // which Electron's CSP blocks.
        this.sfTree = new TreeView({
            fields: {
                dataSource: this._buildTreeData() as unknown as { [key: string]: Object }[],
                id: 'id',
                text: 'text',
                child: 'children',
                expanded: 'expanded',
            },
            allowEditing: false,
            allowDragAndDrop: true,
            drawNode: (args: DrawNodeEventArgs) => this._renderNodeContent(args.node, args.nodeData as unknown as TurnoutTreeData),
            nodeSelected: (args: NodeSelectEventArgs) => this._onNodeSelected(args),
            nodeExpanded: (args: NodeExpandEventArgs) => this._collapsed.delete(String((args.nodeData as { id?: string }).id ?? '')),
            nodeCollapsed: (args: NodeExpandEventArgs) => this._collapsed.add(String((args.nodeData as { id?: string }).id ?? '')),
            nodeDragging: (args: DragAndDropEventArgs) => this._onNodeDragging(args),
            nodeDragStop: (args: DragAndDropEventArgs) => {
                // We apply the move to state ourselves (the tree is rebuilt from it) — letting SF
                // also move the DOM node would leave the two out of step.
                args.cancel = true
                this._onNodeDrop(args)
            },
        })
        this.sfTree.appendTo(this.treeEl)
        this._treeSignature = this._computeTreeSignature()
        this._expandBranches(this._buildTreeData())
        this._restoreSelection()

        this.sfContextMenu = new ContextMenu({
            target: '#turnout-treeview',
            items: [
                { text: 'Add Turnout Here…', id: 'add-here' },
                { text: 'New Folder…', id: 'new-folder' },
                { text: 'Rename Folder…', id: 'rename-folder' },
                { text: 'Delete Folder', id: 'delete-folder' },
                { text: 'Clone…', id: 'clone' },
                { text: 'Delete', id: 'delete' },
            ],
            beforeOpen: (args: BeforeOpenCloseMenuEventArgs) => {
                // A real right-click reaches beforeOpen before nodeClicked would run, so derive the
                // node from the event target; the ⋯ button pre-sets _contextMenuNodeId instead.
                if (!this._contextMenuNodeId) {
                    const e = args.event as MouseEvent
                    const nodeEl = (e?.target as Element | null)?.closest('li[data-uid]') as HTMLElement | null
                    const data = nodeEl && this.sfTree ? this.sfTree.getTreeData(nodeEl.dataset.uid ?? '')?.[0] : undefined
                    if (!data) { args.cancel = true; return }
                    this._contextMenuNodeId = (data as { id: string }).id
                }
                const id = this._contextMenuNodeId
                const menu = this.sfContextMenu!
                if (id.startsWith(FOLDER_PREFIX)) {
                    menu.showItems(['add-here', 'new-folder', 'rename-folder', 'delete-folder'], true)
                    menu.hideItems(['clone', 'delete'], true)
                } else {
                    const t = this.state.turnouts[this._indexOfNode(id)]
                    menu.hideItems(['new-folder', 'rename-folder', 'delete-folder'], true)
                    menu.showItems(['clone', 'delete'], true)
                    if (t?.type === 'VIRTUAL') menu.showItems(['add-here'], true)
                    else menu.hideItems(['add-here'], true)
                }
            },
            select: (args: MenuEventArgs) => this._onMenuSelect(args),
            onClose: () => { this._contextMenuNodeId = null },
        }, this.contextMenuEl)
    }

    private _indexOfNode(id: string): number {
        return id.startsWith(TURNOUT_PREFIX) ? parseInt(id.slice(TURNOUT_PREFIX.length), 10) : -1
    }

    private _computeTreeSignature(): string {
        return JSON.stringify([
            this.state.turnouts.map(t => [t.id, t.type, t.description, t.folder ?? null, t.parentId ?? null]),
            this.state.turnoutFolders,
            [...this.state.turnoutIdsNeedingAlias],
        ])
    }

    /** Rebuilds the tree if anything it displays changed. Cheap no-op otherwise. */
    private _syncTree(): void {
        if (!this.sfTree || this._detached || this._treeSyncQueued) return
        // Deferred: state changes notify synchronously, usually from the middle of an action that
        // is about to change the selection too (e.g. add → select the new entry).
        this._treeSyncQueued = true
        queueTask(() => {
            this._treeSyncQueued = false
            if (!this.sfTree || this._detached) return
            const signature = this._computeTreeSignature()
            if (signature === this._treeSignature) return
            this._treeSignature = signature
            this._rebuildTree()
        })
    }
    private _treeSyncQueued = false

    private _buildTreeData(): TurnoutTreeData[] {
        this._parentOf.clear()
        const turnouts = this.state.turnouts
        const convert = (node: TurnoutTreeNode, parentId: string | null): TurnoutTreeData => {
            const id = node.kind === 'folder' ? `${FOLDER_PREFIX}${node.path}` : `${TURNOUT_PREFIX}${node.index}`
            if (parentId) this._parentOf.set(id, parentId)
            const children = node.children.map(c => convert(c, id))
            return {
                id,
                text: node.kind === 'folder' ? node.name : this.getListLabel(turnouts[node.index]),
                nodeType: node.kind,
                expanded: !this._collapsed.has(id),
                path: node.kind === 'folder' ? node.path : '',
                index: node.kind === 'turnout' ? node.index : -1,
                childCount: node.kind === 'folder' ? this._countTurnouts(node) : children.length,
                children: children.length > 0 ? children : undefined,
            }
        }
        return buildTurnoutTree(turnouts, this.state.turnoutFolders).map(n => convert(n, null))
    }

    private _countTurnouts(node: TurnoutTreeNode): number {
        return node.children.reduce((n, c) => n + (c.kind === 'turnout' ? 1 : 0) + this._countTurnouts(c), 0)
    }

    private _currentSelectionNodeId(): string | null {
        if (this.editBufferIndex !== null) return `${TURNOUT_PREFIX}${this.editBufferIndex}`
        if (this.selectedFolder !== null) return `${FOLDER_PREFIX}${this.selectedFolder}`
        return null
    }

    private _rebuildTree(): void {
        if (!this.sfTree) return
        let data = this._buildTreeData()
        // Make sure the selected node is visible: expand its collapsed ancestors, then rebuild once more.
        const selected = this._currentSelectionNodeId()
        let revealed = false
        for (let p = selected ? this._parentOf.get(selected) : undefined; p; p = this._parentOf.get(p)) {
            if (this._collapsed.delete(p)) revealed = true
        }
        if (revealed) data = this._buildTreeData()
        this.sfTree.fields = {
            dataSource: data as unknown as { [key: string]: Object }[],
            id: 'id',
            text: 'text',
            child: 'children',
            expanded: 'expanded',
        }
        // SF fires nodeSelected synchronously for the previously-selected node while refresh()
        // restores selection — keep that from overwriting the edit buffer.
        this._suppressNodeSelected = true
        this.sfTree.refresh()
        this._suppressNodeSelected = false
        this._expandBranches(data)
        this._restoreSelection()
    }

    /** SF's refresh() doesn't reliably honour `expanded` from the data, so expand every branch the user hasn't collapsed explicitly (same workaround as roster-editor). */
    private _expandBranches(data: TurnoutTreeData[]): void {
        if (!this.sfTree) return
        const ids: string[] = []
        const walk = (nodes: TurnoutTreeData[]) => {
            for (const n of nodes) {
                if (!n.children) continue
                if (n.expanded) ids.push(n.id)
                walk(n.children)
            }
        }
        walk(data)
        if (ids.length > 0) this.sfTree.expandAll(ids)
    }

    private _restoreSelection(): void {
        const nodeId = this._currentSelectionNodeId()
        if (!nodeId || !this.sfTree) return
        this._suppressNodeSelected = true
        this.sfTree.selectedNodes = [nodeId]
        this._suppressNodeSelected = false
    }

    /** Builds a node's content with DOM APIs (no eval; CSP-safe). */
    private _renderNodeContent(node: HTMLLIElement, data: TurnoutTreeData): void {
        // SF structure: li > .e-text-content > .e-list-text
        const textWrap = node.querySelector('.e-text-content') as HTMLElement | null
        const textSpan = node.querySelector('.e-list-text') as HTMLElement | null
        if (!textWrap || !textSpan) return
        // position:relative + z-index:1 lifts content above e-fullrow so the ⋯ button gets pointer events.
        textWrap.style.cssText = 'display:flex;align-items:center;gap:0.375rem;min-width:0;width:100%;position:relative;z-index:2;'
        textSpan.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:0.375rem;'
        textSpan.textContent = ''

        const span = (className: string, text: string): HTMLSpanElement => {
            const el = document.createElement('span')
            el.className = className
            el.textContent = text
            return el
        }
        const svgIcon = (className: string, paths: string[], testId?: string, title?: string): SVGSVGElement => {
            const ns = 'http://www.w3.org/2000/svg'
            const svg = document.createElementNS(ns, 'svg')
            svg.setAttribute('class', className)
            svg.setAttribute('viewBox', '0 0 24 24')
            svg.setAttribute('fill', 'none')
            svg.setAttribute('stroke', 'currentColor')
            svg.setAttribute('stroke-width', '2')
            svg.setAttribute('stroke-linecap', 'round')
            svg.setAttribute('stroke-linejoin', 'round')
            if (testId) svg.setAttribute('data-testid', testId)
            if (title) {
                const t = document.createElementNS(ns, 'title')
                t.textContent = title
                svg.appendChild(t)
            }
            for (const d of paths) {
                const path = document.createElementNS(ns, 'path')
                path.setAttribute('d', d)
                svg.appendChild(path)
            }
            return svg
        }

        if (data.nodeType === 'folder') {
            textSpan.appendChild(svgIcon('w-4 h-4 shrink-0 text-yellow-500', ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']))
            textSpan.appendChild(span('text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1', data.text))
            textSpan.appendChild(span('text-xs text-gray-500 shrink-0', String(data.childCount)))
        } else {
            const t = this.state.turnouts[data.index]
            if (!t) return
            textSpan.appendChild(span('text-sm text-gray-700 dark:text-gray-300 truncate flex-1', data.text))
            if (t.type === 'VIRTUAL') textSpan.appendChild(span('text-[10px] font-mono text-purple-500 shrink-0', 'virtual'))
            if (this.isEntryHidden(t)) {
                textSpan.appendChild(svgIcon('w-4 h-4 shrink-0 text-gray-500', [
                    'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24',
                    'M1 1l22 22',
                ], 'hidden-turnout-icon', 'Hidden from throttles'))
            }
            if (this.state.turnoutIdsNeedingAlias.has(t.id)) {
                const dot = span('w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0', '')
                dot.title = 'No alias set (Strict aliases is enabled)'
                dot.setAttribute('data-testid', 'alias-warning-dot')
                textSpan.appendChild(dot)
            }
        }

        // ⋯ button: opens the same ContextMenu a right-click does, via a synthetic contextmenu event.
        const menuBtn = document.createElement('button')
        menuBtn.type = 'button'
        menuBtn.setAttribute('data-testid', data.nodeType === 'folder' ? 'folder-row-menu' : 'turnout-row-menu')
        menuBtn.setAttribute('aria-haspopup', 'menu')
        menuBtn.title = 'More actions'
        menuBtn.className = 'shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:bg-gray-900/10 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-colors'
        menuBtn.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>'
        // Above the text wrapper, which is itself above SF's absolutely-positioned e-fullrow overlay. pointer-events:auto because SF's tree CSS disables them on the text content (clicks are routed through e-fullrow).
        menuBtn.style.cssText = 'position:relative;z-index:3;pointer-events:auto;'
        const stop = (e: Event) => e.stopPropagation()
        menuBtn.addEventListener('mousedown', stop)
        menuBtn.addEventListener('mouseup', stop)
        menuBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation()
            this._contextMenuNodeId = data.id
            const rect = menuBtn.getBoundingClientRect()
            menuBtn.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, clientX: Math.round(rect.left), clientY: Math.round(rect.bottom),
            }))
        })
        textWrap.appendChild(menuBtn)
    }

    private _onNodeSelected(args: NodeSelectEventArgs): void {
        if (this._suppressNodeSelected) return
        const id = (args.nodeData as { id?: string }).id ?? ''
        if (id.startsWith(FOLDER_PREFIX)) {
            if (this.editBuffer !== null) this.commitBuffer()
            this.clearBuffer()
            this.selectedFolder = id.slice(FOLDER_PREFIX.length)
        } else if (id.startsWith(TURNOUT_PREFIX)) {
            const idx = this._indexOfNode(id)
            if (this.editBuffer !== null) this.commitBuffer()
            const entry = this.state.turnouts[idx]
            if (entry) this._setBuffer(idx, entry)
        }
    }

    private _onMenuSelect(args: MenuEventArgs): void {
        const action = args.item.id
        const nodeId = this._contextMenuNodeId ?? ''
        if (nodeId.startsWith(FOLDER_PREFIX)) {
            const path = nodeId.slice(FOLDER_PREFIX.length)
            if (action === 'add-here') void this.addEntry({ folder: path })
            else if (action === 'new-folder') void this.promptNewFolder(path)
            else if (action === 'rename-folder') void this.promptRenameFolder(path)
            else if (action === 'delete-folder') void this.deleteFolder(path)
            return
        }
        const index = this._indexOfNode(nodeId)
        const t = this.state.turnouts[index]
        if (!t) return
        if (action === 'clone') void this.cloneEntry(index)
        else if (action === 'delete') void this.removeEntryByIndex(index)
        else if (action === 'add-here' && t.type === 'VIRTUAL') void this.addEntry({ parentId: t.id })
    }

    /**
     * Picks the drag cursor icon to match what a drop would do (see _onNodeDrop): the "+" (drop-in)
     * only over somewhere the node can really nest — a folder or a VIRTUAL turnout. Over an ordinary
     * turnout the drop just joins that turnout's level, so it gets the sibling marker instead; over
     * anything the drop would refuse, the no-drop icon.
     */
    private _onNodeDragging(args: DragAndDropEventArgs): void {
        if (!this.sfTree) return
        const draggedId = String((args.draggedNodeData as { id?: string }).id ?? '')
        const targetEl = (args.target as Element | null)?.closest('li[data-uid]') as HTMLElement | null
        if (!targetEl) return // blank space: leave SF's own indicator (drop to top level)
        const targetId = (this.sfTree.getTreeData(targetEl.dataset.uid ?? '')?.[0] as { id?: string } | undefined)?.id
        if (!targetId) return
        if (targetId === draggedId) { args.dropIndicator = 'e-no-drop'; return }

        const targetIsFolder = targetId.startsWith(FOLDER_PREFIX)
        if (draggedId.startsWith(FOLDER_PREFIX)) {
            const from = draggedId.slice(FOLDER_PREFIX.length)
            const into = targetIsFolder ? targetId.slice(FOLDER_PREFIX.length) : null
            // A folder only nests in another folder, never in itself or its own subfolders.
            args.dropIndicator = into !== null && into !== from && !into.startsWith(`${from}/`) ? 'e-drop-in' : 'e-no-drop'
            return
        }

        if (targetIsFolder) { args.dropIndicator = 'e-drop-in'; return }
        const target = this.state.turnouts[this._indexOfNode(targetId)]
        const index = this._indexOfNode(draggedId)
        if (!target || index < 0) { args.dropIndicator = 'e-no-drop'; return }
        if (target.type !== 'VIRTUAL') { args.dropIndicator = 'e-drop-next'; return }
        args.dropIndicator = wouldCreateCycle(this.state.turnouts, index, target.id) ? 'e-no-drop' : 'e-drop-in'
    }

    /** Applies a drag-and-drop: onto a folder / VIRTUAL turnout nests inside it; onto any other turnout joins its level; onto blank space goes to the top. */
    private _onNodeDrop(args: DragAndDropEventArgs): void {
        if (!this.sfTree) return
        const draggedId = String((args.draggedNodeData as { id?: string }).id ?? '')
        const targetEl = (args.target as Element | null)?.closest('li[data-uid]') as HTMLElement | null
        const targetData = targetEl ? this.sfTree.getTreeData(targetEl.dataset.uid ?? '')?.[0] as { id?: string } | undefined : undefined
        const targetId = targetData?.id ?? null
        if (targetId === draggedId) return

        if (draggedId.startsWith(FOLDER_PREFIX)) {
            const from = draggedId.slice(FOLDER_PREFIX.length)
            let parent = ''
            if (targetId?.startsWith(FOLDER_PREFIX)) parent = targetId.slice(FOLDER_PREFIX.length)
            else if (targetId) return this._toastCannotMove('A folder can only be moved into another folder or to the top level.')
            const name = from.split('/').pop()!
            const to = parent ? `${parent}/${name}` : name
            if (to === from) return
            this._commitPending()
            if (!this.state.renameTurnoutFolder(from, to)) return this._toastCannotMove(`A folder named "${name}" already exists there.`)
            if (this.selectedFolder !== null && (this.selectedFolder === from || this.selectedFolder.startsWith(`${from}/`))) {
                this.selectedFolder = to + this.selectedFolder.slice(from.length)
            }
            this._afterTreeChange()
            return
        }

        const index = this._indexOfNode(draggedId)
        if (index < 0) return
        let loc: TurnoutLocation = {}
        if (targetId?.startsWith(FOLDER_PREFIX)) loc = { folder: targetId.slice(FOLDER_PREFIX.length) }
        else if (targetId) {
            const target = this.state.turnouts[this._indexOfNode(targetId)]
            if (!target) return
            loc = target.type === 'VIRTUAL' ? { parentId: target.id } : locationOf(target)
        }
        this._commitPending()
        if (!this.state.moveTurnoutTo(index, loc)) return this._toastCannotMove('A turnout can only be nested under a Virtual turnout, and not under itself or one of its own children.')
        this._afterTreeChange()
    }

    private _toastCannotMove(content: string): void {
        this.toastService.show({ title: "Can't Move Here", content, cssClass: 'e-toast-warning' })
    }

    /** Commits any in-progress edit before a structural change (so its values aren't lost or applied late). */
    private _commitPending(): void {
        if (this.editBuffer !== null) this.commitBuffer()
    }

    /** After a move/rename/delete: re-read the selected turnout's placement and repaint the tree. */
    private _afterTreeChange(): void {
        if (this.editBufferIndex !== null) {
            const fresh = this.state.turnouts[this.editBufferIndex]
            if (fresh) this.locationValue = this._locationKey(fresh)
        }
        this._treeSignature = ''
        this._syncTree()
    }

    // ── Folders ───────────────────────────────────────────────────────────────
    private async _promptName(title: string, label: string, value: string, confirmLabel: string, validate: (v: string) => string): Promise<string | null> {
        const { dialog } = await this.dialogService.open({
            component: () => import('../dialogs/text-input-dialog').then(m => m.TextInputDialog).catch(() => null),
            model: { title, label, value, confirmLabel, validate },
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return null
        return (result.value as TextInputResult).value
    }

    /** Where "New Folder" / "Add" should put things by default: the selected folder, else the selected turnout's own level. */
    private _defaultContainer(): TurnoutLocation {
        if (this.selectedFolder !== null) return { folder: this.selectedFolder }
        if (this.editBufferIndex !== null) {
            const t = this.state.turnouts[this.editBufferIndex]
            if (t?.type === 'VIRTUAL') return { parentId: t.id }
            if (t) return locationOf(t)
        }
        return {}
    }

    /** Creates a folder inside `parentPath` (default: the selected folder, or the selected turnout's folder). */
    async promptNewFolder(parentPath?: string): Promise<void> {
        const parent = parentPath ?? this._defaultContainer().folder ?? ''
        const existing = new Set(allFolderPaths(this.state.turnouts, this.state.turnoutFolders))
        const name = await this._promptName(
            parent ? `New folder in "${parent}"` : 'New folder',
            'Folder name',
            '',
            'Create',
            v => (!isValidFolderName(v) ? 'Enter a name (it can’t contain “/”).' : existing.has(parent ? `${parent}/${v}` : v) ? 'A folder with that name already exists here.' : ''),
        )
        if (name === null) return
        const path = parent ? `${parent}/${name}` : name
        this._commitPending()
        if (!this.state.addTurnoutFolder(path)) return
        this.clearBuffer()
        this.selectedFolder = path
        this._treeSignature = ''
        this._syncTree()
    }

    async promptRenameFolder(path: string): Promise<void> {
        const parent = path.split('/').slice(0, -1).join('/')
        const current = path.split('/').pop()!
        const existing = new Set(allFolderPaths(this.state.turnouts, this.state.turnoutFolders))
        const name = await this._promptName(
            'Rename folder',
            'Folder name',
            current,
            'Rename',
            v => (!isValidFolderName(v) ? 'Enter a name (it can’t contain “/”).' : v !== current && existing.has(parent ? `${parent}/${v}` : v) ? 'A folder with that name already exists here.' : ''),
        )
        if (name === null || name === current) return
        const to = parent ? `${parent}/${name}` : name
        this._commitPending()
        if (!this.state.renameTurnoutFolder(path, to)) return
        if (this.selectedFolder !== null && (this.selectedFolder === path || this.selectedFolder.startsWith(`${path}/`))) {
            this.selectedFolder = to + this.selectedFolder.slice(path.length)
        }
        this._afterTreeChange()
    }

    /** Deletes a folder after confirmation; its turnouts and subfolders move up one level (nothing else is deleted). */
    async deleteFolder(path: string): Promise<void> {
        const confirmed = await this._confirm(`Delete folder "${path.split('/').pop()}"?`, 'Its turnouts and subfolders will move up one level — no turnouts are deleted.')
        if (!confirmed) return
        this._commitPending()
        this.state.deleteTurnoutFolder(path)
        if (this.selectedFolder !== null && (this.selectedFolder === path || this.selectedFolder.startsWith(`${path}/`))) {
            this.selectedFolder = null
        }
        this._afterTreeChange()
    }

    // ── Location select (detail panel) ────────────────────────────────────────
    private _locationKey(t: Turnout): string {
        if (t.parentId !== undefined) return `parent:${t.parentId}`
        if (t.folder) return `folder:${t.folder}`
        return 'root'
    }

    /** Everywhere the selected turnout could live: top level, any folder, any other VIRTUAL turnout that isn't below it. */
    get locationOptions(): { value: string; label: string }[] {
        const options = [{ value: 'root', label: 'Top level' }]
        for (const path of allFolderPaths(this.state.turnouts, this.state.turnoutFolders)) {
            options.push({ value: `folder:${path}`, label: `Folder: ${path.split('/').join(' / ')}` })
        }
        const selfIndex = this.editBufferIndex
        this.state.turnouts.forEach((t, i) => {
            if (t.type !== 'VIRTUAL' || i === selfIndex) return
            if (selfIndex !== null && wouldCreateCycle(this.state.turnouts, selfIndex, t.id)) return
            options.push({ value: `parent:${t.id}`, label: `Under: ${this.getListLabel(t)}` })
        })
        return options
    }

    onLocationChange(): void {
        if (this.editBuffer === null || this.editBufferIndex === null) return
        const key = this.locationValue
        const loc: TurnoutLocation = key.startsWith('folder:') ? { folder: key.slice(7) } : key.startsWith('parent:') ? { parentId: Number(key.slice(7)) } : {}
        this.commitBuffer()
        if (this.errorMessage) {
            this.locationValue = this._locationKey(this.state.turnouts[this.editBufferIndex])
            return
        }
        if (!this.state.moveTurnoutTo(this.editBufferIndex, loc)) {
            this.locationValue = this._locationKey(this.state.turnouts[this.editBufferIndex])
            return
        }
        this._afterTreeChange()
    }

    /** Event coverage of the VIRTUAL turnout being edited (null for any other kind) — drives the hint in the form. */
    get virtualEvents(): (VirtualEventStatus & { childCount: number }) | null {
        if (this.editBuffer?.type !== 'VIRTUAL') return null
        const id = this.editBuffer.id
        const children = this.state.turnouts.filter(t => t.parentId === id).map(t => t.id)
        return { ...virtualEventStatus(this.state.eventHandlers, id, children, id => this.state.turnoutAliasName(id)), childCount: children.length }
    }

    addMissingVirtualEvents(): void {
        if (this.editBuffer?.type === 'VIRTUAL') this.state.syncVirtualParentEvents(this.editBuffer.id)
    }

    get selectedFolderName(): string {
        return this.selectedFolder?.split('/').pop() ?? ''
    }

    get selectedFolderItemCount(): number {
        const path = this.selectedFolder
        if (path === null) return 0
        return this.state.turnouts.filter(t => t.folder === path || t.folder?.startsWith(`${path}/`)).length
    }

    // ── Row actions ───────────────────────────────────────────────────────────
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
    isEntryHidden(t: Turnout): boolean {
        return t.description === 'HIDDEN'
    }

    /** Name without any hidden marker — the sidebar list shows an eye-off icon for that instead. */
    getListLabel(t: Turnout): string {
        if (this.isEntryHidden(t)) {
            // A hidden turnout has no description to show, so fall back to its alias if it has one
            const alias = this.state.getPrimaryAliasNameForId(t.id, 'Turnout')
            return alias ? `${alias} (${t.id})` : `Turnout ${t.id}`
        }
        return t.description ? `${t.description} (${t.id})` : `Turnout ${t.id}`
    }

    /** Plain-text name, used in dialogs and error messages where an icon can't be shown. */
    getDisplayName(t: Turnout): string {
        const label = this.getListLabel(t)
        return this.isEntryHidden(t) ? `${label} (hidden)` : label
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
