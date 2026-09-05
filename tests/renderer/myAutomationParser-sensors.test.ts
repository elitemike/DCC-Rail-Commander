import { describe, expect, it } from 'vitest'

import { parseSensorsFromFile, serializeSensorsToFile } from '../../src/renderer/src/utils/myAutomationParser'

// mySensors.h is pure bookkeeping for this app's own Visual editor, not compiled EXRAIL — see
// parseSensorsFromFile's doc comment in myAutomationParser.ts. The canonical form is a plain
// `// Sensor <pin> - <description>` comment.
describe('parseSensorsFromFile — canonical comment form', () => {
    it('parses a sensor with a description', () => {
        const sensors = parseSensorsFromFile('// Sensor 30 - Occupancy')
        expect(sensors).toEqual([{ id: 30, description: 'Occupancy' }])
    })

    it('parses a sensor with no description', () => {
        const sensors = parseSensorsFromFile('// Sensor 30')
        expect(sensors).toEqual([{ id: 30, description: '' }])
    })

    it('is case-insensitive on the "Sensor" label and tolerant of extra spacing', () => {
        const sensors = parseSensorsFromFile('  //   sensor   30   -   Occupancy  ')
        expect(sensors).toEqual([{ id: 30, description: 'Occupancy' }])
    })

    it('parses multiple sensors in file order', () => {
        const file = '// Sensor 30 - Occupancy A\n// Sensor 31 - Occupancy B'
        expect(parseSensorsFromFile(file)).toEqual([
            { id: 30, description: 'Occupancy A' },
            { id: 31, description: 'Occupancy B' },
        ])
    })

    it('ignores an unrelated comment line', () => {
        expect(parseSensorsFromFile('// just a note, not a sensor')).toEqual([])
    })
})

// EXRAIL's real JMRI_SENSOR(vpin[, count]) macro (declares a sensor visible to JMRI/
// WiThrottle) is still read on load — a hand-written project can genuinely have one — so an
// existing project's sensors show up and its VPins are accounted for, but it's never written
// back; see serializeSensorsToFile below. There is no other backward-compat form: this app
// never shipped a standalone "SENSOR" declaration, because that was never real EXRAIL to begin
// with — nothing to stay compatible with.
describe('parseSensorsFromFile — backward compatibility with JMRI_SENSOR', () => {
    it('parses a real JMRI_SENSOR(vpin), using the trailing comment as the description', () => {
        const sensors = parseSensorsFromFile('JMRI_SENSOR(30) // Occupancy')
        expect(sensors).toEqual([{ id: 30, description: 'Occupancy' }])
    })

    it('parses JMRI_SENSOR_NOPULLUP the same way', () => {
        const sensors = parseSensorsFromFile('JMRI_SENSOR_NOPULLUP(30) // Occupancy')
        expect(sensors).toEqual([{ id: 30, description: 'Occupancy' }])
    })

    it('expands a JMRI_SENSOR count > 1 into individual entries, each addressable by its own pin', () => {
        const sensors = parseSensorsFromFile('JMRI_SENSOR(276, 3)')
        expect(sensors).toEqual([
            { id: 276, description: '' },
            { id: 277, description: '' },
            { id: 278, description: '' },
        ])
    })

    it('mixes canonical comment and JMRI_SENSOR forms in file order', () => {
        const file = '// Sensor 5 - Panel Light\nJMRI_SENSOR(30) // Occupancy'
        expect(parseSensorsFromFile(file)).toEqual([
            { id: 5, description: 'Panel Light' },
            { id: 30, description: 'Occupancy' },
        ])
    })
})

describe('serializeSensorsToFile', () => {
    it('always writes the canonical bookkeeping comment, never a macro', () => {
        expect(serializeSensorsToFile([{ id: 30, description: '' }])).toBe('// Sensor 30')
        expect(serializeSensorsToFile([{ id: 30, description: 'Occupancy' }])).toBe('// Sensor 30 - Occupancy')
    })

    it('round-trips through parseSensorsFromFile', () => {
        const sensors = [{ id: 30, description: 'Occupancy' }, { id: 31, description: '' }]
        expect(parseSensorsFromFile(serializeSensorsToFile(sensors))).toEqual(sensors)
    })
})
