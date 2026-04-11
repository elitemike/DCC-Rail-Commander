import { describe, expect, it } from 'vitest'

import { getCompletions } from '../../src/renderer/src/config/file-configs'
import {
    buildExrailSymbolSuggestions,
    getExrailCommandContext,
} from '../../src/renderer/src/utils/exrail-completions'

const COMPLETION_DATA = {
    aliases: [
        { name: 'BLUE_ENGINE', value: '3', aliasType: 'Roster' as const },
        { name: 'YARD_SENSOR', value: '40', aliasType: 'Sensor' as const },
        { name: 'JUNCTION_MAIN', value: '200', aliasType: 'Turnout' as const },
        { name: 'COAL_ROUTE', value: '12', aliasType: 'Route' as const },
        { name: 'SHUTTLE_RUN', value: '66', aliasType: 'Sequence' as const },
    ],
    roster: [{ dccAddress: 3, name: 'Thomas', functions: [], comment: '' }],
    turnouts: [{ id: 200, type: 'SERVO' as const, pin: 25, activeAngle: 410, inactiveAngle: 205, profile: 'Slow' as const, description: 'Main Line Junction', defaultState: 'NORMAL' as const }],
    sensors: [{ id: 40, pin: 17, description: 'Yard Occupancy' }],
    routes: [{ id: 12, description: 'Coal Yard Exit', body: '  THROW(200)' }],
    sequences: [{ id: 66, body: '  FWD(30)' }],
}

describe('EXRAIL completion helpers', () => {
    it('parses the active command and argument index from the current line', () => {
        expect(getExrailCommandContext('  SENDLOCO(3, ')).toEqual({ command: 'SENDLOCO', argumentIndex: 1 })
        expect(getExrailCommandContext('  THROW(')).toEqual({ command: 'THROW', argumentIndex: 0 })
    })

    it('offers turnout aliases and numeric IDs for turnout commands', () => {
        const suggestions = buildExrailSymbolSuggestions('myRoutes.h', '  THROW(', COMPLETION_DATA)
        expect(suggestions.map(s => s.label)).toContain('JUNCTION_MAIN')
        expect(suggestions.map(s => s.label)).toContain('200')
        expect(suggestions.map(s => s.label)).not.toContain('YARD_SENSOR')
    })

    it('offers roster symbols for the first SENDLOCO argument and route or sequence symbols for the second', () => {
        const locoSuggestions = buildExrailSymbolSuggestions('myAutomation.h', '  SENDLOCO(', COMPLETION_DATA)
        expect(locoSuggestions.map(s => s.label)).toContain('BLUE_ENGINE')
        expect(locoSuggestions.map(s => s.label)).toContain('3')
        expect(locoSuggestions.map(s => s.label)).not.toContain('COAL_ROUTE')

        const targetSuggestions = buildExrailSymbolSuggestions('myAutomation.h', '  SENDLOCO(3, ', COMPLETION_DATA)
        expect(targetSuggestions.map(s => s.label)).toContain('COAL_ROUTE')
        expect(targetSuggestions.map(s => s.label)).toContain('SHUTTLE_RUN')
        expect(targetSuggestions.map(s => s.label)).toContain('12')
        expect(targetSuggestions.map(s => s.label)).toContain('66')
        expect(targetSuggestions.map(s => s.label)).not.toContain('BLUE_ENGINE')
    })

    it('offers sensor and route symbols for handler/state commands', () => {
        const onButtonSuggestions = buildExrailSymbolSuggestions('myAutomation.h', '  ONBUTTON(', COMPLETION_DATA)
        expect(onButtonSuggestions.map(s => s.label)).toContain('YARD_SENSOR')
        expect(onButtonSuggestions.map(s => s.label)).toContain('40')

        const routeStateSuggestions = buildExrailSymbolSuggestions('myRoutes.h', '  ROUTE_ACTIVE(', COMPLETION_DATA)
        expect(routeStateSuggestions.map(s => s.label)).toContain('COAL_ROUTE')
        expect(routeStateSuggestions.map(s => s.label)).toContain('12')
        expect(routeStateSuggestions.map(s => s.label)).not.toContain('SHUTTLE_RUN')
    })

    it('exposes EXRAIL body commands in routes and sequences editors', () => {
        expect(getCompletions('myRoutes.h').map(s => s.label)).toContain('THROW')
        expect(getCompletions('mySequences.h').map(s => s.label)).toContain('AT')
        expect(getCompletions('mySequences.h').map(s => s.label)).toContain('FOLLOW')
        expect(getCompletions('myRoutes.h').map(s => s.label)).toContain('DONE')
        expect(getCompletions('myRoutes.h').map(s => s.label)).toContain('ELSE')
        expect(getCompletions('myRoutes.h').map(s => s.label)).toContain('ENDIF')
        expect(getCompletions('myRoutes.h').map(s => s.label)).toContain('ONBUTTON')
        expect(getCompletions('myRoutes.h').map(s => s.label)).toContain('IFROUTE_ACTIVE')

        const doneSnippet = getCompletions('myRoutes.h').find(s => s.label === 'DONE')
        expect(doneSnippet?.insertText).toBe('DONE')
    })
})