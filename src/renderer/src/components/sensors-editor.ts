import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { SensorEntry } from '../utils/myAutomationParser'

export class SensorsEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    activeTab: 'visual' | 'raw' = 'visual'
    // Reference set via `component.ref="rawEditor"` in the template
    rawEditor: any = null

    attached(): void {
        try { console.debug('SensorsEditor attached') } catch { /* ignore */ }
    }

    setTab(t: 'visual' | 'raw') {
        if (t === 'raw') {
            this.rawSnapshot = this.state.sensorsRaw
        }
        this.activeTab = t
        // Ensure Monaco lays out once visible
        if (t === 'raw') setTimeout(() => { try { this.rawEditor?.editor?.layout?.() } catch { } }, 50)
    }

    rawSnapshot = ''

    onRawChange = (text: string) => {
        this.rawSnapshot = text
        this.state.setSensorsFromRaw(text)
    }

    addSensor() {
        const nextId = (this.state.sensors[this.state.sensors.length - 1]?.id ?? 0) + 1
        this.state.sensors = [...this.state.sensors, { id: nextId, pin: 0, description: 'New Sensor' }]
        this.state.syncAll()
    }

    removeSensor(idx: number) {
        this.state.sensors = this.state.sensors.filter((_, i) => i !== idx)
        this.state.syncAll()
    }

    updateSensor(idx: number, s: SensorEntry) {
        this.state.sensors = this.state.sensors.map((v, i) => i === idx ? { ...s } : v)
        this.state.syncAll()
    }
}
