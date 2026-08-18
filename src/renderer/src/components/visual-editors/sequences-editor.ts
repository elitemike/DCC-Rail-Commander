import { queueTask, resolve } from 'aurelia'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { SequenceEntry } from '../../utils/myAutomationParser'
import { parseBody } from './exrail-block-compiler'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import type { DefinedObjects } from './exrail-block-compiler'
import { ToastService } from '../../services/toast.service'

type RowTab = 'blocks' | 'text'

export class SequencesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly toastService = resolve(ToastService)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null
    /** Ref to the mounted exrail-block-canvas — reused across sequence selections (see its reload() doc comment), so a selection change must explicitly push the new body into it. */
    blockCanvas: { reload(body: string): void } | null = null

    private splitterObj: Splitter | null = null
    /** Guards the queueTask() below — this component (or its #sequences-splitter, gated behind activeTab === 'visual') can be torn down before the deferred Splitter creation runs, which would otherwise append a live widget into a detached/stale element and leave a broken splitterObj for detaching() to (potentially) throw on. */
    private _detached = false

    /** Explicit per-row Blocks/Text choice, keyed by sequence id — undefined falls back to canUseBlocks(). */
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

    get selectedSequence(): SequenceEntry | null {
        if (this.selectedId === null) return null
        return this.state.sequences.find((s) => s.id === this.selectedId) ?? null
    }

    get selectedTab(): RowTab {
        const s = this.selectedSequence
        if (!s) return 'blocks'
        return this.rowTab[s.id] || (this.canUseBlocks(s) ? 'blocks' : 'text')
    }

    canUseBlocks(s: SequenceEntry): boolean {
        return parseBody(s.body, 'sequence', BLOCK_REGISTRY).ok
    }

    private static readonly SEQ_HEADER_RE = /^SEQUENCE\s*\(\s*\d+\s*\)\s*(?:\/\/\s*(.*))?$/

    /**
     * The Text tab's textarea binds to this (not `selectedSequence.body` directly) so the
     * SEQUENCE(id) header line is part of the actual editable/selectable text, matching the
     * Blocks tab's hat node — not a separate read-only caption sitting outside the text control.
     * The id itself stays whatever `selectedSequence.id` already is; only the trailing
     * `// description` comment on that first line is round-tripped.
     */
    get selectedSequenceText(): string {
        const s = this.selectedSequence
        if (!s) return ''
        const desc = s.description && s.description.trim() ? ` // ${s.description.trim()}` : ''
        return `SEQUENCE(${s.id})${desc}\n${s.body ?? ''}`
    }

    set selectedSequenceText(text: string) {
        const s = this.selectedSequence
        if (!s) return
        const lines = text.split('\n')
        const m = lines[0]?.match(SequencesEditorCustomElement.SEQ_HEADER_RE)
        if (m) {
            s.description = m[1] ? m[1].trim() : ''
            s.body = lines.slice(1).join('\n')
        } else {
            // Header line got mangled/removed — don't discard what the user typed; keep the
            // last-known description and fall back to treating everything as body.
            s.body = text
        }
    }

    getDisplayName(s: SequenceEntry): string {
        return s.description ? `${s.description} (${s.id})` : `Sequence ${s.id}`
    }

    /** Reassigns `rowTab` rather than mutating in place — routes-editor.ts's setRowTab has the same convention, for the same reason: this is a plain object on a class instance, not observed through Aurelia's dirty-checking of individual keys. */
    setRowTab(s: SequenceEntry, tab: RowTab): void {
        this.rowTab = { ...this.rowTab, [s.id]: tab }
    }

    selectEntry(s: SequenceEntry): void {
        this.selectedId = s.id
        this.blockCanvas?.reload(s.body)
    }

    /** Looks the sequence up by id at call time rather than closing over `s` — updateSequence() replaces the sequences array with new entry objects on every call, so a captured `s` reference goes stale after the first edit. */
    makeBodyChangeHandler(sequenceId: number): (body: string) => void {
        return (body: string) => {
            const idx = this.state.sequences.findIndex((v) => v.id === sequenceId)
            if (idx === -1) return
            this.updateSequence(idx, { ...this.state.sequences[idx], body })
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    attached(): void {
        this._detached = false
        if (this.selectedId === null && this.state.sequences.length > 0) {
            this.selectedId = this.state.sequences[0].id
        }
        queueTask(() => {
            if (this._detached || !document.getElementById('sequences-splitter')) return
            const savedWidth = this._loadSidebarWidth()
            this.splitterObj = new Splitter({
                paneSettings: [
                    { size: savedWidth, min: '200px', max: '600px' },
                    {},
                ],
                width: '100%',
                height: '100%',
                resizeStop: () => {
                    const pane = document.querySelector('#sequences-splitter > div:first-child') as HTMLElement
                    if (pane) this._saveSidebarWidth(`${pane.offsetWidth}px`)
                },
            })
            this.splitterObj.appendTo('#sequences-splitter')
        })
    }

    detaching(): void {
        this._detached = true
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.splitterObj = null
    }

    private _loadSidebarWidth(): string {
        try { return localStorage.getItem('sequences-editor-sidebar-width') ?? '256px' } catch { return '256px' }
    }
    private _saveSidebarWidth(size: string): void {
        try { localStorage.setItem('sequences-editor-sidebar-width', size) } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.sequencesRaw
        this.activeTab = t
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setSequencesFromRaw(text)
    }

    addSequence() {
        const nextId = (this.state.sequences[this.state.sequences.length - 1]?.id ?? 0) + 1
        this.state.sequences = [...this.state.sequences, { id: nextId, description: 'New Sequence', body: '' }]
        this.state.syncAll()
        this.selectedId = nextId
        this.blockCanvas?.reload('')
    }

    removeSequence(idx: number, event?: Event) {
        event?.stopPropagation()
        const removedId = this.state.sequences[idx]?.id
        this.state.sequences = this.state.sequences.filter((_, i) => i !== idx)
        this.state.syncAll()
        if (this.selectedId === removedId) {
            this.selectedId = this.state.sequences[0]?.id ?? null
            this.blockCanvas?.reload(this.selectedSequence?.body ?? '')
        }
    }

    updateSequence(idx: number, s: SequenceEntry) {
        this.state.sequences = this.state.sequences.map((v, i) => i === idx ? { ...s } : v)
        this.state.syncAll()
    }

    /** Passed to <alias-picker on-change.bind>. Sequence ids aren't user-editable (unlike sensors' inline id field), so there's no rename to carry forward — just persist the chosen name against the current id. */
    makeAliasChangeHandler(sequenceId: number): (name: string) => void {
        return (name: string) => {
            const existingAliasName = this.state.getPrimaryAliasNameForId(sequenceId, 'Sequence')
            const result = this.state.syncAliasForId(sequenceId, sequenceId, name, 'Sequence', existingAliasName)
            if (!result.ok) {
                this.toastService.show({ title: 'Alias Error', content: result.reason, cssClass: 'e-toast-warning' })
            }
        }
    }
}
