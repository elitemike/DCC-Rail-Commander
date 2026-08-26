import { describe, expect, it, vi } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

describe('ConfigEditorState.loadFromInstallerState', () => {
    it('populates sensors, signals, routes and sequences from configFiles', () => {
        const state = {
            installerState: {
                appVersion: '0.1.0',
                configFiles: [
                    { name: 'config.h', content: '#define MAIN_DRIVER_MOTOR_SHIELD STANDARD_MOTOR_SHIELD\n' },
                    { name: 'mySensors.h', content: 'SENSOR(1, 30, "Occupancy")\n' },
                    { name: 'mySignals.h', content: 'SIGNAL(22, 23, 24)\n' },
                    { name: 'myRoutes.h', content: 'ROUTE(1, "Main to Siding")\nDONE\n' },
                    { name: 'mySequences.h', content: 'SEQUENCE(1)\nDONE\n' },
                ],
            },
            roster: [],
            turnouts: [],
            sensors: [],
            signals: [],
            routes: [],
            sequences: [],
            aliases: [],
            normalizeAliases: ConfigEditorState.prototype.normalizeAliases,
            normalizeAliasEntry: (ConfigEditorState.prototype as any).normalizeAliasEntry,
            _syncGeneratedTurnoutDefaultsContent: vi.fn(),
        }

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect(state.sensors).toEqual([{ id: 1, pin: 30, description: 'Occupancy' }])
        expect(state.signals).toEqual([{ type: 'PIN', red: 22, amber: 23, green: 24, description: '' }])
        expect(state.routes).toEqual([{ id: 1, description: 'Main to Siding', body: 'DONE' }])
        expect(state.sequences).toEqual([{ id: 1, description: '', body: 'DONE' }])
    })

    it('resets sensors, signals, routes and sequences when reloading a config that no longer has them', () => {
        const state = {
            installerState: {
                appVersion: '0.1.0',
                configFiles: [
                    { name: 'config.h', content: '// empty\n' },
                ],
            },
            roster: [],
            turnouts: [],
            sensors: [{ id: 1, pin: 30, description: 'stale' }],
            signals: [{ red: 1, amber: 2, green: 3, description: 'stale' }],
            routes: [{ id: 1, description: 'stale', body: '' }],
            sequences: [{ id: 1, body: 'stale' }],
            aliases: [],
            normalizeAliases: ConfigEditorState.prototype.normalizeAliases,
            normalizeAliasEntry: (ConfigEditorState.prototype as any).normalizeAliasEntry,
            _syncGeneratedTurnoutDefaultsContent: vi.fn(),
        }

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect(state.sensors).toEqual([])
        expect(state.signals).toEqual([])
        expect(state.routes).toEqual([])
        expect(state.sequences).toEqual([])
    })
})
