import { describe, expect, it } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

function makeState(configFiles: Array<{ name: string; content: string }>) {
    const state = {
        installerState: { configFiles },
        roster: [],
        turnouts: [],
        generatedHalDevicesContent: '',
        preservedAutomationContent: '',
        isCustomFile: ConfigEditorState.prototype.isCustomFile,
    }
    Object.defineProperty(state, 'startupPreview', { get: () => '' })
    Object.defineProperty(state, 'automationPreview', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'automationPreview')!)
    Object.defineProperty(state, 'customFileNames', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'customFileNames')!)
    return state
}

describe('ConfigEditorState — automationPreview custom-file includes', () => {
    it('still auto-#includes a genuine custom .h file', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myCustomExrail.h', content: 'AUTOMATION(1,"Test")\nDONE' },
        ])

        expect((state as any).automationPreview).toContain('#include "myCustomExrail.h"')
    })

    it('never auto-#includes an arbitrary custom .cpp file (general rule, not name-specific)', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myOtherDriver.cpp', content: 'void halSetup() {}\n' },
        ])

        expect((state as any).automationPreview).not.toContain('#include "myOtherDriver.cpp"')
    })

    it('never auto-#includes myHal.cpp', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myHal.cpp', content: 'void halSetup() {}\n' },
        ])

        expect((state as any).automationPreview).not.toContain('#include "myHal.cpp"')
    })

    it('never auto-#includes mySetup.h — the firmware includes it itself, unrelated to myAutomation.h', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'mySetup.h', content: 'SETUP("<D CMD>")\n' },
        ])

        expect((state as any).automationPreview).not.toContain('#include "mySetup.h"')
    })

    it('mySetup.h and myHal.cpp are not classified as custom files', () => {
        const state = makeState([])

        expect((state as any).isCustomFile('mySetup.h')).toBe(false)
        expect((state as any).isCustomFile('myHal.cpp')).toBe(false)
    })
})
