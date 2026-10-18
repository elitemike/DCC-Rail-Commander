import { describe, it, expect } from 'vitest'

import { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'

// Same Object.create construction as config-editor-state-event-handlers.test.ts (bypasses the
// constructor's DI call; @observable fields need real own-property descriptors).
function makeState(myTurnouts: string): ConfigEditorState {
    const state = Object.create(ConfigEditorState.prototype) as ConfigEditorState
    for (const field of ['roster', 'turnouts', 'turnoutFolders', 'sensorFolders', 'eventHandlerFolders', 'aliasFolders', 'rosterFolders', 'signalFolders', 'routeFolders', 'sequenceFolders', 'automationFolders', 'sensors', 'signals', 'routes', 'automations', 'sequences', 'eventHandlers', 'aliases']) {
        Object.defineProperty(state, field, { value: [], writable: true, enumerable: true, configurable: true })
    }
    Object.assign(state, {
        installerState: { appVersion: '0.1.0', configFiles: [{ name: 'myTurnouts.h', content: myTurnouts }], selectedDevice: null },
        aliasSortOrder: { value: 'name' },
        configHContent: '',
        hasChanges: false,
        rosterPreservedComments: '',
        turnoutPreservedComments: '',
        preservedAutomationContent: '',
        generatedHalDevicesContent: '',
        generatedTrackManagerContent: '',
        generatedTurnoutDefaultsContent: '',
    })
    state.loadFromInstallerState()
    return state
}

const FILE = [
    '// @tree-folder: Spare',
    '// @tree: Yard',
    'VIRTUAL_TURNOUT(300, "Yard Hub")',
    '// @tree: #300',
    'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")',
    'SERVO_TURNOUT(201, 26, 410, 205, Fast, "Yard Entry")',
].join('\n')

const byId = (state: ConfigEditorState, id: number) => state.turnouts.find(t => t.id === id)!
const macroLines = (text: string) => text.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'))

describe('ConfigEditorState — turnout tree', () => {
    it('loads placement and declared folders from myTurnouts.h, and writes them back unchanged', () => {
        const state = makeState(FILE)

        expect(byId(state, 300).folder).toBe('Yard')
        expect(byId(state, 200).parentId).toBe(300)
        expect(byId(state, 201).folder).toBeUndefined()
        expect(state.turnoutFolders).toEqual(['Spare'])

        const raw = state.turnoutsRaw
        expect(raw).toContain('// @tree-folder: Spare')
        expect(raw).toContain('// @tree: Yard\nVIRTUAL_TURNOUT(300, "Yard Hub")')
        expect(raw).toContain('// @tree: #300\nSERVO_TURNOUT(200')
    })

    it('a raw edit replaces placement and declared folders along with the turnouts', () => {
        const state = makeState(FILE)
        state.setTurnoutsFromRaw('// @tree: Depot\nSERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line Junction")')

        expect(state.turnouts).toHaveLength(1)
        expect(state.turnouts[0].folder).toBe('Depot')
        expect(state.turnoutFolders).toEqual([])
    })

    it('never changes the EXRAIL macro lines — only the // comments carry the tree', () => {
        const state = makeState(FILE)
        const before = macroLines(state.turnoutsRaw)
        state.moveTurnoutTo(state.turnouts.findIndex(t => t.id === 201), { folder: 'Somewhere/Else' })
        state.addTurnoutFolder('Another')
        state.renameTurnoutFolder('Yard', 'Depot')

        expect(macroLines(state.turnoutsRaw)).toEqual(before)
    })

    it('changing a VIRTUAL parent’s ID keeps its children attached', () => {
        const state = makeState(FILE)
        const idx = state.turnouts.findIndex(t => t.id === 300)

        state.updateTurnoutEntry(idx, { ...state.turnouts[idx], id: 310 })

        expect(byId(state, 200).parentId).toBe(310)
    })

    it('turning a VIRTUAL parent into another kind hands its children to the parent’s own folder', () => {
        const state = makeState(FILE)
        const idx = state.turnouts.findIndex(t => t.id === 300)

        state.updateTurnoutEntry(idx, { type: 'PIN', id: 300, pin: 40, description: 'Yard Hub', comment: '', defaultState: 'CLOSED', folder: 'Yard' })

        expect(byId(state, 200).parentId).toBeUndefined()
        expect(byId(state, 200).folder).toBe('Yard')
    })

    it('deleting a VIRTUAL parent moves its children up instead of orphaning them', () => {
        const state = makeState(FILE)

        state.removeTurnoutEntry(state.turnouts.findIndex(t => t.id === 300))

        expect(state.turnouts.map(t => t.id).sort()).toEqual([200, 201])
        expect(byId(state, 200).parentId).toBeUndefined()
        expect(byId(state, 200).folder).toBe('Yard')
    })

    it('folder operations validate names and report collisions', () => {
        const state = makeState(FILE)

        expect(state.addTurnoutFolder('Yard')).toBe(false) // exists
        expect(state.addTurnoutFolder('  ')).toBe(false)
        expect(state.addTurnoutFolder('New/Nested')).toBe(true)
        expect(state.renameTurnoutFolder('Spare', 'Yard')).toBe(false) // taken
        expect(state.renameTurnoutFolder('Spare', 'Reserve')).toBe(true)
        expect(state.turnoutFolders).toContain('Reserve')
    })

    describe('virtual turnout events (myEvents.h)', () => {
        const withEvents = () => {
            const state = makeState(FILE)
            state.installerState.configFiles.push({ name: 'myEvents.h', content: '' })
            state.setEventHandlersFromRaw('ONCLOSE(300)\nCLOSE(200)\nDONE\n\nONTHROW(300)\nTHROW(200)\nDONE')
            return state
        }
        const texts = (state: ConfigEditorState) => state.eventHandlers.map(h => h.text)

        it('moving a turnout under a virtual parent adds it to that parent’s handlers, moving out removes it', () => {
            const state = withEvents()
            const idx = state.turnouts.findIndex(t => t.id === 201)

            state.moveTurnoutTo(idx, { parentId: 300 })
            expect(texts(state)).toEqual(['ONCLOSE(300)\nCLOSE(200)\nCLOSE(201)\nDONE', 'ONTHROW(300)\nTHROW(200)\nTHROW(201)\nDONE'])
            expect(state.installerState.configFiles.find(f => f.name === 'myEvents.h')!.content).toContain('CLOSE(201)')

            state.moveTurnoutTo(idx, { folder: 'Yard' })
            expect(texts(state)).toEqual(['ONCLOSE(300)\nCLOSE(200)\nDONE', 'ONTHROW(300)\nTHROW(200)\nDONE'])
        })

        it('adding a turnout directly under a virtual parent wires it up, and deleting it unwires it', () => {
            const state = withEvents()
            state.addTurnoutEntry({ type: 'PIN', id: 250, pin: 40, description: 'New', comment: '', defaultState: 'CLOSED', parentId: 300 })
            expect(texts(state)[0]).toContain('CLOSE(250)')

            state.removeTurnoutEntry(state.turnouts.findIndex(t => t.id === 250))
            expect(texts(state)[0]).not.toContain('250')
        })

        it('creates the handlers when the virtual parent has none yet', () => {
            const state = makeState(FILE)
            state.moveTurnoutTo(state.turnouts.findIndex(t => t.id === 201), { parentId: 300 })
            expect(texts(state)).toEqual(['ONCLOSE(300)\nCLOSE(201)\nDONE', 'ONTHROW(300)\nTHROW(201)\nDONE'])
        })

        it('uses the turnouts’ aliases from myAliases.h when generating events', () => {
            const state = makeState(FILE)
            state.aliases = [
                { name: 'YARD_HUB', value: '300', aliasType: 'Turnout' },
                { name: 'YARD_ENTRY', value: '201', aliasType: 'Turnout' },
            ]
            state.moveTurnoutTo(state.turnouts.findIndex(t => t.id === 201), { parentId: 300 })
            expect(texts(state)).toEqual(['ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nDONE', 'ONTHROW(YARD_HUB)\nTHROW(YARD_ENTRY)\nDONE'])
        })

        it('re-spells the events when an alias is added or renamed after the turnout was placed', () => {
            const state = makeState(FILE)
            state.strictAliases = false
            state.moveTurnoutTo(state.turnouts.findIndex(t => t.id === 201), { parentId: 300 })
            expect(texts(state)).toEqual(['ONCLOSE(300)\nCLOSE(201)\nDONE', 'ONTHROW(300)\nTHROW(201)\nDONE'])

            // The usual order: the alias is entered after the turnout already exists.
            expect(state.syncAliasForId(300, 300, 'YARD_HUB', 'Turnout')).toEqual({ ok: true })
            expect(state.syncAliasForId(201, 201, 'YARD_ENTRY', 'Turnout')).toEqual({ ok: true })
            expect(texts(state)).toEqual(['ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nDONE', 'ONTHROW(YARD_HUB)\nTHROW(YARD_ENTRY)\nDONE'])

            expect(state.syncAliasForId(201, 201, 'SIDING_ENTRY', 'Turnout', 'YARD_ENTRY')).toEqual({ ok: true })
            expect(texts(state)[0]).toBe('ONCLOSE(YARD_HUB)\nCLOSE(SIDING_ENTRY)\nDONE')

            expect(state.syncAliasForId(201, 201, '', 'Turnout', 'SIDING_ENTRY')).toEqual({ ok: true })
            expect(texts(state)[0]).toBe('ONCLOSE(YARD_HUB)\nCLOSE(201)\nDONE')
        })

        it('uses an untyped alias, as the block editor does', () => {
            const state = makeState(FILE)
            state.aliases = [{ name: 'YARD_ENTRY', value: '201' }]
            state.moveTurnoutTo(state.turnouts.findIndex(t => t.id === 201), { parentId: 300 })
            expect(texts(state)[0]).toBe('ONCLOSE(300)\nCLOSE(YARD_ENTRY)\nDONE')
        })

        it('syncVirtualParentEvents wires up children that were tagged by hand', () => {
            const state = makeState(FILE) // 200 is tagged under 300 in the file, but there are no handlers
            expect(state.eventHandlers).toEqual([])
            state.syncVirtualParentEvents(300)
            expect(texts(state)).toEqual(['ONCLOSE(300)\nCLOSE(200)\nDONE', 'ONTHROW(300)\nTHROW(200)\nDONE'])
        })
    })

    it('marks the configuration dirty on tree edits (so Save lights up)', () => {
        const state = makeState(FILE)
        expect(state.hasChanges).toBe(false)

        state.addTurnoutFolder('Fresh')

        expect(state.hasChanges).toBe(true)
    })
})
