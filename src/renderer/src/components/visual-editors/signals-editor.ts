import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { SignalEntry } from '../../utils/myAutomationParser'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

type SignalKind = SignalEntry['type']

export class SignalsEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false
    rawEditor: any = null

    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session (_userChoseTab).
        this._applyDefaultViewIfUnset()
        try { console.debug('SignalsEditor attached') } catch { /* ignore */ }
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
        if (t === 'raw') this.rawSnapshot = this.state.signalsRaw
        this.activeTab = t
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setSignalsFromRaw(text)
    }

    readonly signalKinds: { value: SignalKind; label: string }[] = [
        { value: 'PIN', label: 'Pins (red/amber/green)' },
        { value: 'DCC', label: 'DCC accessory' },
    ]

    addSignal() {
        this.state.signals = [...this.state.signals, { type: 'PIN', red: 0, amber: 0, green: 0, description: '' }]
        this.state.syncAll()
    }

    removeSignal(idx: number) {
        this.state.signals = this.state.signals.filter((_, i) => i !== idx)
        this.state.syncAll()
    }

    updateSignal(idx: number, s: SignalEntry) {
        this.state.signals = this.state.signals.map((v, i) => i === idx ? { ...s } : v)
        this.state.syncAll()
    }

    /**
     * Switches a row's kind, converting to that kind's shape with fresh defaults for any
     * newly-required fields, preserving only `description` (PIN and DCC share no other field).
     */
    changeSignalType(idx: number, type: SignalKind): void {
        const current = this.state.signals[idx]
        if (!current || current.type === type) return
        const description = current.description
        const next: SignalEntry = type === 'DCC'
            ? { type: 'DCC', id: 0, addr: 0, subAddr: 0, description }
            : { type: 'PIN', red: 0, amber: 0, green: 0, description }
        this.updateSignal(idx, next)
    }

    /** Passed to <vpin-picker on-commit.bind>, which needs a zero-arg callback rather than an event to trigger. */
    makeSignalCommitHandler(idx: number): () => void {
        return () => this.updateSignal(idx, this.state.signals[idx])
    }
}
