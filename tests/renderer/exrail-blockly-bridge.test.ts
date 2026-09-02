import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as Blockly from 'blockly/core'

// exrail-blockly-blocks.ts (imported below) imports the real monaco-editor package (for
// ExrailCodeField's Monaco popup) — that package touches `window` at module scope, which
// crashes under vitest's node environment. Not exercised by these tests, but the import itself
// still runs at module load — same reason dccex-validators.test.ts mocks it.
vi.mock('monaco-editor', () => ({
    editor: { create: vi.fn() },
}))

import { parseBody, compileBody } from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'
import { BLOCK_REGISTRY } from '../../src/renderer/src/components/visual-editors/exrail-block-registry'
import { registerExrailBlocks, setWorkspaceDefined } from '../../src/renderer/src/components/visual-editors/exrail-blockly-blocks'
import { buildWorkspaceFromGraph, buildGraphFromWorkspace } from '../../src/renderer/src/components/visual-editors/exrail-blockly-bridge'
import type { DefinedObjects } from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'

registerExrailBlocks()

const DEFINED: DefinedObjects = {
    roster: [],
    turnouts: [
        { id: 200, description: 'A', comment: '', type: 'SERVO', pin: 1, activeAngle: 0, inactiveAngle: 0, profile: 'IMMEDIATE', defaultState: 'CLOSE' } as unknown as DefinedObjects['turnouts'][number],
        { id: 201, description: 'B', comment: '', type: 'SERVO', pin: 2, activeAngle: 0, inactiveAngle: 0, profile: 'IMMEDIATE', defaultState: 'CLOSE' } as unknown as DefinedObjects['turnouts'][number],
    ],
    sensors: [{ id: 1, pin: 1, description: '' }, { id: 2, pin: 2, description: '' }],
    routes: [{ id: 5, description: '', body: '' }],
    sequences: [],
    aliases: [{ name: 'mysidingpoint', value: '200', aliasType: 'Turnout' }],
    signals: [],
}

function roundTrip(body: string, kind: string = 'ROUTE'): string {
    const parsed = parseBody(body, kind, BLOCK_REGISTRY)
    if (!parsed.ok) throw new Error(`expected parse to succeed, got: ${parsed.reason}`)

    const workspace = new Blockly.Workspace()
    setWorkspaceDefined(workspace, DEFINED)
    try {
        buildWorkspaceFromGraph(workspace, parsed.graph, BLOCK_REGISTRY)
        const rebuiltGraph = buildGraphFromWorkspace(workspace, BLOCK_REGISTRY)
        return compileBody(rebuiltGraph, BLOCK_REGISTRY)
    } finally {
        workspace.dispose()
    }
}

describe('buildWorkspaceFromGraph / buildGraphFromWorkspace round-trip', () => {
    it('round-trips a flat stack sequence', () => {
        const body = 'THROW(200)\nCLOSE(201)\nDELAY(500)'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a single IF/ENDIF', () => {
        const body = 'IF(1)\n  THROW(200)\nENDIF'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips IF/ELSE/ENDIF', () => {
        const body = 'IF(1)\n  THROW(200)\nELSE\n  CLOSE(200)\nENDIF'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a nested IF inside IF', () => {
        const body = 'IF(1)\n  IF(2)\n    THROW(200)\n  ENDIF\nENDIF'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a nested IF inside IF/ELSE, both legs', () => {
        const body = 'IF(1)\n  IF(2)\n    THROW(200)\n  ELSE\n    CLOSE(200)\n  ENDIF\nELSE\n  DELAY(50)\nENDIF'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a stack followed by a FOLLOW terminal cap', () => {
        const body = 'THROW(200)\nFOLLOW(5)'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a DONE nested inside a branch', () => {
        const body = 'IF(1)\n  DONE\nENDIF'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a chain that continues after an ENDIF', () => {
        const body = 'IF(1)\n  THROW(200)\nENDIF\nCLOSE(201)'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a trailing comment on a statement', () => {
        const body = 'THROW(200) // note'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a leading standalone comment attached to the next statement', () => {
        const body = '// setting up\nTHROW(200)'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a multi-line comment (leading lines plus a trailing line)', () => {
        const body = '// line one\n// line two\nTHROW(200) // line three'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a comment on a statement nested inside IF/ENDIF', () => {
        const body = 'IF(1)\n  THROW(200) // note\nENDIF'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips an empty body', () => {
        expect(roundTrip('')).toBe('')
    })

    it('round-trips an alias identifier ref param value', () => {
        const body = 'THROW(mysidingpoint)\nCLOSE(201)'
        expect(roundTrip(body)).toBe(body)
    })

    it('round-trips a sequence body (SEQUENCE hat, not ROUTE)', () => {
        const body = 'THROW(200)\nDELAY(250)'
        expect(roundTrip(body, 'SEQUENCE')).toBe(body)
    })
})
