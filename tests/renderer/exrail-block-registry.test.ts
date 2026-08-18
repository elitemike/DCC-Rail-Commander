import { describe, it, expect, vi } from 'vitest'

vi.mock('monaco-editor', () => ({
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
        setModelMarkers: vi.fn(),
        getModels: () => [],
        onDidCreateModel: vi.fn(),
    },
}))

import { BLOCK_REGISTRY } from '../../src/renderer/src/components/visual-editors/exrail-block-registry'
import type { DefinedObjects } from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'
import { _runValidatorsForTest } from '../../src/renderer/src/config/dccex-validators'

const EMPTY: DefinedObjects = { roster: [], turnouts: [], sensors: [], signals: [], routes: [], sequences: [], aliases: [] }

const POPULATED: DefinedObjects = {
    roster: [{ dccAddress: 3, name: 'Loco', functions: [], comment: '' }],
    turnouts: [{ type: 'DCC', id: 200, addr: 1, subAddr: 0, description: '', defaultState: 'CLOSED' }],
    sensors: [{ id: 100, pin: 2, description: '' }],
    signals: [{ red: 1, amber: 2, green: 3 }],
    routes: [{ id: 1, description: '', body: '' }],
    sequences: [{ id: 1, body: '' }],
    aliases: [],
}

describe('BLOCK_REGISTRY isAvailable gating', () => {
    const byId = new Map(BLOCK_REGISTRY.map((b) => [b.id, b]))

    it('always allows ROUTE, SEQUENCE, DELAY, DONE regardless of defined objects', () => {
        for (const id of ['ROUTE', 'SEQUENCE', 'DELAY', 'DONE']) {
            expect(byId.get(id)!.isAvailable(EMPTY)).toBe(true)
        }
    })

    it('gates THROW/CLOSE/IFCLOSED/IFTHROWN on turnouts existing', () => {
        for (const id of ['THROW', 'CLOSE', 'IFCLOSED', 'IFTHROWN']) {
            expect(byId.get(id)!.isAvailable(EMPTY)).toBe(false)
            expect(byId.get(id)!.isAvailable(POPULATED)).toBe(true)
        }
    })

    it('gates RED/AMBER/GREEN on signals existing', () => {
        for (const id of ['RED', 'AMBER', 'GREEN']) {
            expect(byId.get(id)!.isAvailable(EMPTY)).toBe(false)
            expect(byId.get(id)!.isAvailable(POPULATED)).toBe(true)
        }
    })

    it('gates IF/IFNOT on sensors existing', () => {
        for (const id of ['IF', 'IFNOT']) {
            expect(byId.get(id)!.isAvailable(EMPTY)).toBe(false)
            expect(byId.get(id)!.isAvailable(POPULATED)).toBe(true)
        }
    })

    it('gates FOLLOW on a route or sequence existing', () => {
        expect(byId.get('FOLLOW')!.isAvailable(EMPTY)).toBe(false)
        expect(byId.get('FOLLOW')!.isAvailable({ ...EMPTY, routes: [{ id: 1, description: '', body: '' }] })).toBe(true)
        expect(byId.get('FOLLOW')!.isAvailable({ ...EMPTY, sequences: [{ id: 1, body: '' }] })).toBe(true)
    })

    it('gates SETLOCO/XFON/XFOFF on roster entries existing', () => {
        for (const id of ['SETLOCO', 'XFON', 'XFOFF']) {
            expect(byId.get(id)!.isAvailable(EMPTY)).toBe(false)
            expect(byId.get(id)!.isAvailable(POPULATED)).toBe(true)
        }
    })

    it('always allows FWD/REV/SPEED/STOP/ESTOP/FON/FOFF regardless of defined objects', () => {
        for (const id of ['FWD', 'REV', 'SPEED', 'STOP', 'ESTOP', 'FON', 'FOFF']) {
            expect(byId.get(id)!.isAvailable(EMPTY)).toBe(true)
        }
    })
})

describe('BLOCK_REGISTRY toolbox categories', () => {
    const byId = new Map(BLOCK_REGISTRY.map((b) => [b.id, b]))

    it('places every non-hat block under a non-empty category', () => {
        for (const block of BLOCK_REGISTRY) {
            if (block.shape === 'hat') continue
            expect(block.category, `${block.id} has no toolbox category`).not.toBe('')
        }
    })

    it('groups locomotive driving and function blocks into nested Locomotives subcategories', () => {
        for (const id of ['SETLOCO', 'FWD', 'REV', 'SPEED', 'STOP', 'ESTOP']) {
            expect(byId.get(id)!.category).toBe('Locomotives/Driving')
        }
        for (const id of ['FON', 'FOFF', 'XFON', 'XFOFF']) {
            expect(byId.get(id)!.category).toBe('Locomotives/Functions')
        }
    })
})

describe('BLOCK_REGISTRY emit() output never trips the EXRAIL casing/reference validators', () => {
    it('every stack/branch/cap block emits text with no casing or reference diagnostics', () => {
        const exrailData = {
            roster: POPULATED.roster,
            turnouts: POPULATED.turnouts,
            sensors: POPULATED.sensors,
            routes: POPULATED.routes,
            sequences: POPULATED.sequences,
            aliases: POPULATED.aliases,
        }

        const idForKind: Record<string, string | number> = {
            turnoutRef: POPULATED.turnouts[0].id,
            sensorRef: POPULATED.sensors![0].id,
            rosterRef: POPULATED.roster[0].dccAddress,
            routeOrSequenceRef: POPULATED.routes![0].id,
            signalRef: POPULATED.signals[0].red,
            number: 1,
            string: 'x',
        }

        for (const block of BLOCK_REGISTRY) {
            if (block.shape === 'hat') continue

            const paramValues: Record<string, string | number> = {}
            for (const p of block.params) {
                paramValues[p.name] = idForKind[p.kind]
            }
            const line = block.emit(paramValues)

            const markers = _runValidatorsForTest('myRoutes.h', `ROUTE(1, "Test")\n${line}\nDONE`, exrailData)
            expect(markers, `${block.id} emitted "${line}" which produced diagnostics: ${JSON.stringify(markers)}`).toHaveLength(0)
        }
    })
})
