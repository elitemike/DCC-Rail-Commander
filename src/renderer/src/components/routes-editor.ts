import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { RouteEntry } from '../utils/myAutomationParser'

export class RoutesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null

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
