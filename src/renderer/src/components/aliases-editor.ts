import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { AliasEntry } from '../utils/myAutomationParser'

export class AliasesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null

    attached(): void {
        try { console.debug('AliasesEditor attached') } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.aliasesRaw
        this.activeTab = t
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setAliasesFromRaw(text)
    }

    addAlias() {
        this.state.aliases = [...this.state.aliases, { name: 'NEW_ALIAS', value: '' }]
        this.state.syncAll()
    }

    removeAlias(idx: number) {
        this.state.aliases = this.state.aliases.filter((_, i) => i !== idx)
        this.state.syncAll()
    }

    updateAlias(idx: number, a: AliasEntry) {
        this.state.aliases = this.state.aliases.map((v, i) => i === idx ? { ...a } : v)
        this.state.syncAll()
    }
}
