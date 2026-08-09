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

    it('rejects reusing an alias name already assigned to a different target', () => {
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

        expect(result).toEqual({ ok: false, reason: expect.stringContaining('MAIN') })
        expect(state.aliases).toEqual([
            { name: 'MAIN', value: '3', aliasType: 'Roster' },
        ])
        expect(state._syncToInstallerState).not.toHaveBeenCalled()
    })

    it('creates a new alias for a roster entry instead of hijacking an existing turnout alias that shares the same numeric ID', () => {
        // Regression: a turnout with ID 1 already has an alias. Setting a brand new
        // alias on a roster entry ("Thomas") whose DCC address is also 1 must not
        // find/rename the turnout's alias just because the numeric ID matches — it
        // must create a separate alias scoped to the roster type.
        const state = {
            aliases: [{ name: 'YARD_TURNOUT', value: '1', aliasType: 'Turnout' }],
            hasChanges: false,
            _syncToInstallerState: vi.fn(),
            validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
            getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Roster' }, { type: 'Turnout' }]),
        }

        const result = ConfigEditorState.prototype.syncAliasForId.call(
            state,
            1,
            1,
            'THOMAS',
            'Roster',
            '',
        )

        expect(result).toEqual({ ok: true })
        expect(state.aliases).toEqual([
            { name: 'YARD_TURNOUT', value: '1', aliasType: 'Turnout' },
            { name: 'THOMAS', value: '1', aliasType: 'Roster' },
        ])
    })

    it('resolves the caller-supplied type, not the first cross-type ID match, when a turnout ID collides with a roster address', () => {
        // getObjectIdReferences intentionally returns Roster first (mirrors the real
        // roster-before-turnouts scan order in collectObjectIdReferences) to prove the
        // explicit `aliasType` argument wins instead of the first match in the list.
        const state = {
            aliases: [] as { name: string; value: string; aliasType?: string }[],
            hasChanges: false,
            _syncToInstallerState: vi.fn(),
            validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
            getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Roster' }, { type: 'Turnout' }]),
        }

        const result = ConfigEditorState.prototype.syncAliasForId.call(
            state,
            3,
            3,
            'AMBIG_ALIAS',
            'Turnout',
            '',
        )

        expect(result).toEqual({ ok: true })
        expect(state.aliases).toEqual([{ name: 'AMBIG_ALIAS', value: '3', aliasType: 'Turnout' }])
    })
})

describe('ConfigEditorState.getPrimaryAliasNameForId', () => {
    it('does not leak an alias set on one object type to a different object type with the same numeric ID', () => {
        // Regression: a turnout with ID 1 and a roster entry ("Thomas") with DCC
        // address 1 previously shared a single alias lookup keyed only on the
        // numeric ID, so an alias set on the turnout would also show up when
        // editing the roster entry (and vice versa).
        const state = {
            aliases: [{ name: 'YARD_TURNOUT', value: '1', aliasType: 'Turnout' }],
        }

        expect(
            ConfigEditorState.prototype.getPrimaryAliasNameForId.call(state, 1, 'Turnout'),
        ).toBe('YARD_TURNOUT')
        expect(
            ConfigEditorState.prototype.getPrimaryAliasNameForId.call(state, 1, 'Roster'),
        ).toBe('')
    })
})