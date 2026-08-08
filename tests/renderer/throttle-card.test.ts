import { describe, it, expect } from 'vitest'
import { buildFunctionSlots } from '../../src/renderer/src/utils/throttle-function-slots'
import { MAX_FUNCTIONS } from '../../src/renderer/src/services/throttle.service'
import type { RosterFunction } from '../../src/renderer/src/utils/myAutomationParser'

// buildFunctionSlots is exercised directly (rather than via
// ThrottleCardCustomElement) because that component's `@bindable` fields
// can't be instantiated outside a full Aurelia app under the current test
// setup — see throttle.service.test.ts / throttle-panel.test.ts for
// coverage of the rest of the throttle feature's logic.

describe('buildFunctionSlots — freeform / unmatched address (isRosterMatch = false)', () => {
    it('always shows all MAX_FUNCTIONS generic "Fn" slots, regardless of rosterFunctions', () => {
        const slots = buildFunctionSlots([], false)
        expect(slots).toHaveLength(MAX_FUNCTIONS)
        expect(slots[0]).toEqual({ index: 0, label: 'F0', isMomentary: false, disabled: false })
        expect(slots[28]).toEqual({ index: 28, label: 'F28', isMomentary: false, disabled: false })
    })

    it('ignores any rosterFunctions passed alongside isRosterMatch = false', () => {
        const rosterFunctions: RosterFunction[] = [{ name: 'Light', isMomentary: false, noFunction: false }]
        const slots = buildFunctionSlots(rosterFunctions, false)
        expect(slots).toHaveLength(MAX_FUNCTIONS)
        expect(slots[0]).toMatchObject({ label: 'F0' })
    })
})

describe('buildFunctionSlots — roster-matched loco (isRosterMatch = true)', () => {
    it('shows exactly as many slots as the roster loco defines, no padding', () => {
        const rosterFunctions: RosterFunction[] = [
            { name: 'Light', isMomentary: false, noFunction: false },
            { name: 'Horn', isMomentary: true, noFunction: false },
        ]
        const slots = buildFunctionSlots(rosterFunctions, true)
        expect(slots).toHaveLength(2)
        expect(slots[0]).toMatchObject({ label: 'Light', isMomentary: false, disabled: false })
        expect(slots[1]).toMatchObject({ label: 'Horn', isMomentary: true, disabled: false })
    })

    it('marks noFunction slots as disabled and falls back to the "Fn" label, without dropping the slot', () => {
        const rosterFunctions: RosterFunction[] = [
            { name: 'Light', isMomentary: false, noFunction: false },
            { name: '-', isMomentary: false, noFunction: true },
            { name: 'Horn', isMomentary: false, noFunction: false },
        ]
        const slots = buildFunctionSlots(rosterFunctions, true)
        expect(slots).toHaveLength(3)
        expect(slots[1]).toMatchObject({ label: 'F1', disabled: true })
    })

    it('shows zero slots for a roster loco with no defined functions', () => {
        expect(buildFunctionSlots([], true)).toHaveLength(0)
    })
})
