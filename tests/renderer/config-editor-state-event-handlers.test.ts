import { describe, it, expect } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

// Mirrors dirty-state.test.ts's makeConfigEditorState — a real ConfigEditorState instance built
// via Object.create (bypassing the constructor's resolve(InstallerState) DI call), with the
// @observable fields given real own-property descriptors since Aurelia's decorator otherwise
// leaves a non-writable placeholder on the prototype that Object.create alone doesn't upgrade.
function makeConfigEditorState(configFiles: Array<{ name: string; content: string }>): ConfigEditorState {
    const state = Object.create(ConfigEditorState.prototype) as ConfigEditorState
    for (const field of ['roster', 'turnouts', 'sensors', 'signals', 'routes', 'automations', 'sequences', 'eventHandlers', 'aliases']) {
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

describe('ConfigEditorState — myEvents.h wiring', () => {
    it('parses myEvents.h content into eventHandlers on load', () => {
        const state = makeConfigEditorState([
            { name: 'myEvents.h', content: 'ONSENSOR(200)\nTHROW(201)\nDONE\n' },
        ])
        state.loadFromInstallerState()
        expect(state.eventHandlers).toEqual([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nTHROW(201)\nDONE' }])
    })

    it('force-creates an empty myEvents.h entry when missing, so the Configuration list row is reachable', () => {
        const state = makeConfigEditorState([])
        state.loadFromInstallerState()
        expect(state.installerState.configFiles.some(f => f.name === 'myEvents.h')).toBe(true)
    })

    it('eventHandlersRaw serializes back with a generator header', () => {
        const state = makeConfigEditorState([])
        state.eventHandlers = [{ command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nPOWERON' }]
        expect(state.eventHandlersRaw).toContain('DCC-Rail-Commander')
        expect(state.eventHandlersRaw).toContain('ONRAILSYNCON\nPOWERON')
    })

    it('setEventHandlersFromRaw parses and marks dirty', () => {
        const state = makeConfigEditorState([{ name: 'myEvents.h', content: '' }])
        state.setEventHandlersFromRaw('ONACTIVATE(100, 4)\nCLOSE(202)\nDONE')
        expect(state.eventHandlers).toEqual([{ command: 'ONACTIVATE', text: 'ONACTIVATE(100, 4)\nCLOSE(202)\nDONE' }])
        expect(state.hasChanges).toBe(true)
        expect(state.installerState.configFiles.find(f => f.name === 'myEvents.h')?.content).toContain('ONACTIVATE(100, 4)')
    })

    it("myAutomation.h's #include list includes myEvents.h only once it has real content", () => {
        const withoutHandlers = makeConfigEditorState([{ name: 'myEvents.h', content: '// nothing yet\n' }])
        withoutHandlers.loadFromInstallerState()
        expect(withoutHandlers.automationPreview).not.toContain('#include "myEvents.h"')

        const withHandlers = makeConfigEditorState([{ name: 'myEvents.h', content: 'ONSENSOR(200)\nDONE\n' }])
        withHandlers.loadFromInstallerState()
        expect(withHandlers.automationPreview).toContain('#include "myEvents.h"')
    })
})
