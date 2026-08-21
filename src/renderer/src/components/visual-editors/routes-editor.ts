import { queueTask, resolve } from 'aurelia'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { RouteEntry } from '../../utils/myAutomationParser'
import { parseBody } from './exrail-block-compiler'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import type { DefinedObjects } from './exrail-block-compiler'
import { ToastService } from '../../services/toast.service'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type RowTab = 'blocks' | 'text'

export class RoutesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly toastService = resolve(ToastService)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null
    /** Ref to the mounted exrail-block-canvas — reused across route selections (see its reload() doc comment), so a selection change must explicitly push the new body into it. */
    blockCanvas: { reload(body: string): void; refreshSize(): void } | null = null
    /** Ref to the per-row Raw Monaco editor — reused across row selections via switchModel(), same reasoning as blockCanvas above. */
    rowRawEditor: { flush(): string; switchModel(filename: string, value: string): void } | null = null

    private splitterObj: Splitter | null = null
    /** Guards the queueTask() below — this component (or its #routes-splitter, gated behind activeTab === 'visual') can be torn down before the deferred Splitter creation runs, which would otherwise append a live widget into a detached/stale element and leave a broken splitterObj for detaching() to (potentially) throw on. */
    private _detached = false

    /** Explicit per-row Blocks/Text choice, keyed by route id — undefined falls back to canUseBlocks(). */
    private rowTab: Record<number, RowTab> = {}

    selectedId: number | null = null

    constructor() {
        // Route through setTab() (rather than seeding activeTab directly) so a
        // 'raw' default also gets rawSnapshot populated from state — otherwise
        // the raw Monaco editor would open empty, since that only ever happens
        // as a side effect of setTab('raw').
        if (this.editorDefaultView.value === 'raw') this.setTab('raw')
    }

    get defined(): DefinedObjects {
        return {
            roster: this.state.roster,
            turnouts: this.state.turnouts,
            sensors: this.state.sensors,
            signals: this.state.signals,
            routes: this.state.routes,
            sequences: this.state.sequences,
            aliases: this.state.aliases,
        }
    }

    get selectedRoute(): RouteEntry | null {
        if (this.selectedId === null) return null
        return this.state.routes.find((r) => r.id === this.selectedId) ?? null
    }

    get selectedTab(): RowTab {
        const r = this.selectedRoute
        if (!r) return 'blocks'
        return this.rowTab[r.id] || (this.canUseBlocks(r) ? 'blocks' : 'text')
    }

    canUseBlocks(r: RouteEntry): boolean {
        return parseBody(r.body, 'route', BLOCK_REGISTRY).ok
    }

    private static readonly ROUTE_HEADER_RE = /^ROUTE\s*\(\s*\d+\s*,\s*"([^"]*)"\s*\)\s*$/

    /**
     * The Text tab's textarea binds to this (not `selectedRoute.body` directly) so the
     * ROUTE(id, "desc") header line is part of the actual editable/selectable text, matching the
     * Blocks tab's hat node — not a separate read-only caption sitting outside the text control.
     * The id itself stays whatever `selectedRoute.id` already is; only the quoted description on
     * that first line is round-tripped.
     */
    get selectedRouteText(): string {
        const r = this.selectedRoute
        if (!r) return ''
        return `ROUTE(${r.id}, "${r.description ?? ''}")\n${r.body ?? ''}`
    }

    set selectedRouteText(text: string) {
        const r = this.selectedRoute
        if (!r) return
        const lines = text.split('\n')
        const m = lines[0]?.match(RoutesEditorCustomElement.ROUTE_HEADER_RE)
        if (m) {
            r.description = m[1]
            r.body = lines.slice(1).join('\n')
        } else {
            // Header line got mangled/removed — don't discard what the user typed; keep the
            // last-known description and fall back to treating everything as body.
            r.body = text
        }
    }

    getDisplayName(r: RouteEntry): string {
        return r.description ? `${r.description} (${r.id})` : `Route ${r.id}`
    }

    /** Alias pushed into the Blocks tab's hat block via <exrail-block-canvas header-alias.bind> —
     *  see exrail-block-canvas.ts's headerId/headerAlias bindables. */
    get selectedRouteAlias(): string {
        const r = this.selectedRoute
        return r ? this.state.getPrimaryAliasNameForId(r.id, 'Route') : ''
    }

    /** Reassigns `rowTab` rather than mutating in place — sequences-editor.ts's setRowTab has the same convention, for the same reason: this is a plain object on a class instance, not observed through Aurelia's dirty-checking of individual keys. */
    setRowTab(r: RouteEntry, tab: RowTab): void {
        if (tab === 'text') this.rowRawSnapshot = this.selectedRouteText
        this.rowTab = { ...this.rowTab, [r.id]: tab }
    }

    /** Synthetic per-row Monaco filename — disambiguates this row's scoped model from the whole-file `myRoutes.h` model owned by the Raw tab below, while still being recognized as EXRAIL content (see baseFilename() in exrail-completions.ts). */
    get rowRawFilename(): string {
        return this.selectedId !== null ? `myRoutes.h#${this.selectedId}` : 'myRoutes.h'
    }

    rowRawSnapshot = ''

    /** Arrow field (not a template `.call` expression) so it stays a stable function reference across
     *  re-renders, matching `onRawChange` above — delegates to a plain method so the state-mutation
     *  logic itself is directly callable/testable without needing this arrow's `this` capture. */
    onRowRawChange = (text: string) => this.applyRowRawChange(text)

    applyRowRawChange(text: string): void {
        this.rowRawSnapshot = text
        this.selectedRouteText = text
        const r = this.selectedRoute
        if (r) this.updateRoute(this.state.routes.indexOf(r), r)
    }

    /** Flushes both the whole-file and per-row Raw Monaco editors — called by file-editor-panel.ts before save/tab-switch so an edit still sitting in Monaco's 300ms debounce isn't lost. */
    flushPending(): void {
        this.rawEditor?.flush()
        this.rowRawEditor?.flush()
    }

    selectEntry(r: RouteEntry): void {
        // Flush the outgoing row's pending edit while selectedId still points at it —
        // switchModel() below also flushes, but only after selectedId has already moved,
        // which would misattribute the old row's edit to the new one via onRowRawChange.
        this.rowRawEditor?.flush()
        this.selectedId = r.id
        this.blockCanvas?.reload(r.body)
        this.rowRawSnapshot = this.selectedRouteText
        this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
    }

    /** Looks the route up by id at call time rather than closing over `r` — updateRoute() replaces the routes array with new entry objects on every call, so a captured `r` reference goes stale after the first edit. */
    makeBodyChangeHandler(routeId: number): (body: string) => void {
        return (body: string) => {
            const idx = this.state.routes.findIndex((v) => v.id === routeId)
            if (idx === -1) return
            this.updateRoute(idx, { ...this.state.routes[idx], body })
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    attached(): void {
        this._detached = false
        if (this.selectedId === null && this.state.routes.length > 0) {
            this.selectedId = this.state.routes[0].id
        }
        queueTask(() => {
            if (this._detached || !document.getElementById('routes-splitter')) return
            const savedWidth = this._loadSidebarWidth()
            this.splitterObj = new Splitter({
                paneSettings: [
                    { size: savedWidth, min: '200px', max: '600px' },
                    {},
                ],
                width: '100%',
                height: '100%',
                resizeStop: () => {
                    const pane = document.querySelector('#routes-splitter > div:first-child') as HTMLElement
                    if (pane) this._saveSidebarWidth(`${pane.offsetWidth}px`)
                },
            })
            this.splitterObj.appendTo('#routes-splitter')
        })
    }

    detaching(): void {
        this._detached = true
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.splitterObj = null
    }

    private _loadSidebarWidth(): string {
        try { return localStorage.getItem('routes-editor-sidebar-width') ?? '256px' } catch { return '256px' }
    }
    private _saveSidebarWidth(size: string): void {
        try { localStorage.setItem('routes-editor-sidebar-width', size) } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.routesRaw
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
        this.state.setRoutesFromRaw(text)
    }

    addRoute() {
        this.rowRawEditor?.flush()
        const nextId = this.state.nextSequenceId
        this.state.routes = [...this.state.routes, { id: nextId, description: 'New Route', body: '' }]
        this.state.syncAll()
        this.selectedId = nextId
        this.blockCanvas?.reload('')
        this.rowRawSnapshot = this.selectedRouteText
        this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
    }

    removeRoute(idx: number, event?: Event) {
        event?.stopPropagation()
        const removedId = this.state.routes[idx]?.id
        this.state.routes = this.state.routes.filter((_, i) => i !== idx)
        this.state.syncAll()
        if (this.selectedId === removedId) {
            this.selectedId = this.state.routes[0]?.id ?? null
            this.blockCanvas?.reload(this.selectedRoute?.body ?? '')
            this.rowRawSnapshot = this.selectedRouteText
            this.rowRawEditor?.switchModel(this.rowRawFilename, this.rowRawSnapshot)
        }
    }

    /** Passed to <exrail-block-canvas on-id-change.bind>. Looks the route up by id at call time,
     *  same reasoning as makeBodyChangeHandler() above. */
    makeIdChangeHandler(routeId: number): (id: number) => void {
        return (id: number) => {
            const idx = this.state.routes.findIndex((v) => v.id === routeId)
            if (idx === -1) return
            this.updateRoute(idx, { ...this.state.routes[idx], id })
        }
    }

    /** Passed to <exrail-block-canvas on-alias-change.bind>. Mirrors sequences-editor.ts's makeAliasChangeHandler. */
    makeAliasChangeHandler(routeId: number): (name: string) => void {
        return (name: string) => {
            const existingAliasName = this.state.getPrimaryAliasNameForId(routeId, 'Route')
            const result = this.state.syncAliasForId(routeId, routeId, name, 'Route', existingAliasName)
            if (!result.ok) {
                this.toastService.show({ title: 'Alias Error', content: result.reason, cssClass: 'e-toast-warning' })
            }
        }
    }

    updateRoute(idx: number, r: RouteEntry) {
        // `value.two-way` on `<input type="text">` (description) round-trips through the DOM's
        // `.value`, always a string, but `id` comes from makeIdChangeHandler()'s already-numeric
        // callback param — Number() here is a no-op for that path and just guards the description-
        // only path, where `r` is a spread of the existing (already-numeric) entry.
        const entry: RouteEntry = { ...r, id: Number(r.id) }
        const previousId = this.state.routes[idx]?.id ?? null
        this.state.routes = this.state.routes.map((v, i) => i === idx ? entry : v)
        if (previousId !== null && previousId !== entry.id) {
            this.selectedId = entry.id
            const aliasName = this.state.getPrimaryAliasNameForId(previousId, 'Route')
            if (aliasName) this.state.syncAliasForId(previousId, entry.id, aliasName, 'Route', aliasName)
            const violation = this.state.getSequenceIdViolations().find((v) => v.kind === 'Route' && v.id === entry.id)
            if (violation) this.toastService.show({ title: 'Route ID Warning', content: violation.reason, cssClass: 'e-toast-warning' })
        }
        this.state.syncAll()
    }
}
