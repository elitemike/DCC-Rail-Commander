/**
 * Every × / trash button that removes something in the GUI must ask first. For each handler this
 * checks both directions: cancelling the confirm dialog leaves the data untouched (the "blocks"
 * guarantee), and confirming it performs the removal.
 */
import { describe, it, expect, vi } from 'vitest'

// Workspace/Home pull in dccex-validators.ts, which imports the real monaco-editor package — it
// touches `window` at module scope and crashes under vitest's node environment (same mock as
// workspace.test.ts).
vi.mock('monaco-editor', () => ({
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
        setModelMarkers: vi.fn(),
        getModels: () => [],
        getModelMarkers: () => [],
        onDidCreateModel: vi.fn(),
        onDidChangeMarkers: vi.fn(() => ({ dispose: vi.fn() })),
    },
}))

import { makeDialogService } from './dialog-service-stub'
import { SensorsEditorCustomElement } from '../../src/renderer/src/components/visual-editors/sensors-editor'
import { SignalsEditorCustomElement } from '../../src/renderer/src/components/visual-editors/signals-editor'
import { AliasesEditorCustomElement } from '../../src/renderer/src/components/visual-editors/aliases-editor'
import { AutomationsEditorCustomElement } from '../../src/renderer/src/components/visual-editors/automations-editor'
import { RoutesEditorCustomElement } from '../../src/renderer/src/components/visual-editors/routes-editor'
import { SequencesEditorCustomElement } from '../../src/renderer/src/components/visual-editors/sequences-editor'
import { EventHandlersEditorCustomElement } from '../../src/renderer/src/components/visual-editors/event-handlers-editor'
import { RosterEditorCustomElement } from '../../src/renderer/src/components/visual-editors/roster-editor'
import { HalDevicesFormCustomElement } from '../../src/renderer/src/components/config-forms/hal-devices-form'
import { Home } from '../../src/renderer/src/views/home'
import { Workspace } from '../../src/renderer/src/views/workspace'

type DialogStub = ReturnType<typeof makeDialogService>

interface RemovalCase {
    name: string
    /** Builds an editor wired to `dialogService` holding exactly two entries. */
    build: (dialogService: DialogStub) => { remove: () => Promise<unknown>; count: () => number }
}

function create<T extends object>(proto: object, fields: Record<string, unknown>): T {
    return Object.assign(Object.create(proto), fields) as T
}

const stubState = (extra: Record<string, unknown>) => ({
    syncAll: vi.fn(),
    getPrimaryAliasNameForId: vi.fn().mockReturnValue(''),
    ...extra,
})

const cases: RemovalCase[] = [
    {
        name: 'sensors-editor removeSensor',
        build: dialogService => {
            const state = stubState({ sensors: [{ id: 30, description: 'A' }, { id: 31, description: 'B' }], aliases: [] })
            const editor = create<SensorsEditorCustomElement>(SensorsEditorCustomElement.prototype, {
                state, dialogService, _idBeforeEdit: new Map(), _rowBeforeEdit: new Map(),
            })
            return { remove: () => editor.removeSensor(0), count: () => state.sensors.length }
        },
    },
    {
        name: 'signals-editor removeSignal',
        build: dialogService => {
            const state = stubState({
                signals: [
                    { type: 'DCC', id: 1, addr: 10, subAddr: 0 },
                    { type: 'DCC', id: 2, addr: 11, subAddr: 0 },
                ],
            })
            const editor = create<SignalsEditorCustomElement>(SignalsEditorCustomElement.prototype, { state, dialogService })
            return { remove: () => editor.removeSignal(0), count: () => state.signals.length }
        },
    },
    {
        name: 'aliases-editor removeAlias',
        build: dialogService => {
            const state = stubState({
                aliases: [{ name: 'A', value: '1' }, { name: 'B', value: '2' }],
            })
            const editor = create<AliasesEditorCustomElement>(AliasesEditorCustomElement.prototype, {
                state, dialogService, errorMessage: '', lastValidAliases: [],
                cloneAliases: (a: unknown[]) => a.map(x => ({ ...(x as object) })),
            })
            return { remove: () => editor.removeAlias(0), count: () => state.aliases.length }
        },
    },
    {
        name: 'automations-editor removeAutomation',
        build: dialogService => {
            const state = stubState({
                automations: [{ id: 1, description: 'A', body: '' }, { id: 2, description: 'B', body: '' }],
            })
            const editor = create<AutomationsEditorCustomElement>(AutomationsEditorCustomElement.prototype, {
                state, dialogService, selectedId: 2,
            })
            return { remove: () => editor.removeAutomation(0), count: () => state.automations.length }
        },
    },
    {
        name: 'routes-editor removeRoute',
        build: dialogService => {
            const state = stubState({
                routes: [{ id: 1, description: 'A', body: '' }, { id: 2, description: 'B', body: '' }],
            })
            const editor = create<RoutesEditorCustomElement>(RoutesEditorCustomElement.prototype, {
                state, dialogService, selectedId: 2,
            })
            return { remove: () => editor.removeRoute(0), count: () => state.routes.length }
        },
    },
    {
        name: 'sequences-editor removeSequence',
        build: dialogService => {
            const state = stubState({
                sequences: [{ id: 1, description: 'A', body: '' }, { id: 2, description: 'B', body: '' }],
            })
            const editor = create<SequencesEditorCustomElement>(SequencesEditorCustomElement.prototype, {
                state, dialogService, selectedId: 2,
            })
            return { remove: () => editor.removeSequence(0), count: () => state.sequences.length }
        },
    },
    {
        name: 'event-handlers-editor removeEventHandler',
        build: dialogService => {
            const state = stubState({
                eventHandlers: [
                    { command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nDONE' },
                    { command: 'ONRAILSYNCOFF', text: 'ONRAILSYNCOFF\nDONE' },
                ],
            })
            const editor = create<EventHandlersEditorCustomElement>(EventHandlersEditorCustomElement.prototype, {
                state, dialogService, selectedIndex: 1, blockCanvas: null, rowRawEditor: null,
            })
            return { remove: () => editor.removeEventHandler(0), count: () => state.eventHandlers.length }
        },
    },
    {
        name: 'roster-editor removeFunction (function key row)',
        build: dialogService => {
            const buffer = {
                functions: [
                    { name: 'Light', isMomentary: false, noFunction: false },
                    { name: 'Horn', isMomentary: true, noFunction: false },
                ],
            }
            const editor = create<RosterEditorCustomElement>(RosterEditorCustomElement.prototype, {
                dialogService, editBuffer: buffer, commitBuffer: vi.fn(),
            })
            return { remove: () => editor.removeFunction(0), count: () => buffer.functions.length }
        },
    },
    {
        name: 'roster-editor removeGroupFunction (group function row)',
        build: dialogService => {
            const state = { updateDefineFunctions: vi.fn() }
            const editor = create<RosterEditorCustomElement>(RosterEditorCustomElement.prototype, {
                state, dialogService, selectedMacroName: 'GROUP',
                groupFunctions: [
                    { name: 'Light', isMomentary: false, noFunction: false },
                    { name: 'Horn', isMomentary: true, noFunction: false },
                ],
            })
            return { remove: () => editor.removeGroupFunction(0), count: () => editor.groupFunctions.length }
        },
    },
    {
        name: 'hal-devices-form removeDevice',
        build: dialogService => {
            const form = create<HalDevicesFormCustomElement>(HalDevicesFormCustomElement.prototype, {
                dialogService, onFieldChange: vi.fn(),
                devices: [
                    { instanceId: 'a', boardId: 'MCP23017', label: 'Block A' },
                    { instanceId: 'b', boardId: 'MCP23017', label: 'Block B' },
                ],
            })
            return { remove: () => form.removeDevice(0), count: () => form.devices.length }
        },
    },
    {
        name: 'home deleteConfig (saved configuration)',
        build: dialogService => {
            const state = {
                savedConfigurations: [{ id: '1', name: 'Layout A' }, { id: '2', name: 'Layout B' }],
            }
            const home = create<Home>(Home.prototype, { state, dialogService, preferences: { set: vi.fn() } })
            const event = { stopPropagation: vi.fn() } as unknown as Event
            return {
                remove: () => home.deleteConfig(state.savedConfigurations[0] as never, event),
                count: () => state.savedConfigurations.length,
            }
        },
    },
    {
        name: 'workspace deleteConfig (device list)',
        build: dialogService => {
            const state = {
                savedConfigurations: [{ id: '1', name: 'Layout A' }, { id: '2', name: 'Layout B' }],
                activeConfigId: '2',
            }
            const workspace = create<Workspace>(Workspace.prototype, {
                state, dialogService, preferences: { set: vi.fn() },
                savedConfigs: [...state.savedConfigurations],
            })
            const event = { stopPropagation: vi.fn() } as unknown as Event
            return {
                remove: () => workspace.deleteConfig(state.savedConfigurations[0] as never, event),
                count: () => state.savedConfigurations.length,
            }
        },
    },
]

describe.each(cases)('removal confirmation — $name', ({ build }) => {
    it('shows a confirm dialog and removes nothing when it is cancelled', async () => {
        const dialogService = makeDialogService('cancel')
        const { remove, count } = build(dialogService)

        await remove()

        expect(dialogService.open).toHaveBeenCalledOnce()
        expect(count()).toBe(2)
    })

    it('removes the entry once the dialog is confirmed', async () => {
        const dialogService = makeDialogService('ok')
        const { remove, count } = build(dialogService)

        await remove()

        expect(dialogService.open).toHaveBeenCalledOnce()
        expect(count()).toBe(1)
    })
})

describe('removal confirmation — roster-editor removeAppendedFunction', () => {
    it('shows a confirm dialog and removes nothing when it is cancelled', async () => {
        const dialogService = makeDialogService('cancel')
        const list = [
            { name: 'Light', isMomentary: false, noFunction: false },
            { name: 'Horn', isMomentary: true, noFunction: false },
        ]
        const editor = create<RosterEditorCustomElement>(RosterEditorCustomElement.prototype, {
            dialogService, appendedFunctionsList: list, editBuffer: { appendedFunctions: [...list] },
        })

        await editor.removeAppendedFunction(0)

        expect(dialogService.open).toHaveBeenCalledOnce()
        expect(editor.appendedFunctionsList).toHaveLength(2)
    })
})
