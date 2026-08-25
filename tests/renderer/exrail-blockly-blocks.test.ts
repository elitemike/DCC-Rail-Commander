import { describe, it, expect, vi } from 'vitest'
import * as Blockly from 'blockly/core'

// exrail-blockly-blocks.ts imports the real monaco-editor package (for ExrailCodeField's Monaco
// popup) — that package touches `window` at module scope, which crashes under vitest's node
// environment. Not exercised by these tests (nothing here opens the field's editor), but the
// import itself still runs at module load, so it must be mocked regardless — same reason
// dccex-validators.test.ts mocks it.
vi.mock('monaco-editor', () => ({
    editor: { create: vi.fn() },
}))

import { registerExrailBlocks, setWorkspaceDefined, setWorkspaceSelfId } from '../../src/renderer/src/components/visual-editors/exrail-blockly-blocks'
import type { DefinedObjects } from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'

registerExrailBlocks()

const DEFINED: DefinedObjects = {
    roster: [],
    turnouts: [],
    sensors: [],
    routes: [{ id: 5, description: '', body: '' }],
    sequences: [{ id: 7, description: '', body: '' }],
    aliases: [{ name: 'existing_alias', value: '5', aliasType: 'Route' }],
    signals: [],
}

function makeHat(type: 'ROUTE' | 'SEQUENCE', defined: DefinedObjects = DEFINED) {
    const workspace = new Blockly.Workspace()
    setWorkspaceDefined(workspace, defined)
    const block = workspace.newBlock(type)
    block.initModel()
    return { workspace, block }
}

describe('ExrailIdField (hat block ID field)', () => {
    it('clamps below MIN_SEQUENCE_ID up to 1 (id 0 is reserved)', () => {
        const { block, workspace } = makeHat('ROUTE')
        block.setFieldValue('0', 'ID')
        expect(block.getFieldValue('ID')).toBe(1)
        workspace.dispose()
    })

    it('clamps above MAX_SEQUENCE_ID down to 32767', () => {
        const { block, workspace } = makeHat('ROUTE')
        block.setFieldValue('99999', 'ID')
        expect(block.getFieldValue('ID')).toBe(32767)
        workspace.dispose()
    })

    it('rounds to the nearest integer', () => {
        const { block, workspace } = makeHat('ROUTE')
        block.setFieldValue('3.7', 'ID')
        expect(block.getFieldValue('ID')).toBe(4)
        workspace.dispose()
    })

    it('sets a warning when the new id collides with another route', () => {
        const { block, workspace } = makeHat('ROUTE')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('5', 'ID')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('already used'), 'id')
        workspace.dispose()
    })

    it('sets a warning when the new id collides with a sequence (cross-type)', () => {
        const { block, workspace } = makeHat('ROUTE')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('7', 'ID')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('already used'), 'id')
        workspace.dispose()
    })

    it('clears the warning once the id no longer collides', () => {
        const { block, workspace } = makeHat('ROUTE')
        block.setFieldValue('5', 'ID')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('9', 'ID')
        expect(warn).toHaveBeenCalledWith(null, 'id')
        workspace.dispose()
    })

    // Regression: defined.routes/sequences is the project's live list, which includes this very
    // entry — a route/sequence sitting at its own already-registered id must not warn about
    // itself just because that id is "in the list" (see setWorkspaceSelfId's own doc comment).
    it('does not warn when the id matches this entry\'s own registered id', () => {
        const { block, workspace } = makeHat('ROUTE')
        setWorkspaceSelfId(workspace, 5)
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('5', 'ID')
        expect(warn).toHaveBeenCalledWith(null, 'id')
        workspace.dispose()
    })

    it('still warns when the id is changed to collide with a different existing entry', () => {
        const { block, workspace } = makeHat('ROUTE')
        setWorkspaceSelfId(workspace, 5)
        block.setFieldValue('5', 'ID')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('7', 'ID')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('already used'), 'id')
        workspace.dispose()
    })
})

describe('ExrailAliasField (hat block ALIAS field)', () => {
    it('treats a blank value as "no alias" — no warning', () => {
        const { block, workspace } = makeHat('SEQUENCE')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('', 'ALIAS')
        expect(warn).not.toHaveBeenCalledWith(expect.any(String), 'alias')
        workspace.dispose()
    })

    it('warns when the name fails validateAliasName (bad characters)', () => {
        const { block, workspace } = makeHat('SEQUENCE')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('1bad', 'ALIAS')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('must start with a letter'), 'alias')
        workspace.dispose()
    })

    it('warns when the name is already used for a different id', () => {
        const { block, workspace } = makeHat('SEQUENCE')
        block.setFieldValue('7', 'ID')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('existing_alias', 'ALIAS')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('already used for a different ID'), 'alias')
        workspace.dispose()
    })

    it('does not warn when the name already belongs to this block\'s own id', () => {
        const { block, workspace } = makeHat('ROUTE')
        block.setFieldValue('5', 'ID')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('existing_alias', 'ALIAS')
        expect(warn).toHaveBeenCalledWith(null, 'alias')
        workspace.dispose()
    })

    it('clears the warning for a valid, unused name', () => {
        const { block, workspace } = makeHat('SEQUENCE')
        const warn = vi.spyOn(block, 'setWarningText')
        block.setFieldValue('brand_new_name', 'ALIAS')
        expect(warn).toHaveBeenCalledWith(null, 'alias')
        workspace.dispose()
    })
})

describe('ExrailCodeField (STEALTH/STEALTH_GLOBAL code field)', () => {
    function makeCodeBlock(type: 'STEALTH' | 'STEALTH_GLOBAL' = 'STEALTH') {
        const workspace = new Blockly.Workspace()
        const block = workspace.newBlock(type)
        block.initModel()
        return { workspace, block }
    }

    it('shows a placeholder on the block face when no code has been entered yet', () => {
        const { block, workspace } = makeCodeBlock()
        expect(block.getField('code')!.getText()).toBe('(click to edit C++ code)')
        workspace.dispose()
    })

    it('collapses newlines and repeated whitespace into one line for the block-face preview', () => {
        const { block, workspace } = makeCodeBlock()
        block.setFieldValue('if (digitalRead(30)==LOW) {\n  doSomething();\n}', 'code')
        expect(block.getField('code')!.getText()).toBe('if (digitalRead(30)==LOW) { doSomething(); }')
        workspace.dispose()
    })

    it('preserves the raw multi-line value itself — only the block-face preview text is collapsed', () => {
        const { block, workspace } = makeCodeBlock()
        const code = 'line1();\nline2();'
        block.setFieldValue(code, 'code')
        expect(block.getFieldValue('code')).toBe(code)
        workspace.dispose()
    })

    it('is used by STEALTH_GLOBAL too, not just STEALTH', () => {
        const { block, workspace } = makeCodeBlock('STEALTH_GLOBAL')
        expect(block.getField('code')!.getText()).toBe('(click to edit C++ code)')
        workspace.dispose()
    })
})
