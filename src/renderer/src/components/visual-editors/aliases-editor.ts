import { resolve } from 'aurelia'
import { DropDownList } from '@syncfusion/ej2-dropdowns'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { AliasEntry, AliasTargetType } from '../../utils/myAutomationParser'
import { inferAliasTypes } from '../../utils/myAutomationParser'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

const ALIAS_TYPE_OPTIONS: { text: string; value: AliasTargetType }[] = [
    { text: 'Roster', value: 'Roster' },
    { text: 'Turnout', value: 'Turnout' },
    { text: 'Sensor', value: 'Sensor' },
    { text: 'Route', value: 'Route' },
    { text: 'Sequence', value: 'Sequence' },
    { text: 'Automation', value: 'Automation' },
]

export class AliasesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false
    rawEditor: any = null
    errorMessage = ''
    private lastValidAliases: AliasEntry[] = []

    readonly aliasTypeOptions = ALIAS_TYPE_OPTIONS

    newAliasTypeEl!: HTMLInputElement
    newAliasIdEl!: HTMLInputElement
    private sfNewAliasType?: DropDownList
    private sfNewAliasId?: DropDownList

    private cloneAliases(aliases: AliasEntry[]): AliasEntry[] {
        return aliases.map(alias => ({ ...alias }))
    }

    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session (_userChoseTab).
        this._applyDefaultViewIfUnset()
        try { console.debug('AliasesEditor attached') } catch { /* ignore */ }
        this.lastValidAliases = this.cloneAliases(this.state.aliases)

        this.sfNewAliasType = new DropDownList({
            dataSource: [...ALIAS_TYPE_OPTIONS],
            fields: { text: 'text', value: 'value' },
            value: this.newAliasType,
            change: (args) => {
                this.newAliasType = (args.value as AliasTargetType) ?? 'Roster'
                this.newAliasId = null
                this.newAliasError = ''
                if (this.sfNewAliasId) {
                    this.sfNewAliasId.dataSource = this.state.getAvailableAliasTargetIds(this.newAliasType)
                    this.sfNewAliasId.value = null
                }
            },
        })
        this.sfNewAliasType.appendTo(this.newAliasTypeEl)

        this.sfNewAliasId = new DropDownList({
            dataSource: this.state.getAvailableAliasTargetIds(this.newAliasType),
            fields: { text: 'label', value: 'id' },
            placeholder: 'Select an ID…',
            // Refreshed lazily right before the popup opens — an alias added/removed
            // elsewhere doesn't otherwise notify this SF widget that its dataSource
            // (which IDs are still unaliased) is stale. Same pattern as throttle-panel's
            // roster picker.
            open: () => {
                if (this.sfNewAliasId) this.sfNewAliasId.dataSource = this.state.getAvailableAliasTargetIds(this.newAliasType)
            },
            change: (args) => {
                this.newAliasId = typeof args.value === 'number' ? args.value : null
            },
        })
        this.sfNewAliasId.appendTo(this.newAliasIdEl)
    }

    detaching(): void {
        this.sfNewAliasType?.destroy()
        this.sfNewAliasId?.destroy()
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

    // ── New-alias mini form ────────────────────────────────────────────────
    // Kept separate from state.aliases until both fields validate, so a
    // still-being-typed name/value pair is never mid-air invalid inside the
    // live editor list (which every row's blur handler re-validates in full).
    newAliasName = ''
    newAliasType: AliasTargetType = 'Roster'
    newAliasId: number | null = null
    newAliasError = ''

    addAlias(): void {
        if (this.newAliasId == null) {
            this.newAliasError = `Select a ${this.newAliasType} ID to alias.`
            return
        }
        const candidate: AliasEntry = { name: this.newAliasName.trim(), value: String(this.newAliasId), aliasType: this.newAliasType }
        const normalized = this.state.normalizeAliases([...this.state.aliases, candidate])
        if (!normalized.ok) {
            this.newAliasError = normalized.reason
            return
        }
        this.newAliasError = ''
        this.state.aliases = normalized.aliases
        this.state.syncAll()
        this.lastValidAliases = this.cloneAliases(this.state.aliases)
        this.newAliasName = ''
        this.newAliasId = null
        if (this.sfNewAliasId) {
            this.sfNewAliasId.dataSource = this.state.getAvailableAliasTargetIds(this.newAliasType)
            this.sfNewAliasId.value = null
        }
    }

    handleNewAliasKeydown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter') { this.addAlias(); return false }
        return true
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

    /** Aliases grouped by inferred/declared type, sorted alphabetically by group label, and by name within each group. Each item keeps its index into state.aliases so edit/remove handlers can target it directly. */
    get groupedAliases(): { label: string; items: { alias: AliasEntry; index: number }[] }[] {
        const groups = new Map<string, { alias: AliasEntry; index: number }[]>()
        this.state.aliases.forEach((alias, index) => {
            const label = this.getAliasTypeLabel(alias)
            const items = groups.get(label)
            if (items) items.push({ alias, index })
            else groups.set(label, [{ alias, index }])
        })
        return Array.from(groups.entries())
            .map(([label, items]) => ({
                label,
                items: items.slice().sort((a, b) => a.alias.name.localeCompare(b.alias.name)),
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
    }
}
