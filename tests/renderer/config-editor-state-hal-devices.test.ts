import { describe, expect, it, vi } from 'vitest'

import { ConfigEditorState, MANAGED_HAL_DEVICES_TAG } from '../../src/renderer/src/models/config-editor-state'
import { generateHalDevicesBlock, type HalDeviceInstance } from '../../src/renderer/src/config/hal-devices'

function makeState(configFiles: Array<{ name: string; content: string }>) {
    return {
        installerState: { appVersion: '0.1.0', configFiles },
        roster: [],
        turnouts: [],
        sensors: [],
        signals: [],
        routes: [],
        sequences: [],
        aliases: [],
        normalizeAliases: ConfigEditorState.prototype.normalizeAliases,
        normalizeAliasEntry: (ConfigEditorState.prototype as unknown as Record<string, unknown>).normalizeAliasEntry,
        _syncGeneratedTurnoutDefaultsContent: vi.fn(),
    }
}

describe('ConfigEditorState — HAL Devices managed block', () => {
    it('rehydrates generatedHalDevicesContent from an existing myAutomation.h on load', () => {
        const devices: HalDeviceInstance[] = [
            { instanceId: 'a', boardId: 'rt_dcd_16', label: 'Yard block detector', address: 0x20, vpinStart: 164 },
        ]
        const body = generateHalDevicesBlock(devices)
        const automationContent = [
            MANAGED_HAL_DEVICES_TAG,
            '// This HAL Devices block is managed by EX-Commander.',
            '// Do not edit inside this block manually.',
            body,
            MANAGED_HAL_DEVICES_TAG,
        ].join('\n')

        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myAutomation.h', content: automationContent },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).generatedHalDevicesContent).toBe(body)
    })

    it('leaves generatedHalDevicesContent empty when myAutomation.h has no HAL Devices block', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myAutomation.h', content: 'AUTOSTART\n  POWERON\nDONE' },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).generatedHalDevicesContent).toBe('')
    })

    it('resets a stale generatedHalDevicesContent when reloading a config without myAutomation.h', () => {
        const state = makeState([{ name: 'config.h', content: '// empty\n' }]) as any
        state.generatedHalDevicesContent = 'stale'

        ConfigEditorState.prototype.loadFromInstallerState.call(state)

        expect(state.generatedHalDevicesContent).toBe('')
    })
})
