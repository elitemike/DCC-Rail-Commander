import { describe, it, expect } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import { SensorsEditorCustomElement } from '../../src/renderer/src/components/visual-editors/sensors-editor'
import { SignalsEditorCustomElement } from '../../src/renderer/src/components/visual-editors/signals-editor'
import { RoutesEditorCustomElement } from '../../src/renderer/src/components/visual-editors/routes-editor'
import { AutomationEditorCustomElement } from '../../src/renderer/src/components/visual-editors/automation-editor'

// ── Factory ───────────────────────────────────────────────────────────────────
// Real ConfigEditorState instance (not a mock) so these tests catch the actual
// wiring bug: visual-editor mutations that update `state.sensors`/etc. but
// never flip `hasChanges`, leaving the Save button's dirty indicator wrong.
// Built like workspace.test.ts / roster-editor.test.ts: Object.create bypasses
// the constructor's `resolve(InstallerState)` DI call, then fields are
// assigned directly. The `@observable` fields (roster/turnouts/sensors/...)
// need `Object.defineProperty` rather than plain assignment — Aurelia's
// `@observable` decorator leaves a non-writable placeholder descriptor on the
// prototype that only becomes a writable own-property via the constructor's
// field initializer, which Object.create skips.

function makeConfigEditorState(configFiles: Array<{ name: string; content: string }>): ConfigEditorState {
    const state = Object.create(ConfigEditorState.prototype) as ConfigEditorState
    for (const field of ['roster', 'turnouts', 'sensors', 'signals', 'routes', 'sequences', 'aliases']) {
        Object.defineProperty(state, field, { value: [], writable: true, enumerable: true, configurable: true })
    }
    Object.assign(state, {
        installerState: { appVersion: '0.1.0', configFiles, selectedDevice: null },
        configHContent: '',
        hasChanges: false,
        rosterPreservedComments: '',
        turnoutPreservedComments: '',
        preservedAutomationContent: '',
        generatedHalDevicesContent: '',
        generatedTrackManagerContent: '',
        generatedTurnoutDefaultsContent: '',
    })
    return state
}

describe('ConfigEditorState.syncAll — dirty tracking', () => {
    it('marks hasChanges when called', () => {
        const state = makeConfigEditorState([{ name: 'mySensors.h', content: '' }])

        state.syncAll()

        expect(state.hasChanges).toBe(true)
    })
})

describe('ConfigEditorState.loadFromInstallerState — does not falsely mark dirty', () => {
    it('leaves hasChanges false after loading an existing configuration', () => {
        const state = makeConfigEditorState([{ name: 'mySensors.h', content: 'SENSOR(1, 30, "Occupancy")\n' }])

        state.loadFromInstallerState()

        expect(state.hasChanges).toBe(false)
    })
})

describe('SensorsEditorCustomElement — visual edits mark dirty', () => {
    function makeEditor(state: ConfigEditorState) {
        const editor = Object.create(SensorsEditorCustomElement.prototype) as SensorsEditorCustomElement
        Object.assign(editor, { state, activeTab: 'visual', rawEditor: null, rawSnapshot: '' })
        return editor
    }

    it('addSensor marks the state dirty', () => {
        const state = makeConfigEditorState([{ name: 'mySensors.h', content: '' }])
        const editor = makeEditor(state)

        editor.addSensor()

        expect(state.hasChanges).toBe(true)
        expect(state.sensors).toHaveLength(1)
    })

    it('updateSensor (field-level edit) marks the state dirty', () => {
        const state = makeConfigEditorState([{ name: 'mySensors.h', content: '' }])
        state.sensors = [{ id: 1, pin: 30, description: 'Occupancy' }]

        const editor = makeEditor(state)
        editor.updateSensor(0, { id: 1, pin: 30, description: 'Renamed' })

        expect(state.hasChanges).toBe(true)
        expect(state.sensors[0].description).toBe('Renamed')
    })

    it('removeSensor marks the state dirty', () => {
        const state = makeConfigEditorState([{ name: 'mySensors.h', content: '' }])
        state.sensors = [{ id: 1, pin: 30, description: 'Occupancy' }]

        const editor = makeEditor(state)
        editor.removeSensor(0)

        expect(state.hasChanges).toBe(true)
        expect(state.sensors).toHaveLength(0)
    })
})

describe('SignalsEditorCustomElement — visual edits mark dirty', () => {
    it('addSignal marks the state dirty', () => {
        const state = makeConfigEditorState([{ name: 'mySignals.h', content: '' }])
        const editor = Object.create(SignalsEditorCustomElement.prototype) as SignalsEditorCustomElement
        Object.assign(editor, { state, activeTab: 'visual', rawEditor: null, rawSnapshot: '' })

        editor.addSignal()

        expect(state.hasChanges).toBe(true)
    })
})

describe('RoutesEditorCustomElement — visual edits mark dirty', () => {
    it('addRoute marks the state dirty', () => {
        const state = makeConfigEditorState([{ name: 'myRoutes.h', content: '' }])
        const editor = Object.create(RoutesEditorCustomElement.prototype) as RoutesEditorCustomElement
        Object.assign(editor, { state, activeTab: 'visual', rawEditor: null, rawSnapshot: '' })

        editor.addRoute()

        expect(state.hasChanges).toBe(true)
    })

    it('updateRoute (description/body field edit) marks the state dirty', () => {
        const state = makeConfigEditorState([{ name: 'myRoutes.h', content: '' }])
        state.routes = [{ id: 1, description: 'Old', body: '' }]
        const editor = Object.create(RoutesEditorCustomElement.prototype) as RoutesEditorCustomElement
        Object.assign(editor, { state, activeTab: 'visual', rawEditor: null, rawSnapshot: '' })

        editor.updateRoute(0, { id: 1, description: 'New', body: '' })

        expect(state.hasChanges).toBe(true)
    })
})

// FileEditorPanelCustomElement.genericContent is covered by the E2E "generic
// file" test in tests/e2e/config-editor.spec.ts instead of a unit test here —
// its `@bindable activeFileIndex` field decorator requires Aurelia's DI
// metadata, which isn't available outside a full Aurelia bootstrap (see
// roster-editor.ts / turnout-editor.ts, which avoid `@bindable` for the same
// reason).

describe('AutomationEditorCustomElement.content — raw myAutomation.h edits mark dirty', () => {
    it('setting content marks the state dirty', () => {
        const state = makeConfigEditorState([{ name: 'myAutomation.h', content: 'old' }])
        const editor = Object.create(AutomationEditorCustomElement.prototype) as AutomationEditorCustomElement
        Object.assign(editor, { state, installerState: state.installerState, activeTab: 'raw', rawEditor: null })

        editor.content = 'AUTOSTART\nDONE'

        expect(state.hasChanges).toBe(true)
        expect(state.installerState.configFiles[0].content).toBe('AUTOSTART\nDONE')
    })
})
