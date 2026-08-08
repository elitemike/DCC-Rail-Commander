import type { RosterFunction } from './myAutomationParser'
import { MAX_FUNCTIONS } from '../services/throttle.service'

export interface ThrottleFunctionSlot {
    index: number
    label: string
    isMomentary: boolean
    disabled: boolean
}

/**
 * Builds the display slots for a throttle card's function grid.
 *
 * - Roster-matched loco (`isRosterMatch` true): only the functions the
 *   roster actually defines are shown — e.g. a loco with `LIGHT/HORN` shows
 *   exactly F0/F1, no padding out to F28. A `noFunction` placeholder within
 *   that range (e.g. `LIGHT/-/HORN`) still renders as a disabled slot, since
 *   it occupies a real F-number position on the decoder.
 * - Freeform / unmatched address (`isRosterMatch` false): no function data
 *   exists at all, so all F0-F28 are shown with generic "Fn" labels so the
 *   loco can still be tested.
 *
 * Kept as a standalone pure function (rather than a method on
 * ThrottleCardCustomElement) so it can be unit tested without loading the
 * `@bindable`-decorated custom element itself.
 */
export function buildFunctionSlots(rosterFunctions: RosterFunction[], isRosterMatch: boolean): ThrottleFunctionSlot[] {
    if (isRosterMatch) {
        return rosterFunctions.map((fn, i) => ({
            index: i,
            label: fn.noFunction ? `F${i}` : fn.name,
            isMomentary: fn.isMomentary,
            disabled: fn.noFunction,
        }))
    }
    return Array.from({ length: MAX_FUNCTIONS }, (_, i) => ({
        index: i,
        label: `F${i}`,
        isMomentary: false,
        disabled: false,
    }))
}
