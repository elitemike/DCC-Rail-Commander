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
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false
    // Reference set via `component.ref="rawEditor"` in the template
    rawEditor: any = null

    /**
     * A sensor's `id` IS its VPin (real EXRAIL has no separate declaration id — see
     * myAutomationParser.ts's SensorEntry doc), so it's edited via <vpin-picker>, whose
     * `value.two-way` mutates `state.sensors[i].id` live as soon as a board/channel is
     * picked — by the time `updateSensor` fires (on-commit), `s.id` already holds the new
     * value. `captureRowBeforeEdit`'s `focusin` on the row captures the old id before that
     * happens, so a rename can carry its alias (state.aliases) forward.
     */
    private readonly _idBeforeEdit = new Map<number, number>()

    /**
     * Snapshot of a row's full entry, captured on `focusin` of the row (before any
     * field's `value.two-way` binding has a chance to mutate it live). Because id/description
     * bind two-way directly onto `state.sensors[idx]` (no edit-buffer, unlike turnout/roster
     * editors), a blocked strict-aliases commit in updateSensor() must explicitly revert to
     * this snapshot — otherwise the DOM edit the user just typed is already live in the model
     * regardless of whether updateSensor() "applies" it.
     */
    private readonly _rowBeforeEdit = new Map<number, SensorEntry>()

    /** `focusin.trigger` on the row container. Only the first focus in an edit session
     *  captures a snapshot; later focuses within the same uncommitted session must not
     *  overwrite it with an already-live-mutated value. Captures both `_rowBeforeEdit` and
     *  `_idBeforeEdit` together since they're both "value before this edit session began". */
    captureRowBeforeEdit(idx: number): void {
        if (this._rowBeforeEdit.has(idx)) return
        const s = this.state.sensors[idx]
        if (!s) return
        this._rowBeforeEdit.set(idx, { ...s })
        this._idBeforeEdit.set(idx, s.id)
    }

    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session (_userChoseTab).
        this._applyDefaultViewIfUnset()
        try { console.debug('SensorsEditor attached') } catch { /* ignore */ }
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
        this.state.sensors = [...this.state.sensors, { id: this.state.nextFreeVpin, description: 'New Sensor' }]
        this.state.syncAll()
    }

    removeSensor(idx: number) {
        this.state.sensors = this.state.sensors.filter((_, i) => i !== idx)
        this.state.syncAll()
    }

    updateSensor(idx: number, s: SensorEntry) {
        // `value.two-way` on <vpin-picker> and `<input type="number">` round-trips through the
        // DOM's `.value`, which is always a string — coerce back so strict-equality lookups
        // elsewhere (alias id matching, EXRAIL reference validation) don't silently fail to
        // match a numeric target.
        const entry: SensorEntry = { ...s, id: Number(s.id) }
        // Strict aliases: block *any* field save on a sensor that currently has no
        // alias, not just alias edits themselves — set one via the alias-picker
        // first, which goes through makeAliasChangeHandler()/syncAliasForId() below
        // and is unaffected by this gate. Checked by the *pre-edit* id when an id
        // change is in flight — the alias-carry-forward below hasn't run yet, so
        // the alias (if any) still lives on the old id at this point.
        const aliasLookupId = this._idBeforeEdit.get(idx) ?? entry.id
        if (this.state.strictAliases && !this.state.getPrimaryAliasNameForId(aliasLookupId, 'Sensor')) {
            // The field(s) the user just edited are already live in state.sensors[idx]
            // (two-way binding, not an edit-buffer) — revert to the pre-edit snapshot so
            // the block actually takes visible effect, not just skips syncAll()/alias-carry.
            const snapshot = this._rowBeforeEdit.get(idx)
            if (snapshot) this.state.sensors = this.state.sensors.map((v, i) => i === idx ? { ...snapshot } : v)
            this._rowBeforeEdit.delete(idx)
            this._idBeforeEdit.delete(idx)
            this.toastService.show({ title: 'Alias Required', content: 'This sensor requires an alias when Strict aliases is enabled.', cssClass: 'e-toast-warning' })
            return
        }
        this._rowBeforeEdit.delete(idx)
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
