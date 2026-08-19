import { describe, it, expect, vi } from 'vitest'
import * as Blockly from 'blockly/core'
import { registerExrailBlocks, setWorkspaceDefined } from '../../src/renderer/src/components/visual-editors/exrail-blockly-blocks'
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
