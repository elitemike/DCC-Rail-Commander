import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { AliasEntry } from '../utils/myAutomationParser'
import { inferAliasTypes } from '../utils/myAutomationParser'

export class AliasesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null
    errorMessage = ''
    private lastValidAliases: AliasEntry[] = []

    private cloneAliases(aliases: AliasEntry[]): AliasEntry[] {
        return aliases.map(alias => ({ ...alias }))
    }

    attached(): void {
        try { console.debug('AliasesEditor attached') } catch { /* ignore */ }
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
    }

    setTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.aliasesRaw
        this.activeTab = t
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        const result = this.state.setAliasesFromRaw(text)
        if (result.ok) {
            this.errorMessage = ''
            this.lastValidAliases = this.cloneAliases(this.state.aliases)
        } else {
            this.errorMessage = result.reason
        }
    }

    addAlias() {
        this.state.aliases = [...this.state.aliases, { name: 'NEW_ALIAS', value: '' }]
        this.state.syncAll()
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
    }

    removeAlias(idx: number) {
        this.state.aliases = this.state.aliases.filter((_, i) => i !== idx)
        this.state.syncAll()
        this.errorMessage = ''
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
    }

    updateAlias(idx: number, a: AliasEntry) {
        const nextAliases = this.state.aliases.map((v, i) => i === idx ? { ...a } : v)
        const normalized = this.state.normalizeAliases(nextAliases)
        if (!normalized.ok) {
            this.errorMessage = normalized.reason
            this.state.aliases = this.cloneAliases(this.lastValidAliases)
            return
        }
        this.errorMessage = ''
        this.state.aliases = normalized.aliases
        this.state.syncAll()
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
    }

    commitAlias(idx: number): void {
        const alias = this.state.aliases[idx]
        if (!alias) return
        this.updateAlias(idx, alias)
    }

    getAliasTypeLabel(alias: AliasEntry): string {
        if (alias.aliasType) return alias.aliasType
        const types = inferAliasTypes(alias, {
            roster: this.state.roster,
            turnouts: this.state.turnouts,
            sensors: this.state.sensors,
            routes: this.state.routes,
            sequences: this.state.sequences,
        })
        return types.length > 0 ? types.join(', ') : 'Unmatched'
    }
}
