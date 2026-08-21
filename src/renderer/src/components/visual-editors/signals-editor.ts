import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { SignalEntry } from '../../utils/myAutomationParser'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

export class SignalsEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null

    constructor() {
        // Route through setTab() (rather than seeding activeTab directly) so a
        // 'raw' default also gets rawSnapshot populated from state — otherwise
        // the raw Monaco editor would open empty, since that only ever happens
        // as a side effect of setTab('raw').
        if (this.editorDefaultView.value === 'raw') this.setTab('raw')
    }

    attached(): void {
        try { console.debug('SignalsEditor attached') } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        if (t === 'raw') this.rawSnapshot = this.state.signalsRaw
        this.activeTab = t
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setSignalsFromRaw(text)
    }

    addSignal() {
        this.state.signals = [...this.state.signals, { red: 0, amber: 0, green: 0, description: '' }]
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

    /** Passed to <vpin-picker on-commit.bind>, which needs a zero-arg callback rather than an event to trigger. */
    makeSignalCommitHandler(idx: number): () => void {
        return () => this.updateSignal(idx, this.state.signals[idx])
    }
}
