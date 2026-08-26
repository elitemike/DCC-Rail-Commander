import { describe, expect, it, vi } from 'vitest'

import {
    ConfigEditorState,
    MANAGED_TRACK_MANAGER_TAG,
    MANAGED_TURNOUT_DEFAULTS_TAG,
} from '../../src/renderer/src/models/config-editor-state'

function trackManagerBlock(body: string): string {
    return [
        MANAGED_TRACK_MANAGER_TAG,
        '// This TrackManager block is managed by DCC-Rail-Commander.',
        '// Do not edit inside this block manually.',
        body,
        MANAGED_TRACK_MANAGER_TAG,
    ].join('\n')
}

function turnoutDefaultsBlock(body: string): string {
    return [
        MANAGED_TURNOUT_DEFAULTS_TAG,
        '// This turnout-defaults block is managed by DCC-Rail-Commander.',
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
        automations: [],
        sequences: [],
        aliases: [],
        generatedTrackManagerContent: '',
        generatedTurnoutDefaultsContent: '',
        generatedHalDevicesContent: '',
        preservedAutomationContent: '',
        _syncGeneratedTurnoutDefaultsContent: vi.fn(),
        isCustomFile: ConfigEditorState.prototype.isCustomFile,
    }
    Object.defineProperty(state, 'startupPreview', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'startupPreview')!)
    Object.defineProperty(state, 'automationPreview', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'automationPreview')!)
    Object.defineProperty(state, 'automationsRaw', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'automationsRaw')!)
    Object.defineProperty(state, 'customFileNames', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'customFileNames')!)
    Object.defineProperty(state, 'hasStackedMotorShield', Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, 'hasStackedMotorShield')!)
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

    it('hasStackedMotorShield reflects config.h MOTOR_SHIELD_TYPE — false by default, true for EXCSB1_WITH_EX8874', () => {
        const singleShieldState = makeState([
            { name: 'config.h', content: '#define MOTOR_SHIELD_TYPE STANDARD_MOTOR_SHIELD\n' },
        ])
        ConfigEditorState.prototype.loadFromInstallerState.call(singleShieldState as any)
        expect((singleShieldState as any).hasStackedMotorShield).toBe(false)

        const stackedShieldState = makeState([
            { name: 'config.h', content: '#define MOTOR_SHIELD_TYPE EXCSB1_WITH_EX8874\n' },
        ])
        ConfigEditorState.prototype.loadFromInstallerState.call(stackedShieldState as any)
        expect((stackedShieldState as any).hasStackedMotorShield).toBe(true)
    })

    it('leaves TrackManager/TurnoutDefaults empty when there is nothing to migrate and no myStartup.h', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            // Custom EXRAIL with no AUTOSTART block and no AUTOMATION(...) block either — not
            // TrackManager-shaped, and nothing for the separate AUTOMATION migration to find.
            { name: 'myAutomation.h', content: '// just a hand-written comment, nothing to migrate' },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).generatedTrackManagerContent).toBe('')
        expect(state.installerState.configFiles.some(f => f.name === 'myStartup.h')).toBe(false)
        expect((state as any).hasChanges).toBe(false)
    })

    it('migrates legacy TrackManager/TurnoutDefaults blocks out of myAutomation.h into a new myStartup.h', () => {
        // Genuinely unrelated custom code — not AUTOMATION-shaped, so the separate AUTOMATION
        // migration (see the dedicated test below) has nothing to do with it; this test is only
        // about TrackManager/TurnoutDefaults not clobbering whatever else is in the file.
        const customCode = '// a genuinely custom comment\nPRINT("hello")\nDONE'
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

        // Regression: the myAutomation.h *file entry itself* (what the Advanced
        // raw editor actually displays) must be rewritten immediately too — not
        // just the in-memory preservedAutomationContent — otherwise the editor
        // keeps showing the pre-split AUTOSTART blocks verbatim right alongside
        // the new Startup editor showing the same blocks, until some unrelated
        // action (a Save, or editing another form) happens to trigger a resync.
        const automationFile = state.installerState.configFiles.find(f => f.name === 'myAutomation.h')
        expect(automationFile!.content).toContain(customCode)
        expect(automationFile!.content).not.toContain('SET_TRACK')
        expect(automationFile!.content).not.toContain('THROW(5)')
        expect(automationFile!.content).toContain('#include "myStartup.h"')

        // The split must be visible/reviewable in the next Save diff.
        expect((state as any).hasChanges).toBe(true)
    })

    it('migrates a hand-typed AUTOMATION(...) block out of myAutomation.h into myAutomations.h', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myAutomation.h', content: 'AUTOMATION(1,"My custom automation")\n  DONE' },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).automations).toEqual([{ id: 1, description: 'My custom automation', body: 'DONE' }])
        // Moved out, not merely copied — myAutomation.h's own custom content no longer has it.
        expect((state as any).preservedAutomationContent).not.toContain('AUTOMATION(1')
        const automationsFile = state.installerState.configFiles.find(f => f.name === 'myAutomations.h')
        expect(automationsFile).toBeDefined()
        expect(automationsFile!.content).toContain('AUTOMATION(1, "My custom automation")')
        expect((state as any).hasChanges).toBe(true)
    })

    it('migrates a hand-typed AUTOMATION(...) block out of a custom file (created via the + button) into myAutomations.h', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myCustomStuff.h', content: 'ALIAS(SOME_THING, 5)\nAUTOMATION(2,"Another one")\nDONE\n' },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).automations).toEqual([{ id: 2, description: 'Another one', body: 'DONE' }])
        const customFile = state.installerState.configFiles.find(f => f.name === 'myCustomStuff.h')
        expect(customFile!.content).toContain('ALIAS(SOME_THING, 5)')
        expect(customFile!.content).not.toContain('AUTOMATION(2')
        expect((state as any).hasChanges).toBe(true)
    })

    it('leaves myAutomations.h alone (no spurious migration) when no AUTOMATION(...) block exists anywhere', () => {
        const state = makeState([
            { name: 'config.h', content: '// empty\n' },
            { name: 'myAutomation.h', content: '// just a comment' },
        ])

        ConfigEditorState.prototype.loadFromInstallerState.call(state as any)

        expect((state as any).automations).toEqual([])
        expect((state as any).hasChanges).toBe(false)
    })

    it('migrates a pre-tag untagged legacy TrackManager block (no MANAGED_TRACK_MANAGER_TAG at all)', () => {
        // Mirrors tests/e2e/fixtures.ts's MOCK_AUTOMATION_STACKED — a bare
        // AUTOSTART block with no managed-tag wrapper at all, predating the
        // tag system itself.
        const legacyContent = [
            '// myAutomation.h - Generated by DCC-Rail-Commander',
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
