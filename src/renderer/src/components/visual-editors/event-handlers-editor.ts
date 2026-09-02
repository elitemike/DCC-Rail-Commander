import { queueTask, resolve } from 'aurelia'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { EventHandlerEntry } from '../../utils/myAutomationParser'
import { definedTracksFor, parseEventHandlerBlock } from './exrail-block-compiler'
import type { BlockTypeDef, DefinedObjects } from './exrail-block-compiler'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import { defaultFieldsFor } from './exrail-blockly-toolbox'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type RowTab = 'blocks' | 'text'

export interface AddGroup {
    category: string
    defs: BlockTypeDef[]
}

/**
 * List+canvas editor for myEvents.h — the same shape as routes-editor.ts/sequences-editor.ts, but
 * for EXRAIL event-handler blocks (ONSENSOR, ONACTIVATE, ...). Deliberately simpler in one
 * respect: an entry has no id/alias/description, so there's no rename flow, no shared-id-pool
 * warning, and no separate header-line getter/setter — the whole on-disk block (header line
 * included) is EventHandlerEntry.text, edited as one unit by both the Blocks and Raw tabs. See
 * that field's own doc comment in myAutomationParser.ts.
 *
 * Entries have no unique id, so `selectedIndex` (a plain array index) is this editor's identity —
 * unlike routes-editor.ts's `selectedId`, which survives array-order changes because it's looked
 * up by RouteEntry.id every time. Add/remove keep it pointing at the same logical entry (see
 * addEventHandler()/removeEventHandler()).
 */
export class EventHandlersEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file — see sequences-editor.ts's identical field for why attached() re-applies the default on every visit until then. */
    private _userChoseTab = false
    rawEditor: any = null
    /** Ref to the mounted exrail-block-canvas — reused across handler selections, so a selection change must explicitly push the new text into it (see reload()'s own doc comment on exrail-block-canvas.ts). */
    blockCanvas: { reload(body: string): void; refreshSize(): void } | null = null
    /** Ref to the per-row Raw Monaco editor — reused across row selections via switchModel(). */
    rowRawEditor: { flush(): string; switchModel(filename: string, value: string): void } | null = null

    private splitterObj: Splitter | null = null
    private _detached = false

    /** Explicit per-row Blocks/Text choice, keyed by index — undefined falls back to canUseBlocks(). */
    private rowTab: Record<number, RowTab> = {}

    selectedIndex: number | null = null
    /** Which param-flavored hat the Add control currently has picked, e.g. 'ONSENSOR' — seeded to the first available choice in attached(). */
    addSelection = ''

    get defined(): DefinedObjects {
        return {
            roster: this.state.roster,
            turnouts: this.state.turnouts,
            sensors: this.state.sensors,
            signals: this.state.signals,
            routes: this.state.routes,
            sequences: this.state.sequences,
            aliases: this.state.aliases,
            tracks: definedTracksFor(this.state.hasStackedMotorShield),
        }
    }

    /**
     * Every param-flavored hat currently available to add, grouped by its registry `category` —
     * repurposed here as the Add control's grouping (still ignored by the block-canvas toolbox
     * itself, which always excludes every hat — see exrail-blockly-toolbox.ts).
     */
    get addableGroups(): AddGroup[] {
        const defined = this.defined
        const byCategory = new Map<string, BlockTypeDef[]>()
        for (const def of BLOCK_REGISTRY) {
            if (def.shape !== 'hat' || !def.paramFlavoredHat) continue
            if (!def.isAvailable(defined)) continue
            const list = byCategory.get(def.category)
            if (list) list.push(def)
            else byCategory.set(def.category, [def])
        }
        return [...byCategory.entries()].map(([category, defs]) => ({ category, defs }))
    }

    get selectedHandler(): EventHandlerEntry | null {
        if (this.selectedIndex === null) return null
        return this.state.eventHandlers[this.selectedIndex] ?? null
    }

    get selectedTab(): RowTab {
        const h = this.selectedHandler
        if (!h || this.selectedIndex === null) return 'blocks'
        return this.rowTab[this.selectedIndex] || (this.canUseBlocks(h) ? 'blocks' : 'text')
    }

    canUseBlocks(h: EventHandlerEntry): boolean {
        return parseEventHandlerBlock(h.text, BLOCK_REGISTRY).ok
    }

    /** Friendly list-row label, e.g. "On sensor changed (200)" — derived live from the registry's `label` plus the header line's own args, rather than a separate stored description field (there isn't one — see EventHandlerEntry). */
    getDisplayName(h: EventHandlerEntry): string {
        const def = BLOCK_REGISTRY.find((b) => b.id === h.command)
        const headerLine = h.text.split('\n')[0] ?? h.command
        const argsMatch = headerLine.match(/\(([^)]*)\)/)
        const args = argsMatch ? argsMatch[1].trim() : ''
        return `${def?.label ?? h.command}${args ? ` (${args})` : ''}`
    }

    /** Reassigns `rowTab` rather than mutating in place — same convention as routes-editor.ts's/sequences-editor.ts's setRowTab. */
    setRowTab(idx: number, tab: RowTab): void {
        if (tab === 'text') this.rowRawSnapshot = this.state.eventHandlers[idx]?.text ?? ''
        this.rowTab = { ...this.rowTab, [idx]: tab }
    }

    /** Synthetic per-row Monaco filename — disambiguates this row's scoped model from the whole-file `myEvents.h` model owned by the Raw tab below. */
    get rowRawFilename(): string {
        return this.selectedIndex !== null ? `myEvents.h#${this.selectedIndex}` : 'myEvents.h'
    }

    rowRawSnapshot = ''

    onRowRawChange = (text: string) => this.applyRowRawChange(text)

    applyRowRawChange(text: string): void {
        this.rowRawSnapshot = text
        if (this.selectedIndex === null) return
        this.updateHandlerText(this.selectedIndex, text)
    }

    /** Flushes both the whole-file and per-row Raw Monaco editors — called by file-editor-panel.ts before save/tab-switch, same as routes-editor.ts's/sequences-editor.ts's flushPending(). */
    flushPending(): void {
        this.rawEditor?.flush()
        this.rowRawEditor?.flush()
    }

    selectEntry(idx: number): void {
        this.rowRawEditor?.flush()
        this.selectedIndex = idx
        const h = this.state.eventHandlers[idx]
        this.blockCanvas?.reload(h?.text ?? '')
        this.rowRawSnapshot = h?.text ?? ''
        this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
    }

    /** Passed to <exrail-block-canvas on-full-text-change.bind> — looks the handler up by index at call time, same reasoning as routes-editor.ts's/sequences-editor.ts's makeBodyChangeHandler(). */
    makeFullTextChangeHandler(idx: number): (text: string) => void {
        return (text: string) => this.updateHandlerText(idx, text)
    }

    updateHandlerText(idx: number, text: string): void {
        if (!this.state.eventHandlers[idx]) return
        this.state.eventHandlers = this.state.eventHandlers.map((h, i) => (i === idx ? { ...h, text } : h))
        this.state.syncAll()
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    attached(): void {
        this._applyDefaultViewIfUnset()
        this._detached = false
        if (this.selectedIndex === null && this.state.eventHandlers.length > 0) {
            this.selectedIndex = 0
        }
        if (this.addSelection === '') {
            const first = this.addableGroups[0]?.defs[0]
            if (first) this.addSelection = first.id
        }
        queueTask(() => {
            if (this._detached || !document.getElementById('event-handlers-splitter')) return
            const savedWidth = this._loadSidebarWidth()
            this.splitterObj = new Splitter({
                paneSettings: [
                    { size: savedWidth, min: '200px', max: '600px' },
                    {},
                ],
                width: '100%',
                height: '100%',
                resizeStop: () => {
                    const pane = document.querySelector('#event-handlers-splitter > div:first-child') as HTMLElement
                    if (pane) this._saveSidebarWidth(`${pane.offsetWidth}px`)
                },
            })
            this.splitterObj.appendTo('#event-handlers-splitter')
        })
    }

    detaching(): void {
        this._detached = true
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.splitterObj = null
    }

    private _loadSidebarWidth(): string {
        try { return localStorage.getItem('event-handlers-editor-sidebar-width') ?? '256px' } catch { return '256px' }
    }
    private _saveSidebarWidth(size: string): void {
        try { localStorage.setItem('event-handlers-editor-sidebar-width', size) } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        this._userChoseTab = true
        this._applyTab(t)
    }

    private _applyDefaultViewIfUnset(): void {
        if (!this._userChoseTab) this._applyTab(this.editorDefaultView.value)
    }

    private _applyTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.eventHandlersRaw
        this.activeTab = t
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
        if (t === 'visual') setTimeout(() => this.blockCanvas?.refreshSize(), 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setEventHandlersFromRaw(text)
    }

    /** Adds a new entry for the currently-picked Add selection, seeded with default field values (mirrors how a freshly-dragged toolbox block gets its ref-kind params seeded — see defaultFieldsFor()) and a bare `DONE` body. */
    addEventHandler(): void {
        const def = BLOCK_REGISTRY.find((b) => b.id === this.addSelection)
        if (!def) return
        this.rowRawEditor?.flush()
        const paramValues = defaultFieldsFor(def, this.defined)
        // defaultFieldsFor() only seeds ref-kind params — number/string params still need *some*
        // value or def.emit() would interpolate `undefined` straight into the header line.
        const fullParamValues: Record<string, string | number> = { ...paramValues }
        for (const p of def.params) {
            if (fullParamValues[p.name] === undefined) fullParamValues[p.name] = p.kind === 'number' ? 0 : ''
        }
        const text = `${def.emit(fullParamValues)}\nDONE`
        this.state.eventHandlers = [...this.state.eventHandlers, { command: def.id, text }]
        this.state.syncAll()
        const newIndex = this.state.eventHandlers.length - 1
        this.selectedIndex = newIndex
        this.blockCanvas?.reload(text)
        this.rowRawSnapshot = text
        this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
    }

    removeEventHandler(idx: number, event?: Event): void {
        event?.stopPropagation()
        this.state.eventHandlers = this.state.eventHandlers.filter((_, i) => i !== idx)
        this.state.syncAll()
        if (this.selectedIndex === idx) {
            this.selectedIndex = this.state.eventHandlers.length > 0 ? Math.min(idx, this.state.eventHandlers.length - 1) : null
            const h = this.selectedHandler
            this.blockCanvas?.reload(h?.text ?? '')
            this.rowRawSnapshot = h?.text ?? ''
            this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
        } else if (this.selectedIndex !== null && idx < this.selectedIndex) {
            // A row before the selected one was removed — the array shifted underneath it, so
            // the index needs to move with the same logical entry, not stay put and now point at
            // whatever slid into its old slot.
            this.selectedIndex -= 1
        }
    }
}
