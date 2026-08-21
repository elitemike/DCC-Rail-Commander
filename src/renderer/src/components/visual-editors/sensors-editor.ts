import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { SensorEntry } from '../../utils/myAutomationParser'
import { ToastService } from '../../services/toast.service'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

export class SensorsEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly toastService = resolve(ToastService)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)
    activeTab: 'visual' | 'raw' = 'visual'
    // Reference set via `component.ref="rawEditor"` in the template
    rawEditor: any = null

    constructor() {
        // Route through setTab() (rather than seeding activeTab directly) so a
        // 'raw' default also gets rawSnapshot populated from state — otherwise
        // the raw Monaco editor would open empty, since that only ever happens
        // as a side effect of setTab('raw').
        if (this.editorDefaultView.value === 'raw') this.setTab('raw')
    }

    /**
     * Sensor rows bind straight to `state.sensors[i]` and mutate it live as
     * the user types (two-way `value.two-way`), so by the time `updateSensor`
     * fires on blur, `s.id` already holds the new value. Capture the old id
     * on focus so a rename can carry its alias (state.aliases) forward —
     * mirrors what the turnout/roster editors get for free from their
     * edit-buffer pattern.
     */
    private readonly _idBeforeEdit = new Map<number, number>()

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
        this.state.sensors = [...this.state.sensors, { id: nextId, pin: this.state.nextFreeVpin, description: 'New Sensor' }]
        this.state.syncAll()
    }

    removeSensor(idx: number) {
        this.state.sensors = this.state.sensors.filter((_, i) => i !== idx)
        this.state.syncAll()
    }

    updateSensor(idx: number, s: SensorEntry) {
        // `value.two-way` on `<input type="number">` round-trips through the DOM's
        // `.value`, which is always a string — coerce back so strict-equality
        // lookups elsewhere (alias id matching, EXRAIL reference validation)
        // don't silently fail to match a numeric target.
        const entry: SensorEntry = { ...s, id: Number(s.id), pin: Number(s.pin) }
        const previousId = this._idBeforeEdit.get(idx)
        this._idBeforeEdit.delete(idx)
        this.state.sensors = this.state.sensors.map((v, i) => i === idx ? entry : v)
        if (previousId !== undefined && previousId !== entry.id) {
            const aliasName = this.state.getPrimaryAliasNameForId(previousId, 'Sensor')
            if (aliasName) this.state.syncAliasForId(previousId, entry.id, aliasName, 'Sensor', aliasName)
        }
        this.state.syncAll()
    }

    /** Passed to <vpin-picker on-commit.bind>, which needs a zero-arg callback rather than an event to trigger. */
    makeSensorCommitHandler(idx: number): () => void {
        return () => this.updateSensor(idx, this.state.sensors[idx])
    }

    /** `focus.trigger` on the ID input — see `_idBeforeEdit`. */
    captureIdBeforeEdit(idx: number): void {
        const s = this.state.sensors[idx]
        if (s) this._idBeforeEdit.set(idx, s.id)
    }

    /** Passed to <alias-picker on-change.bind>. */
    makeAliasChangeHandler(idx: number): (name: string) => void {
        return (name: string) => {
            const s = this.state.sensors[idx]
            if (!s) return
            const existingAliasName = this.state.getPrimaryAliasNameForId(s.id, 'Sensor')
            const result = this.state.syncAliasForId(s.id, s.id, name, 'Sensor', existingAliasName)
            if (!result.ok) {
                this.toastService.show({ title: 'Alias Error', content: result.reason, cssClass: 'e-toast-warning' })
            }
        }
    }
}
