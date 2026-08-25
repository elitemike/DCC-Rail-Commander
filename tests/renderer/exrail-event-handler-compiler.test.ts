import { describe, it, expect, vi } from 'vitest'
import * as Blockly from 'blockly/core'

// exrail-blockly-blocks.ts (imported below) imports the real monaco-editor package (for
// ExrailCodeField's Monaco popup) — that package touches `window` at module scope, which
// crashes under vitest's node environment. Not exercised by these tests, but the import itself
// still runs at module load — same reason dccex-validators.test.ts mocks it.
vi.mock('monaco-editor', () => ({
    editor: { create: vi.fn() },
}))

import {
    parseEventHandlerBlock,
    compileEventHandlerBlock,
} from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'
import type { DefinedObjects } from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'
import { BLOCK_REGISTRY } from '../../src/renderer/src/components/visual-editors/exrail-block-registry'
import { registerExrailBlocks, setWorkspaceDefined } from '../../src/renderer/src/components/visual-editors/exrail-blockly-blocks'
import { buildWorkspaceFromGraph, buildGraphFromWorkspace } from '../../src/renderer/src/components/visual-editors/exrail-blockly-bridge'

registerExrailBlocks()

const DEFINED: DefinedObjects = {
    roster: [],
    turnouts: [{ id: 201, description: 'Yard switch', comment: '', type: 'SERVO', pin: 1, activeAngle: 0, inactiveAngle: 0, profile: 'Slow', defaultState: 'CLOSED' }],
    sensors: [{ id: 200, pin: 2, description: 'Entry sensor' }],
    routes: [],
    sequences: [],
    aliases: [],
    signals: [],
}

describe('parseEventHandlerBlock / compileEventHandlerBlock', () => {
    it('parses a header line + body into a graph with the hat node carrying the header params', () => {
        const text = 'ONSENSOR(200)\nTHROW(201)\nDONE'
        const result = parseEventHandlerBlock(text, BLOCK_REGISTRY)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const hat = result.graph.nodes.find((n) => n.id === result.graph.hatNodeId)
        expect(hat?.info.blockTypeId).toBe('ONSENSOR')
        expect(hat?.info.paramValues).toEqual({ sensorId: 200 })
    })

    it('round-trips header + body text unchanged', () => {
        const text = 'ONSENSOR(200)\nTHROW(201)\nDONE'
        const result = parseEventHandlerBlock(text, BLOCK_REGISTRY)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(compileEventHandlerBlock(result.graph, BLOCK_REGISTRY)).toBe(text)
    })

    it('round-trips a zero-arg event handler (ONRAILSYNCON)', () => {
        const text = 'ONRAILSYNCON\nPOWERON'
        const result = parseEventHandlerBlock(text, BLOCK_REGISTRY)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(compileEventHandlerBlock(result.graph, BLOCK_REGISTRY)).toBe(text)
    })

    it('round-trips a two-arg event handler (ONACTIVATE)', () => {
        const text = 'ONACTIVATE(100, 4)\nDONE'
        const result = parseEventHandlerBlock(text, BLOCK_REGISTRY)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const hat = result.graph.nodes.find((n) => n.id === result.graph.hatNodeId)
        expect(hat?.info.paramValues).toEqual({ addr: 100, subaddr: 4 })
        expect(compileEventHandlerBlock(result.graph, BLOCK_REGISTRY)).toBe(text)
    })

    it('rejects a header line naming an id/alias-flavored hat (ROUTE has no params)', () => {
        const result = parseEventHandlerBlock('ROUTE(5, "desc")\nDONE', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
    })

    it('rejects a header line naming an ordinary stack command', () => {
        const result = parseEventHandlerBlock('THROW(201)\nDONE', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
    })

    it('rejects wrong arity on the header line', () => {
        const result = parseEventHandlerBlock('ONACTIVATE(100)\nDONE', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
    })
})

describe('event-handler hat through the Blockly bridge', () => {
    it('builds a workspace and reads the hat params back out unchanged', () => {
        const text = 'ONSENSOR(200)\nTHROW(201)\nDONE'
        const parsed = parseEventHandlerBlock(text, BLOCK_REGISTRY)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return

        const workspace = new Blockly.Workspace()
        setWorkspaceDefined(workspace, DEFINED)
        try {
            buildWorkspaceFromGraph(workspace, parsed.graph, BLOCK_REGISTRY)
            const rebuilt = buildGraphFromWorkspace(workspace, BLOCK_REGISTRY)
            expect(compileEventHandlerBlock(rebuilt, BLOCK_REGISTRY)).toBe(text)
        } finally {
            workspace.dispose()
        }
    })

    it('still builds a zero-param ROUTE hat with empty paramValues (no regression)', () => {
        const workspace = new Blockly.Workspace()
        setWorkspaceDefined(workspace, DEFINED)
        try {
            buildWorkspaceFromGraph(
                workspace,
                { nodes: [{ id: 'hat', info: { blockTypeId: 'ROUTE', paramValues: {} } }], connectors: [], hatNodeId: 'hat' },
                BLOCK_REGISTRY,
            )
            const rebuilt = buildGraphFromWorkspace(workspace, BLOCK_REGISTRY)
            const hat = rebuilt.nodes.find((n) => n.id === rebuilt.hatNodeId)
            expect(hat?.info.paramValues).toEqual({})
        } finally {
            workspace.dispose()
        }
    })
})
