import { describe, it, expect, vi } from 'vitest'
import { EventHandlersEditorCustomElement } from '../../src/renderer/src/components/visual-editors/event-handlers-editor'
import type { ConfigEditorState } from '../../src/renderer/src/models/config-editor-state'
import type { EventHandlerEntry } from '../../src/renderer/src/utils/myAutomationParser'

function makeEditor(eventHandlers: EventHandlerEntry[], turnouts: { id: number; description?: string }[] = []) {
    const editor = Object.create(EventHandlersEditorCustomElement.prototype) as EventHandlersEditorCustomElement

    const state = {
        eventHandlers,
        roster: [],
        turnouts,
        sensors: [],
        signals: [],
        routes: [],
        sequences: [],
        aliases: [],
        hasStackedMotorShield: false,
        syncAll: vi.fn(),
        eventHandlersRaw: '',
        setEventHandlersFromRaw: vi.fn(),
    } as unknown as ConfigEditorState

    Object.assign(editor, {
        state,
        editorDefaultView: { value: 'visual' as const },
        activeTab: 'visual' as const,
        _userChoseTab: false,
        rawEditor: null,
        rawSnapshot: '',
        selectedIndex: null,
        addSelection: '',
        rowTab: {},
        rowRawEditor: null,
        rowRawSnapshot: '',
    })

    return { editor, state }
}

describe('EventHandlersEditorCustomElement.getDisplayName', () => {
    it('combines the registry label with the header line args', () => {
        const { editor } = makeEditor([])
        const name = editor.getDisplayName({ command: 'ONSENSOR', text: 'ONSENSOR(200)\nDONE' })
        expect(name).toBe('On sensor changed (200)')
    })

    it('omits the parens entirely for a zero-arg handler', () => {
        const { editor } = makeEditor([])
        const name = editor.getDisplayName({ command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nPOWERON' })
        expect(name).toBe('On rail sync signal valid')
    })
})

describe('EventHandlersEditorCustomElement.canUseBlocks', () => {
    it('is true for a well-formed handler block', () => {
        const { editor } = makeEditor([])
        expect(editor.canUseBlocks({ command: 'ONSENSOR', text: 'ONSENSOR(200)\nDONE' })).toBe(true)
    })

    it('is false for a body line the registry does not recognize', () => {
        const { editor } = makeEditor([])
        expect(editor.canUseBlocks({ command: 'ONSENSOR', text: 'ONSENSOR(200)\nFROBNICATE(1)' })).toBe(false)
    })
})

describe('EventHandlersEditorCustomElement.addableGroups', () => {
    it('gates a turnout-scoped handler behind hasTurnouts', () => {
        const { editor: withoutTurnouts } = makeEditor([])
        const noTurnoutIds = withoutTurnouts.addableGroups.flatMap(g => g.defs.map(d => d.id))
        expect(noTurnoutIds).not.toContain('ONCLOSE')
        // Zero-arg / unmodeled-object handlers have no gating collection, so they're always offered.
        expect(noTurnoutIds).toContain('ONRAILSYNCON')
    })

    it('includes a turnout-scoped handler once a turnout is defined', () => {
        const { editor } = makeEditor([], [{ id: 200, description: 'Yard switch' }])
        const ids = editor.addableGroups.flatMap(g => g.defs.map(d => d.id))
        expect(ids).toContain('ONCLOSE')
        expect(ids).toContain('ONTHROW')
    })

    it('includes a sensor-gated handler once a sensor is defined', () => {
        const state = { eventHandlers: [], roster: [], turnouts: [], sensors: [{ id: 1, pin: 1, description: '' }], signals: [], routes: [], sequences: [], aliases: [], hasStackedMotorShield: false } as unknown as ConfigEditorState
        const editor = Object.create(EventHandlersEditorCustomElement.prototype) as EventHandlersEditorCustomElement
        Object.assign(editor, { state })
        const ids = editor.addableGroups.flatMap(g => g.defs.map(d => d.id))
        expect(ids).toContain('ONSENSOR')
    })
})

describe('EventHandlersEditorCustomElement.addEventHandler', () => {
    it('appends a new entry seeded with default param values and selects it', () => {
        const { editor, state } = makeEditor([])
        editor.addSelection = 'ONRAILSYNCON'
        editor.blockCanvas = { reload: vi.fn(), refreshSize: vi.fn() }
        editor.rowRawEditor = { flush: vi.fn(), switchModel: vi.fn() }

        editor.addEventHandler()

        expect(state.eventHandlers).toEqual([{ command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nDONE' }])
        expect(state.syncAll).toHaveBeenCalled()
        expect(editor.selectedIndex).toBe(0)
        expect(editor.blockCanvas.reload).toHaveBeenCalledWith('ONRAILSYNCON\nDONE')
    })

    it('seeds a number param to 0 when nothing else provides a default', () => {
        const { editor, state } = makeEditor([])
        editor.addSelection = 'ONBLOCKENTER'
        editor.blockCanvas = { reload: vi.fn(), refreshSize: vi.fn() }
        editor.rowRawEditor = { flush: vi.fn(), switchModel: vi.fn() }

        editor.addEventHandler()

        expect(state.eventHandlers).toEqual([{ command: 'ONBLOCKENTER', text: 'ONBLOCKENTER(0)\nDONE' }])
    })
})

describe('EventHandlersEditorCustomElement.removeEventHandler', () => {
    const handlers = (): EventHandlerEntry[] => [
        { command: 'ONRAILSYNCON', text: 'ONRAILSYNCON\nDONE' },
        { command: 'ONRAILSYNCOFF', text: 'ONRAILSYNCOFF\nDONE' },
        { command: 'ONBLOCKENTER', text: 'ONBLOCKENTER(1)\nDONE' },
    ]

    it('re-selects the nearest remaining entry when the selected row is removed', () => {
        const { editor, state } = makeEditor(handlers())
        editor.selectedIndex = 2
        editor.blockCanvas = { reload: vi.fn(), refreshSize: vi.fn() }
        editor.rowRawEditor = { flush: vi.fn(), switchModel: vi.fn() }

        editor.removeEventHandler(2)

        expect(state.eventHandlers.length).toBe(2)
        expect(editor.selectedIndex).toBe(1)
    })

    it('decrements selectedIndex when a row before it is removed, keeping the same logical entry selected', () => {
        const { editor, state } = makeEditor(handlers())
        editor.selectedIndex = 2 // ONBLOCKENTER
        editor.blockCanvas = { reload: vi.fn(), refreshSize: vi.fn() }
        editor.rowRawEditor = { flush: vi.fn(), switchModel: vi.fn() }

        editor.removeEventHandler(0) // remove ONRAILSYNCON, before the selection

        expect(state.eventHandlers).toEqual([handlers()[1], handlers()[2]])
        expect(editor.selectedIndex).toBe(1)
        expect(state.eventHandlers[editor.selectedIndex!]).toEqual(handlers()[2])
    })

    it('clears selectedIndex when removing the last remaining entry', () => {
        const { editor, state } = makeEditor([handlers()[0]])
        editor.selectedIndex = 0
        editor.blockCanvas = { reload: vi.fn(), refreshSize: vi.fn() }
        editor.rowRawEditor = { flush: vi.fn(), switchModel: vi.fn() }

        editor.removeEventHandler(0)

        expect(state.eventHandlers).toEqual([])
        expect(editor.selectedIndex).toBeNull()
    })
})

describe('EventHandlersEditorCustomElement.selectedTab / setRowTab', () => {
    it('defaults to blocks for a parseable handler', () => {
        const { editor } = makeEditor([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nDONE' }])
        editor.selectedIndex = 0
        expect(editor.selectedTab).toBe('blocks')
    })

    it('falls back to text when the handler body does not parse', () => {
        const { editor } = makeEditor([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nFROBNICATE(1)' }])
        editor.selectedIndex = 0
        expect(editor.selectedTab).toBe('text')
    })

    it('respects an explicit per-row choice over the parseability fallback', () => {
        const { editor } = makeEditor([{ command: 'ONSENSOR', text: 'ONSENSOR(200)\nDONE' }])
        editor.selectedIndex = 0
        editor.setRowTab(0, 'text')
        expect(editor.selectedTab).toBe('text')
    })
})

describe('EventHandlersEditorCustomElement.flushPending', () => {
    it('flushes both the whole-file and per-row Monaco editors', () => {
        const { editor } = makeEditor([])
        const rawFlush = vi.fn()
        const rowFlush = vi.fn()
        editor.rawEditor = { flush: rawFlush }
        editor.rowRawEditor = { flush: rowFlush, switchModel: vi.fn() }

        editor.flushPending()

        expect(rawFlush).toHaveBeenCalled()
        expect(rowFlush).toHaveBeenCalled()
    })
})
