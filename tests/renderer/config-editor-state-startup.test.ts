import { describe, expect, it, vi } from 'vitest'

import {
    ConfigEditorState,
    MANAGED_TRACK_MANAGER_TAG,
    MANAGED_TURNOUT_DEFAULTS_TAG,
} from '../../src/renderer/src/models/config-editor-state'

function trackManagerBlock(body: string): string {
    return [
        MANAGED_TRACK_MANAGER_TAG,
        '// This TrackManager block is managed by EX-Commander.',
        '// Do not edit inside this block manually.',
        body,
        MANAGED_TRACK_MANAGER_TAG,
    ].join('\n')
}

function turnoutDefaultsBlock(body: string): string {
    return [
        MANAGED_TURNOUT_DEFAULTS_TAG,
        '// This turnout-defaults block is managed by EX-Commander.',
        '// Do not edit inside this block manually.',
        body,
        MANAGED_TURNOUT_DEFAULTS_TAG,
    ].join('\n')
}

const TRACK_MANAGER_BODY = 'AUTOSTART\nSET_TRACK(A,MAIN)\nSET_TRACK(B,PROG)\nDONE'
const TURNOUT_DEFAULTS_BODY = 'AUTOSTART\n  THROW(5)\nDONE'

function makeState(configFiles: Array<{ name: string; content: string }>) {
    const state = {
        installerState: { appVersion: '0.1.0', configFiles },
        roster: [],
        turnouts: [],
        sensors: [],
        signals: [],
        routes: [],
        sequences: [],
        aliases: [],
        generatedTrackManagerContent: '',
        generatedTurnoutDefaultsContent: '',
        generatedHalDevicesContent: '',
        _syncGeneratedTurnoutDefaultsContent: vi.fn(),
    }
    Object.defineProperty(state, 'startupPreview', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'startupPreview')!)
    return state
}

describe('ConfigEditorState — myStartup.h', () => {
    it('rehydrates TrackManager/TurnoutDefaults from an existing myStartup.h on load', () => {
        const startupContent = [trackManagerBlock(TRACK_MANAGER_BODY), '', turnoutDefaultsBlock(TURNOUT_DEFAULTS_BODY)].join('\n')
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myStartup.h', content: startupContent },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).generatedTrackManagerContent).toBe(TRACK_MANAGER_BODY)
        expect((state as any).hasChanges).toBe(false)
        expect(state.installerState.configFiles.filter(f => f.name === 'myStartup.h')).toHaveLength(1)
    })

    it('leaves TrackManager/TurnoutDefaults empty when there is nothing to migrate and no myStartup.h', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            // Custom EXRAIL with no AUTOSTART block at all — not TrackManager-
            // shaped in either the tagged or pre-tag legacy sense.
            { name: 'myAutomation.h', content: 'AUTOMATION(1,"My custom automation")\n  DONE' },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).generatedTrackManagerContent).toBe('')
        expect(state.installerState.configFiles.some(f => f.name === 'myStartup.h')).toBe(false)
        expect((state as any).hasChanges).toBe(false)
    })

    it('migrates legacy TrackManager/TurnoutDefaults blocks out of myAutomation.h into a new myStartup.h', () => {
        const customCode = 'AUTOMATION(1,"My custom automation")\n  DONE'
        const legacyAutomationContent = [
            trackManagerBlock(TRACK_MANAGER_BODY),
            '',
            turnoutDefaultsBlock(TURNOUT_DEFAULTS_BODY),
            '',
            customCode,
        ].join('\n')

        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myAutomation.h', content: legacyAutomationContent },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        // Split out into a new myStartup.h with both blocks intact.
        const startupFile = state.installerState.configFiles.find(f => f.name === 'myStartup.h')
        expect(startupFile).toBeDefined()
        expect(startupFile!.content).toContain(TRACK_MANAGER_BODY)
        expect(startupFile!.content).toContain(TURNOUT_DEFAULTS_BODY)
        expect((state as any).generatedTrackManagerContent).toBe(TRACK_MANAGER_BODY)

        // myAutomation.h's custom content must not retain the migrated blocks,
        // and must not lose the user's genuinely custom code.
        expect((state as any).preservedAutomationContent).toContain(customCode)
        expect((state as any).preservedAutomationContent).not.toContain('SET_TRACK')
        expect((state as any).preservedAutomationContent).not.toContain('THROW(5)')

        // The split must be visible/reviewable in the next Save diff.
        expect((state as any).hasChanges).toBe(true)
    })

    it('migrates a pre-tag untagged legacy TrackManager block (no MANAGED_TRACK_MANAGER_TAG at all)', () => {
        // Mirrors tests/e2e/fixtures.ts's MOCK_AUTOMATION_STACKED — a bare
        // AUTOSTART block with no managed-tag wrapper at all, predating the
        // tag system itself.
        const legacyContent = [
            '// myAutomation.h - Generated by EX-Commander',
            '',
            'AUTOSTART',
            'SET_TRACK(A,MAIN)',
            'SET_TRACK(B,PROG)',
            'SET_TRACK(C,MAIN)',
            'SET_TRACK(D,MAIN)',
            'DONE',
            '',
        ].join('\n')

        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myAutomation.h', content: legacyContent },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        const startupFile = state.installerState.configFiles.find(f => f.name === 'myStartup.h')
        expect(startupFile).toBeDefined()
        expect(startupFile!.content).toContain('SET_TRACK(C,MAIN)')
        expect(startupFile!.content).toContain('SET_TRACK(D,MAIN)')
        expect((state as any).generatedTrackManagerContent).toContain('SET_TRACK(C,MAIN)')
        expect((state as any).hasChanges).toBe(true)
    })

    it('does not re-migrate or duplicate content when myStartup.h already exists', () => {
        const startupContent = trackManagerBlock(TRACK_MANAGER_BODY)
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            // A legacy-shaped myAutomation.h that (hypothetically) still has the
            // tag text lying around must NOT trigger a second migration once
            // myStartup.h is already present.
            { name: 'myAutomation.h', content: trackManagerBlock(TRACK_MANAGER_BODY) },
            { name: 'myStartup.h', content: startupContent },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect(state.installerState.configFiles.filter(f => f.name === 'myStartup.h')).toHaveLength(1)
        expect((state as any).hasChanges).toBe(false)
    })

    it('syncTrackManager() targets myStartup.h, not myAutomation.h', () => {
        const state = {
            installerState: {
                configFiles: [
                    { name: 'myAutomation.h', content: 'preexisting' },
                ],
            },
            generatedTrackManagerContent: '',
            generatedTurnoutDefaultsContent: '',
            _ensureStartupFile: (ConfigEditorState.prototype as unknown as Record<string, unknown>)._ensureStartupFile,
        }
        Object.defineProperty(state, 'startupPreview', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'startupPreview')!)

        ConfigEditorState.prototype.syncTrackManager.call(state as any, TRACK_MANAGER_BODY)

        expect((state as any).hasChanges).toBe(true)
        expect((state as any).generatedTrackManagerContent).toBe(TRACK_MANAGER_BODY)
        const startupFile = state.installerState.configFiles.find(f => f.name === 'myStartup.h')
        expect(startupFile).toBeDefined()
        expect(startupFile!.content).toContain(TRACK_MANAGER_BODY)
        // myAutomation.h must be untouched by this call.
        expect(state.installerState.configFiles.find(f => f.name === 'myAutomation.h')!.content).toBe('preexisting')
    })

    it('regression: _syncToInstallerState() does not clobber a fresh generatedTurnoutDefaultsContent with stale on-disk content', () => {
        // Unlike generatedTrackManagerContent/generatedHalDevicesContent (which
        // have their own write paths — syncTrackManager()/syncHalDevices() —
        // that bypass _syncToInstallerState() entirely), generatedTurnoutDefaultsContent
        // is set by _syncGeneratedTurnoutDefaultsContent() immediately before
        // every turnout mutator calls _syncToInstallerState() itself. Re-deriving
        // it from the *stale* on-disk myStartup.h inside _syncToInstallerState()
        // (as generatedTrackManagerContent legitimately is) would silently undo
        // the very change the mutator was trying to persist — e.g. flipping a
        // turnout's defaultState from THROWN back to CLOSED would never actually
        // clear the THROW() line, since the stale re-derivation would keep
        // resurrecting it from the myStartup.h content written just before.
        const state = {
            installerState: { configFiles: [] as Array<{ name: string; content: string }> },
            roster: [],
            turnouts: [],
            customFileNames: [] as string[],
            generatedHalDevicesContent: '',
            generatedTrackManagerContent: '',
            generatedTurnoutDefaultsContent: '',
            _ensureAutomationFile: (ConfigEditorState.prototype as unknown as Record<string, unknown>)._ensureAutomationFile,
            _ensureStartupFile: (ConfigEditorState.prototype as unknown as Record<string, unknown>)._ensureStartupFile,
        }
        Object.defineProperty(state, 'startupPreview', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'startupPreview')!)

        // 1) Turnout set to THROWN: _syncGeneratedTurnoutDefaultsContent() sets the
        //    fresh value, then the mutator calls _syncToInstallerState().
        state.generatedTurnoutDefaultsContent = TURNOUT_DEFAULTS_BODY
        ;(ConfigEditorState.prototype as unknown as Record<string, unknown>)._syncToInstallerState.call(state)

        expect(state.installerState.configFiles.find(f => f.name === 'myStartup.h')!.content).toContain('THROW(5)')

        // 2) Turnout set back to CLOSED: _syncGeneratedTurnoutDefaultsContent()
        //    now sets '', then _syncToInstallerState() runs again.
        state.generatedTurnoutDefaultsContent = ''
        ;(ConfigEditorState.prototype as unknown as Record<string, unknown>)._syncToInstallerState.call(state)

        expect(state.generatedTurnoutDefaultsContent).toBe('')
        expect(state.installerState.configFiles.find(f => f.name === 'myStartup.h')!.content).not.toContain('THROW(5)')
    })
})
