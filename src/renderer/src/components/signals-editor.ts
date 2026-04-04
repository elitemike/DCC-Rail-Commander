import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { SignalEntry } from '../utils/myAutomationParser'

export class SignalsEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null

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
}
