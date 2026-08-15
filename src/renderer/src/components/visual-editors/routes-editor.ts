import { queueTask, resolve } from 'aurelia'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { RouteEntry } from '../../utils/myAutomationParser'
import { parseBody } from './exrail-block-compiler'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import type { DefinedObjects } from './exrail-block-compiler'

type RowTab = 'blocks' | 'text'

export class RoutesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null
    /** Ref to the mounted exrail-block-canvas — reused across route selections (see its reload() doc comment), so a selection change must explicitly push the new body into it. */
    blockCanvas: { reload(body: string): void } | null = null

    private splitterObj: Splitter | null = null
    /** Guards the queueTask() below — this component (or its #routes-splitter, gated behind activeTab === 'visual') can be torn down before the deferred Splitter creation runs, which would otherwise append a live widget into a detached/stale element and leave a broken splitterObj for detaching() to (potentially) throw on. */
    private _detached = false

    /** Explicit per-row Blocks/Text choice, keyed by route id — undefined falls back to canUseBlocks(). */
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

    getDisplayName(r: RouteEntry): string {
        return r.description ? `${r.description} (${r.id})` : `Route ${r.id}`
    }

    /** Reassigns `rowTab` rather than mutating in place — sequences-editor.ts's setRowTab has the same convention, for the same reason: this is a plain object on a class instance, not observed through Aurelia's dirty-checking of individual keys. */
    setRowTab(r: RouteEntry, tab: RowTab): void {
        this.rowTab = { ...this.rowTab, [r.id]: tab }
    }

    selectEntry(r: RouteEntry): void {
        this.selectedId = r.id
        this.blockCanvas?.reload(r.body)
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
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setRoutesFromRaw(text)
    }

    addRoute() {
        const nextId = (this.state.routes[this.state.routes.length - 1]?.id ?? 0) + 1
        this.state.routes = [...this.state.routes, { id: nextId, description: 'New Route', body: '' }]
        this.state.syncAll()
        this.selectedId = nextId
        this.blockCanvas?.reload('')
    }

    removeRoute(idx: number, event?: Event) {
        event?.stopPropagation()
        const removedId = this.state.routes[idx]?.id
        this.state.routes = this.state.routes.filter((_, i) => i !== idx)
        this.state.syncAll()
        if (this.selectedId === removedId) {
            this.selectedId = this.state.routes[0]?.id ?? null
            this.blockCanvas?.reload(this.selectedRoute?.body ?? '')
        }
    }

    updateRoute(idx: number, r: RouteEntry) {
        this.state.routes = this.state.routes.map((v, i) => i === idx ? { ...r } : v)
        this.state.syncAll()
    }
}
