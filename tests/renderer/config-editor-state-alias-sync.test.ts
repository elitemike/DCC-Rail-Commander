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

    describe('strictAliases', () => {
        it('rejects clearing an alias to blank when strictAliases is on', () => {
            const state = {
                aliases: [{ name: 'YARD_TURNOUT', value: '1', aliasType: 'Turnout' }],
                hasChanges: false,
                strictAliases: true,
                _syncToInstallerState: vi.fn(),
                validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
                getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Turnout' }]),
            }

            const result = ConfigEditorState.prototype.syncAliasForId.call(
                state, 1, 1, '', 'Turnout', 'YARD_TURNOUT',
            )

            expect(result).toEqual({ ok: false, reason: 'An alias is required when Strict aliases is enabled.' })
            // Nothing removed — the alias must survive the rejected attempt.
            expect(state.aliases).toEqual([{ name: 'YARD_TURNOUT', value: '1', aliasType: 'Turnout' }])
        })

        it('still allows clearing an alias to blank when strictAliases is off', () => {
            const state = {
                aliases: [{ name: 'YARD_TURNOUT', value: '1', aliasType: 'Turnout' }],
                hasChanges: false,
                strictAliases: false,
                _syncToInstallerState: vi.fn(),
                validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
                getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Turnout' }]),
            }

            const result = ConfigEditorState.prototype.syncAliasForId.call(
                state, 1, 1, '', 'Turnout', 'YARD_TURNOUT',
            )

            expect(result).toEqual({ ok: true })
            expect(state.aliases).toEqual([])
        })

        it('still allows setting a non-blank alias when strictAliases is on', () => {
            const state = {
                aliases: [] as { name: string; value: string; aliasType?: string }[],
                hasChanges: false,
                strictAliases: true,
                _syncToInstallerState: vi.fn(),
                validateAliasTargetId: vi.fn().mockReturnValue({ ok: true }),
                getObjectIdReferences: vi.fn().mockReturnValue([{ type: 'Turnout' }]),
            }

            const result = ConfigEditorState.prototype.syncAliasForId.call(
                state, 1, 1, 'YARD_TURNOUT', 'Turnout', '',
            )

            expect(result).toEqual({ ok: true })
            expect(state.aliases).toEqual([{ name: 'YARD_TURNOUT', value: '1', aliasType: 'Turnout' }])
        })

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

/**
 * Getters, not methods — call via their property descriptor rather than `.call()` directly.
 * `filesNeedingAlias` reads the other per-type getters via `this.turnoutIdsNeedingAlias` etc.,
 * so `fields` is applied to a real ConfigEditorState-prototyped object (not a bare object
 * literal), or those nested getter reads would resolve to `undefined` instead of inheriting
 * from the prototype. `roster`/`turnouts`/etc. are `@observable`, which defines a getter-only
 * accessor on the prototype until Aurelia's own construction/observation wiring runs — plain
 * `Object.assign` hits that accessor's (missing) setter, so each field is defined directly as
 * an own data property instead, shadowing the inherited accessor entirely.
 */
function getViaPrototype<T>(fields: Record<string, unknown>, prop: string): T {
    const state = Object.create(ConfigEditorState.prototype) as object
    for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(state, key, { value, writable: true, configurable: true, enumerable: true })
    }
    return (Object.getOwnPropertyDescriptor(ConfigEditorState.prototype, prop)!.get as (this: unknown) => T).call(state)
}

describe('ConfigEditorState — which existing objects need an alias', () => {
    it('is empty for every getter when strictAliases is off', () => {
        const state = {
            strictAliases: false,
            aliases: [],
            turnouts: [{ id: 200 }],
            sensors: [{ id: 1 }],
            roster: [{ dccAddress: 3 }],
            routes: [{ id: 1 }],
            sequences: [{ id: 1 }],
        }
        expect(getViaPrototype(state, 'turnoutIdsNeedingAlias')).toEqual(new Set())
        expect(getViaPrototype(state, 'sensorIdsNeedingAlias')).toEqual(new Set())
        expect(getViaPrototype(state, 'rosterAddressesNeedingAlias')).toEqual(new Set())
        expect(getViaPrototype(state, 'routeIdsNeedingAlias')).toEqual(new Set())
        expect(getViaPrototype(state, 'sequenceIdsNeedingAlias')).toEqual(new Set())
        expect(getViaPrototype(state, 'filesNeedingAlias')).toEqual(new Set())
    })

    it('lists ids of objects with no matching alias, per type, when strictAliases is on', () => {
        const state = {
            strictAliases: true,
            aliases: [
                { name: 'MAIN_JUNCTION', value: '200', aliasType: 'Turnout' },
                { name: 'THOMAS', value: '3', aliasType: 'Roster' },
            ],
            turnouts: [{ id: 200 }, { id: 201 }],
            sensors: [{ id: 1 }],
            roster: [{ dccAddress: 3 }, { dccAddress: 5 }],
            routes: [{ id: 1 }],
            sequences: [],
        }
        expect(getViaPrototype(state, 'turnoutIdsNeedingAlias')).toEqual(new Set([201]))
        expect(getViaPrototype(state, 'sensorIdsNeedingAlias')).toEqual(new Set([1]))
        expect(getViaPrototype(state, 'rosterAddressesNeedingAlias')).toEqual(new Set([5]))
        expect(getViaPrototype(state, 'routeIdsNeedingAlias')).toEqual(new Set([1]))
        expect(getViaPrototype(state, 'sequenceIdsNeedingAlias')).toEqual(new Set())
    })

    it('does not match an alias of a different type on the same numeric id', () => {
        const state = {
            strictAliases: true,
            aliases: [{ name: 'SOME_TURNOUT', value: '3', aliasType: 'Turnout' }],
            turnouts: [],
            sensors: [],
            roster: [{ dccAddress: 3 }],
            routes: [],
            sequences: [],
        }
        expect(getViaPrototype(state, 'rosterAddressesNeedingAlias')).toEqual(new Set([3]))
    })

    it('filesNeedingAlias lists a file only when it has at least one un-aliased object', () => {
        const state = {
            strictAliases: true,
            aliases: [{ name: 'MAIN_JUNCTION', value: '200', aliasType: 'Turnout' }],
            turnouts: [{ id: 200 }],
            sensors: [{ id: 1 }],
            roster: [],
            routes: [],
            sequences: [],
            automations: [],
        }
        expect(getViaPrototype(state, 'filesNeedingAlias')).toEqual(new Set(['mySensors.h']))
    })
})