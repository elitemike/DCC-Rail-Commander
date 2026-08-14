import { resolve } from 'aurelia'
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

    /** Explicit per-row Blocks/Text choice, keyed by route id — undefined falls back to canUseBlocks(). */
    private rowTab: Record<number, RowTab> = {}

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

    canUseBlocks(r: RouteEntry): boolean {
        return parseBody(r.body, 'route', BLOCK_REGISTRY).ok
    }

    /**
     * Reassigns `rowTab` (rather than mutating the existing object in place) so
     * Aurelia's property observer on `rowTab` actually fires — template bindings
     * read `rowTab[r.id]` directly (not through a method call) specifically so
     * they get real Observer-based reactivity instead of Aurelia's dirty-check
     * fallback, which doesn't reach into method-call expressions. See
     * memory/aurelia_method_call_binding_not_reactive.md.
     */
    setRowTab(r: RouteEntry, tab: RowTab): void {
        this.rowTab = { ...this.rowTab, [r.id]: tab }
    }

    /** Looks the route up by id at call time rather than closing over `r` — updateRoute() replaces the routes array with new entry objects on every call, so a captured `r` reference goes stale after the first edit. */
    makeBodyChangeHandler(routeId: number): (body: string) => void {
        return (body: string) => {
            const idx = this.state.routes.findIndex((v) => v.id === routeId)
            if (idx === -1) return
            this.updateRoute(idx, { ...this.state.routes[idx], body })
        }
    }

    attached(): void {
        try { console.debug('RoutesEditor attached') } catch { /* ignore */ }
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
    }

    removeRoute(idx: number) {
        this.state.routes = this.state.routes.filter((_, i) => i !== idx)
        this.state.syncAll()
    }

    updateRoute(idx: number, r: RouteEntry) {
        this.state.routes = this.state.routes.map((v, i) => i === idx ? { ...r } : v)
        this.state.syncAll()
    }
}
