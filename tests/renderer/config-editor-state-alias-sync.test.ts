import { describe, expect, it, vi } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

describe('ConfigEditorState.syncAliasForId', () => {
    it('updates the existing alias by previous name instead of appending a duplicate', () => {
        const state = {
            aliases: [{ name: 'OLD_TURNOUT', value: '200', aliasType: 'Turnout' }],
            hasChanges: false,
            _syncToInstallerState: vi.fn(),
            validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
            getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Turnout' }]),
        }

        const result = ConfigEditorState.prototype.syncAliasForId.call(
            state,
            200,
            200,
            'NEW_TURNOUT',
            'Turnout',
            'OLD_TURNOUT',
        )

        expect(result).toEqual({ ok: true })
        expect(state.aliases).toEqual([{ name: 'NEW_TURNOUT', value: '200', aliasType: 'Turnout' }])
        expect(state._syncToInstallerState).toHaveBeenCalledOnce()
    })

    it('reuses an existing alias on the same target instead of creating a second alias entry', () => {
        const state = {
            aliases: [
                { name: 'TURNOUT_MAIN', value: '200', aliasType: 'Turnout' },
                { name: 'OTHER_ALIAS', value: '500', aliasType: 'Turnout' },
            ],
            hasChanges: false,
            _syncToInstallerState: vi.fn(),
            validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
            getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Turnout' }]),
        }

        const result = ConfigEditorState.prototype.syncAliasForId.call(
            state,
            999,
            200,
            'TURNOUT_YARD',
            'Turnout',
        )

        expect(result).toEqual({ ok: true })
        expect(state.aliases).toEqual([
            { name: 'TURNOUT_YARD', value: '200', aliasType: 'Turnout' },
            { name: 'OTHER_ALIAS', value: '500', aliasType: 'Turnout' },
        ])
    })

    it('allows the same alias name across different object types', () => {
        const state = {
            aliases: [
                { name: 'MAIN', value: '3', aliasType: 'Roster' },
            ],
            hasChanges: false,
            _syncToInstallerState: vi.fn(),
            validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
            getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Turnout' }]),
        }

        const result = ConfigEditorState.prototype.syncAliasForId.call(
            state,
            200,
            200,
            'MAIN',
            'Turnout',
        )

        expect(result).toEqual({ ok: true })
        expect(state.aliases).toEqual([
            { name: 'MAIN', value: '3', aliasType: 'Roster' },
            { name: 'MAIN', value: '200', aliasType: 'Turnout' },
        ])
    })
})