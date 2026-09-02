import { describe, expect, it } from 'vitest'

import { parseSensorsFromFile } from '../../src/renderer/src/utils/myAutomationParser'

describe('parseSensorsFromFile — SENSOR', () => {
    it('parses id, pin, and description', () => {
        const sensors = parseSensorsFromFile('SENSOR(1, 30, "Occupancy")')
        expect(sensors).toEqual([{ id: 1, pin: 30, description: 'Occupancy' }])
    })
})

describe('parseSensorsFromFile — JMRI_SENSOR (bulk vpin range)', () => {
    it('expands into `count` individual sensor entries, each addressable by its own pin', () => {
        const sensors = parseSensorsFromFile('JMRI_SENSOR(276, 3)')
        expect(sensors).toEqual([
            { id: 276, pin: 276, description: '' },
            { id: 277, pin: 277, description: '' },
            { id: 278, pin: 278, description: '' },
        ])
    })

    it('coexists with explicit SENSOR declarations in the same file', () => {
        const file = 'SENSOR(1, 30, "Occupancy")\nJMRI_SENSOR(276, 2)'
        const sensors = parseSensorsFromFile(file)
        expect(sensors).toEqual([
            { id: 1, pin: 30, description: 'Occupancy' },
            { id: 276, pin: 276, description: '' },
            { id: 277, pin: 277, description: '' },
        ])
    })
})
