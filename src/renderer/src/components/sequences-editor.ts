import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { SequenceEntry } from '../utils/myAutomationParser'

export class SequencesEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    activeTab: 'visual' | 'raw' = 'visual'
    rawEditor: any = null

    attached(): void {
        try { console.debug('SequencesEditor attached') } catch { /* ignore */ }
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
        this.state.sequences = [...this.state.sequences, { id: nextId, body: '' }]
        this.state.syncAll()
    }

    removeSequence(idx: number) {
        this.state.sequences = this.state.sequences.filter((_, i) => i !== idx)
        this.state.syncAll()
    }

    updateSequence(idx: number, s: SequenceEntry) {
        this.state.sequences = this.state.sequences.map((v, i) => i === idx ? { ...s } : v)
        this.state.syncAll()
    }
}
