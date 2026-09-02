import { queueTask, resolve } from 'aurelia'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { AutomationEntry } from '../../utils/myAutomationParser'
import { definedTracksFor, parseBody } from './exrail-block-compiler'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import type { DefinedObjects } from './exrail-block-compiler'
import { ToastService } from '../../services/toast.service'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type RowTab = 'blocks' | 'text'

/** Mirrors RoutesEditorCustomElement exactly — AUTOMATION shares ROUTE's exact shape (id, quoted
 *  description, DONE-or-user's-own-terminator body) and the same block-canvas kind mechanics
 *  (see exrail-block-canvas.ts's `_headerLine()`/`_applyHeaderFields()`). Kept as a separate
 *  component rather than a shared base class for the same reason sequences-editor.ts already
 *  isn't merged with routes-editor.ts: the id/description/alias semantics per kind are close but
 *  not identical (SequenceEntry's description is an optional trailing comment, not a real field),
 *  and a shared abstraction would cost more than the duplication it removes. */
export class AutomationsEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly toastService = resolve(ToastService)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false
    rawEditor: any = null
    /** Ref to the mounted exrail-block-canvas — reused across automation selections (see its reload() doc comment), so a selection change must explicitly push the new body into it. */
    blockCanvas: { reload(body: string): void; refreshSize(): void } | null = null
    /** Ref to the per-row Raw Monaco editor — reused across row selections via switchModel(), same reasoning as blockCanvas above. */
    rowRawEditor: { flush(): string; switchModel(filename: string, value: string): void } | null = null

    private splitterObj: Splitter | null = null
    /** Guards the queueTask() below — this component (or its #automations-splitter, gated behind activeTab === 'visual') can be torn down before the deferred Splitter creation runs, which would otherwise append a live widget into a detached/stale element and leave a broken splitterObj for detaching() to (potentially) throw on. */
    private _detached = false

    /** Explicit per-row Blocks/Text choice, keyed by automation id — undefined falls back to canUseBlocks(). */
    private rowTab: Record<number, RowTab> = {}

    selectedId: number | null = null

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

    get selectedAutomation(): AutomationEntry | null {
        if (this.selectedId === null) return null
        return this.state.automations.find((a) => a.id === this.selectedId) ?? null
    }

    get selectedTab(): RowTab {
        const a = this.selectedAutomation
        if (!a) return 'blocks'
        return this.rowTab[a.id] || (this.canUseBlocks(a) ? 'blocks' : 'text')
    }

    canUseBlocks(a: AutomationEntry): boolean {
        return parseBody(a.body, 'AUTOMATION', BLOCK_REGISTRY).ok
    }

    private static readonly AUTOMATION_HEADER_RE = /^AUTOMATION\s*\(\s*\d+\s*,\s*"([^"]*)"\s*\)\s*$/

    /**
     * The Text tab's textarea binds to this (not `selectedAutomation.body` directly) so the
     * AUTOMATION(id, "desc") header line is part of the actual editable/selectable text, matching
     * the Blocks tab's hat node — not a separate read-only caption sitting outside the text
     * control. The id itself stays whatever `selectedAutomation.id` already is; only the quoted
     * description on that first line is round-tripped.
     */
    get selectedAutomationText(): string {
        const a = this.selectedAutomation
        if (!a) return ''
        return `AUTOMATION(${a.id}, "${a.description ?? ''}")\n${a.body ?? ''}`
    }

    set selectedAutomationText(text: string) {
        const a = this.selectedAutomation
        if (!a) return
        const lines = text.split('\n')
        const m = lines[0]?.match(AutomationsEditorCustomElement.AUTOMATION_HEADER_RE)
        if (m) {
            a.description = m[1]
            a.body = lines.slice(1).join('\n')
        } else {
            // Header line got mangled/removed — don't discard what the user typed; keep the
            // last-known description and fall back to treating everything as body.
            a.body = text
        }
    }

    getDisplayName(a: AutomationEntry): string {
        return a.description ? `${a.description} (${a.id})` : `Automation ${a.id}`
    }

    /** Alias pushed into the Blocks tab's hat block via <exrail-block-canvas header-alias.bind> —
     *  see exrail-block-canvas.ts's headerId/headerAlias bindables. */
    get selectedAutomationAlias(): string {
        const a = this.selectedAutomation
        return a ? this.state.getPrimaryAliasNameForId(a.id, 'Automation') : ''
    }

    /** Reassigns `rowTab` rather than mutating in place — sequences-editor.ts's setRowTab has the same convention, for the same reason: this is a plain object on a class instance, not observed through Aurelia's dirty-checking of individual keys. */
    setRowTab(a: AutomationEntry, tab: RowTab): void {
        if (tab === 'text') this.rowRawSnapshot = this.selectedAutomationText
        this.rowTab = { ...this.rowTab, [a.id]: tab }
    }

    /** Synthetic per-row Monaco filename — disambiguates this row's scoped model from the whole-file `myAutomations.h` model owned by the Raw tab below, while still being recognized as EXRAIL content (see baseFilename() in exrail-completions.ts). */
    get rowRawFilename(): string {
        return this.selectedId !== null ? `myAutomations.h#${this.selectedId}` : 'myAutomations.h'
    }

    rowRawSnapshot = ''

    /** Arrow field (not a template `.call` expression) so it stays a stable function reference across
     *  re-renders, matching `onRawChange` above — delegates to a plain method so the state-mutation
     *  logic itself is directly callable/testable without needing this arrow's `this` capture. */
    onRowRawChange = (text: string) => this.applyRowRawChange(text)

    applyRowRawChange(text: string): void {
        this.rowRawSnapshot = text
        this.selectedAutomationText = text
        const a = this.selectedAutomation
        if (a) this.updateAutomation(this.state.automations.indexOf(a), a)
    }

    /** Flushes both the whole-file and per-row Raw Monaco editors — called by file-editor-panel.ts before save/tab-switch so an edit still sitting in Monaco's 300ms debounce isn't lost. */
    flushPending(): void {
        this.rawEditor?.flush()
        this.rowRawEditor?.flush()
    }

    selectEntry(a: AutomationEntry): void {
        // Flush the outgoing row's pending edit while selectedId still points at it —
        // switchModel() below also flushes, but only after selectedId has already moved,
        // which would misattribute the old row's edit to the new one via onRowRawChange.
        this.rowRawEditor?.flush()
        this.selectedId = a.id
        this.blockCanvas?.reload(a.body)
        this.rowRawSnapshot = this.selectedAutomationText
        this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
    }

    /** Looks the automation up by id at call time rather than closing over `a` — updateAutomation() replaces the automations array with new entry objects on every call, so a captured `a` reference goes stale after the first edit. */
    makeBodyChangeHandler(automationId: number): (body: string) => void {
        return (body: string) => {
            const idx = this.state.automations.findIndex((v) => v.id === automationId)
            if (idx === -1) return
            this.updateAutomation(idx, { ...this.state.automations[idx], body })
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session (_userChoseTab).
        this._applyDefaultViewIfUnset()
        this._detached = false
        if (this.selectedId === null && this.state.automations.length > 0) {
            this.selectedId = this.state.automations[0].id
        }
        queueTask(() => {
            if (this._detached || !document.getElementById('automations-splitter')) return
            const savedWidth = this._loadSidebarWidth()
            this.splitterObj = new Splitter({
                paneSettings: [
                    { size: savedWidth, min: '200px', max: '600px' },
                    {},
                ],
                width: '100%',
                height: '100%',
                resizeStop: () => {
                    const pane = document.querySelector('#automations-splitter > div:first-child') as HTMLElement
                    if (pane) this._saveSidebarWidth(`${pane.offsetWidth}px`)
                },
            })
            this.splitterObj.appendTo('#automations-splitter')
        })
    }

    detaching(): void {
        this._detached = true
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.splitterObj = null
    }

    private _loadSidebarWidth(): string {
        try { return localStorage.getItem('automations-editor-sidebar-width') ?? '256px' } catch { return '256px' }
    }
    private _saveSidebarWidth(size: string): void {
        try { localStorage.setItem('automations-editor-sidebar-width', size) } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        this._userChoseTab = true
        this._applyTab(t)
    }

    /** Applies the current default-editor-view preference, unless the user has already picked a tab for this file this session. Called from attached() on every visit — see there for why. */
    private _applyDefaultViewIfUnset(): void {
        if (!this._userChoseTab) this._applyTab(this.editorDefaultView.value)
    }

    /** setTab()'s actual work, factored out so attached() can (re)apply the default-editor-view preference without marking it as a user choice. */
    private _applyTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.automationsRaw
        this.activeTab = t
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
        // Same reasoning as the Monaco layout() call above — Blockly, injected while `hidden`,
        // needs an explicit resize once the tab is visible again, since nothing about a plain CSS
        // class toggle on this element's own DOM notifies exrail-block-canvas.ts on its own.
        if (t === 'visual') setTimeout(() => this.blockCanvas?.refreshSize(), 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setAutomationsFromRaw(text)
    }

    addAutomation() {
        this.rowRawEditor?.flush()
        const nextId = this.state.nextSequenceId
        this.state.automations = [...this.state.automations, { id: nextId, description: 'New Automation', body: '' }]
        this.state.syncAll()
        this.selectedId = nextId
        this.blockCanvas?.reload('')
        this.rowRawSnapshot = this.selectedAutomationText
        this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
    }

    removeAutomation(idx: number, event?: Event) {
        event?.stopPropagation()
        const removedId = this.state.automations[idx]?.id
        this.state.automations = this.state.automations.filter((_, i) => i !== idx)
        this.state.syncAll()
        if (this.selectedId === removedId) {
            this.selectedId = this.state.automations[0]?.id ?? null
            this.blockCanvas?.reload(this.selectedAutomation?.body ?? '')
            this.rowRawSnapshot = this.selectedAutomationText
            this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
        }
    }

    /** Passed to <exrail-block-canvas on-id-change.bind>. Looks the automation up by id at call time,
     *  same reasoning as makeBodyChangeHandler() above. */
    makeIdChangeHandler(automationId: number): (id: number) => void {
        return (id: number) => {
            const idx = this.state.automations.findIndex((v) => v.id === automationId)
            if (idx === -1) return
            this.updateAutomation(idx, { ...this.state.automations[idx], id })
        }
    }

    /** Passed to <exrail-block-canvas on-alias-change.bind>. Mirrors sequences-editor.ts's makeAliasChangeHandler. */
    makeAliasChangeHandler(automationId: number): (name: string) => void {
        return (name: string) => {
            const existingAliasName = this.state.getPrimaryAliasNameForId(automationId, 'Automation')
            const result = this.state.syncAliasForId(automationId, automationId, name, 'Automation', existingAliasName)
            if (!result.ok) {
                this.toastService.show({ title: 'Alias Error', content: result.reason, cssClass: 'e-toast-warning' })
            }
        }
    }

    /** `focus.trigger` on the description input — see updateAutomation()'s strict-aliases block below.
     *  Description is the only field.two-way-bound directly onto the live `state.automations` entry
     *  (id/body come through explicit callback params instead), so it's the only one that needs
     *  an explicit pre-edit snapshot to revert to when a commit is blocked. */
    private _descriptionBeforeEdit: string | undefined = undefined
    captureDescriptionBeforeEdit(): void {
        this._descriptionBeforeEdit = this.selectedAutomation?.description
    }

    updateAutomation(idx: number, a: AutomationEntry) {
        // `value.two-way` on `<input type="text">` (description) round-trips through the DOM's
        // `.value`, always a string, but `id` comes from makeIdChangeHandler()'s already-numeric
        // callback param — Number() here is a no-op for that path and just guards the description-
        // only path, where `a` is a spread of the existing (already-numeric) entry.
        const entry: AutomationEntry = { ...a, id: Number(a.id) }
        const existing = this.state.automations[idx]
        const previousId = existing?.id ?? null
        // A block-canvas field unrelated to this automation's own data (its ALIAS field, most
        // notably) can trigger an incidental re-commit of the *unchanged* body/description/id
        // as a side effect of Blockly's own async field-commit ordering — not a real edit. Only
        // gate genuine changes, or an incidental resync racing an in-flight alias assignment
        // would itself get blocked and toast, even though nothing the user actually touched
        // here was left unsaved.
        const isRealChange = !existing || existing.id !== entry.id || existing.description !== entry.description || existing.body !== entry.body
        // Strict aliases: block *any* real field save (description, id, or body — including a
        // Blocks-tab edit routed here via makeBodyChangeHandler()) on an automation that
        // currently has no alias. Checked by the pre-edit id when an id change is in flight,
        // same reasoning as sensors-editor.ts's updateSensor().
        if (isRealChange && this.state.strictAliases && !this.state.getPrimaryAliasNameForId(previousId ?? entry.id, 'Automation')) {
            // Description is already live in state.automations[idx] (two-way binding, not an edit-buffer)
            // — revert it so the block actually takes visible effect.
            if (this._descriptionBeforeEdit !== undefined) {
                const revertTo = this._descriptionBeforeEdit
                this.state.automations = this.state.automations.map((v, i) => i === idx ? { ...v, description: revertTo } : v)
            }
            this._descriptionBeforeEdit = undefined
            this.toastService.show({ title: 'Alias Required', content: 'This automation requires an alias when Strict aliases is enabled.', cssClass: 'e-toast-warning' })
            return
        }
        this._descriptionBeforeEdit = undefined
        this.state.automations = this.state.automations.map((v, i) => i === idx ? entry : v)
        if (previousId !== null && previousId !== entry.id) {
            this.selectedId = entry.id
            const aliasName = this.state.getPrimaryAliasNameForId(previousId, 'Automation')
            if (aliasName) this.state.syncAliasForId(previousId, entry.id, aliasName, 'Automation', aliasName)
            const violation = this.state.getSequenceIdViolations().find((v) => v.kind === 'Automation' && v.id === entry.id)
            if (violation) this.toastService.show({ title: 'Automation ID Warning', content: violation.reason, cssClass: 'e-toast-warning' })
        }
        this.state.syncAll()
    }
}
