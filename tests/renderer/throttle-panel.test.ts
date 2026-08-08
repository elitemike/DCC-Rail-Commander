import { describe, it, expect, vi } from 'vitest'
import { ThrottlePanelCustomElement } from '../../src/renderer/src/components/throttle/throttle-panel'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import type { ThrottleService, ThrottleCabState } from '../../src/renderer/src/services/throttle.service'
import type { Roster } from '../../src/renderer/src/utils/myAutomationParser'

function makePanel(roster: Roster[] = [], throttles: ThrottleCabState[] = []) {
    const panel = Object.create(ThrottlePanelCustomElement.prototype) as ThrottlePanelCustomElement

    const throttleService = {
        throttles,
        acquire: vi.fn(),
        powerOn: vi.fn(),
        powerOff: vi.fn(),
        emergencyStopAll: vi.fn(),
    } as unknown as ThrottleService

    const configEditorState = { roster } as unknown as ConfigEditorState

    Object.assign(panel, {
        throttleService,
        configEditorState,
        addMode: 'roster',
        selectedRosterAddress: null,
        freeformAddress: 3,
    })

    return { panel, throttleService, configEditorState }
}

const THOMAS: Roster = { dccAddress: 3, name: 'Thomas', functions: [], comment: '' }
const PERCY: Roster = { dccAddress: 5, name: 'Percy', functions: [], comment: '' }

function cab(n: number): ThrottleCabState {
    return { cab: n, name: `Cab ${n}`, speed: 0, direction: 1, functions: [] }
}

describe('ThrottlePanelCustomElement.availableRosterOptions', () => {
    it('maps roster entries to dropdown options', () => {
        const { panel } = makePanel([THOMAS, PERCY])
        expect(panel.availableRosterOptions).toEqual([
            { text: 'Thomas (3)', value: 3 },
            { text: 'Percy (5)', value: 5 },
        ])
    })

    it('excludes locos that are already acquired', () => {
        const { panel } = makePanel([THOMAS, PERCY], [cab(3)])
        expect(panel.availableRosterOptions).toEqual([{ text: 'Percy (5)', value: 5 }])
    })

    it('a released loco reappears (options are derived live from throttleService.throttles)', () => {
        const { panel, throttleService } = makePanel([THOMAS, PERCY], [cab(3)])
        expect(panel.availableRosterOptions).toEqual([{ text: 'Percy (5)', value: 5 }])
        // Simulate release(): the card removes itself from the same array instance.
        ;(throttleService.throttles as ThrottleCabState[]).length = 0
        expect(panel.availableRosterOptions).toEqual([
            { text: 'Thomas (3)', value: 3 },
            { text: 'Percy (5)', value: 5 },
        ])
    })
})

describe('ThrottlePanelCustomElement.rosterFunctionsFor', () => {
    it('returns the matched roster loco\'s functions', () => {
        const entry: Roster = { ...THOMAS, functions: [{ name: 'Light', isMomentary: false, noFunction: false }] }
        const { panel } = makePanel([entry])
        expect(panel.rosterFunctionsFor(3)).toBe(entry.functions)
    })

    it('returns the same stable empty-array reference for an unmatched cab (avoids bindable churn)', () => {
        const { panel } = makePanel([THOMAS])
        const first = panel.rosterFunctionsFor(99)
        const second = panel.rosterFunctionsFor(99)
        expect(first).toEqual([])
        expect(first).toBe(second)
    })
})

describe('ThrottlePanelCustomElement.isRosterLoco', () => {
    it('is true for a cab that matches a roster entry, false otherwise', () => {
        const { panel } = makePanel([THOMAS])
        expect(panel.isRosterLoco(3)).toBe(true)
        expect(panel.isRosterLoco(99)).toBe(false)
    })
})

describe('ThrottlePanelCustomElement.addSelected', () => {
    it('acquires the selected roster loco by name when addMode is "roster"', () => {
        const { panel, throttleService } = makePanel([THOMAS])
        panel.addMode = 'roster'
        panel.selectedRosterAddress = 3
        panel.addSelected()
        expect(throttleService.acquire).toHaveBeenCalledWith(3, 'Thomas')
    })

    it('does nothing when addMode is "roster" and nothing is selected', () => {
        const { panel, throttleService } = makePanel([THOMAS])
        panel.addMode = 'roster'
        panel.selectedRosterAddress = null
        panel.addSelected()
        expect(throttleService.acquire).not.toHaveBeenCalled()
    })

    it('clears the roster selection after acquiring, so the same loco cannot be re-added twice in a row', () => {
        const { panel } = makePanel([THOMAS])
        panel.addMode = 'roster'
        panel.selectedRosterAddress = 3
        panel.addSelected()
        expect(panel.selectedRosterAddress).toBeNull()
    })

    it('acquires the typed address with no name when addMode is "address"', () => {
        const { panel, throttleService } = makePanel()
        panel.addMode = 'address'
        panel.freeformAddress = 42
        panel.addSelected()
        expect(throttleService.acquire).toHaveBeenCalledWith(42)
    })

    it('does nothing for a non-positive address', () => {
        const { panel, throttleService } = makePanel()
        panel.addMode = 'address'
        panel.freeformAddress = 0
        panel.addSelected()
        expect(throttleService.acquire).not.toHaveBeenCalled()
    })
})

describe('ThrottlePanelCustomElement power + e-stop', () => {
    it('delegates powerOn/powerOff/emergencyStopAll to the service', () => {
        const { panel, throttleService } = makePanel()
        panel.powerOn()
        panel.powerOff()
        panel.emergencyStopAll()
        expect(throttleService.powerOn).toHaveBeenCalledOnce()
        expect(throttleService.powerOff).toHaveBeenCalledOnce()
        expect(throttleService.emergencyStopAll).toHaveBeenCalledOnce()
    })
})
