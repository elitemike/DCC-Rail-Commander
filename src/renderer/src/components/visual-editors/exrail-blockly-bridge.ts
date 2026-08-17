/**
 * Bridges Blockly's own workspace/block-tree model to the ParsedGraph model
 * that exrail-block-compiler.ts's parseBody()/compileBody() already own as
 * the single source of truth for EXRAIL text<->graph translation.
 *
 * Deliberately NOT using Blockly.serialization.workspaces.save/load: that
 * serializer has no concept of "this workspace doesn't represent valid
 * EXRAIL, refuse" the way parseBody() does (canUseBlocks() in the sequences/
 * routes editors depends on that all-or-nothing guarantee to fall back to
 * Text mode) — it would happily (de)serialize a workspace shape that
 * doesn't correspond to any valid EXRAIL body. compileBody() stays the only
 * text emitter; these functions only ever hand it a ParsedGraph built the
 * same way parseBody() would have built one.
 *
 * Pure logic apart from Blockly's Workspace/Block API — runs against a
 * headless `new Blockly.Workspace()` with no rendering, so it's unit
 * testable without a browser (see tests/renderer/exrail-blockly-bridge.test.ts).
 */
import * as Blockly from 'blockly/core'
import { isPlainInt, REF_KINDS } from './exrail-block-compiler'
import type { BlockTypeDef, CanvasNodeInfo, GraphConnector, ParsedGraph } from './exrail-block-compiler'

function fieldStringFor(value: string | number): string {
    return String(value)
}

function paramValueFromField(kind: BlockTypeDef['params'][number]['kind'], raw: string): string | number {
    if (REF_KINDS.has(kind)) return isPlainInt(raw) ? Number(raw) : raw
    if (kind === 'number') return Number(raw)
    return raw
}

function registryById(registry: BlockTypeDef[]): Map<string, BlockTypeDef> {
    return new Map(registry.map((b) => [b.id, b]))
}

/**
 * Constructs Blockly blocks from a ParsedGraph (as produced by parseBody())
 * and connects them into `workspace`, which must already have its block
 * types registered (see registerExrailBlocks()). Mirrors the old EJ2
 * canvas's _layout() in role, but needs no coordinate math — Blockly owns
 * positioning once blocks are connected.
 */
export function buildWorkspaceFromGraph(workspace: Blockly.Workspace, graph: ParsedGraph, registry: BlockTypeDef[]): void {
    const byId = registryById(registry)
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n.info]))

    function build(info: CanvasNodeInfo, id: string): Blockly.Block | null {
        const def = byId.get(info.blockTypeId)
        if (!def) return null
        const block = workspace.newBlock(def.id, id)
        for (const p of def.params) {
            const value = info.paramValues[p.name]
            if (value !== undefined) block.setFieldValue(fieldStringFor(value), p.name)
        }
        // A rendered (browser) workspace produces BlockSvg instances, which need
        // initSvg()+render() instead of the headless initModel() — both classes
        // exist under the Node build too (just unused), so instanceof works in
        // both the Vitest (headless Workspace) and Electron renderer (WorkspaceSvg)
        // cases without any environment-specific branching at the call site.
        if (block instanceof Blockly.BlockSvg) {
            block.initSvg()
            block.render()
        } else {
            block.initModel()
        }
        return block
    }

    function buildChain(startId: string | undefined): Blockly.Block | null {
        if (startId === undefined) return null
        let firstBlock: Blockly.Block | null = null
        let prevBlock: Blockly.Block | null = null
        let currentId: string | undefined = startId
        const nextIdOf = (id: string) => graph.connectors.find((c) => c.sourceID === id)?.targetID

        while (currentId !== undefined) {
            const info = nodeById.get(currentId)
            if (!info) break
            const block = build(info, currentId)
            if (!block) break
            if (firstBlock === null) firstBlock = block
            if (prevBlock !== null && prevBlock.nextConnection && block.previousConnection) {
                prevBlock.nextConnection.connect(block.previousConnection)
            }

            const def = byId.get(info.blockTypeId)
            if (def?.shape === 'branch') {
                const thenChild = buildChain(info.thenChildFirstId)
                if (thenChild?.previousConnection) {
                    block.getInput('THEN')?.connection?.connect(thenChild.previousConnection)
                }
                const elseChild = buildChain(info.elseChildFirstId)
                if (elseChild?.previousConnection) {
                    block.getInput('ELSE')?.connection?.connect(elseChild.previousConnection)
                }
            }

            prevBlock = block
            currentId = nextIdOf(currentId)
        }
        return firstBlock
    }

    const hatInfo = nodeById.get(graph.hatNodeId)
    if (!hatInfo) return
    const hat = build(hatInfo, graph.hatNodeId)
    if (!hat) return
    hat.setDeletable(false)
    hat.setMovable(false)

    const firstBodyId = graph.connectors.find((c) => c.sourceID === graph.hatNodeId)?.targetID
    const firstBody = buildChain(firstBodyId)
    if (firstBody?.previousConnection && hat.nextConnection) {
        hat.nextConnection.connect(firstBody.previousConnection)
    }

    if (workspace instanceof Blockly.WorkspaceSvg) workspace.render()
}

/**
 * Walks `workspace`'s blocks (starting from the fixed hat block) back into a
 * ParsedGraph, the mirror image of buildWorkspaceFromGraph(). Feeds straight
 * into the existing, unchanged compileBody(graph, registry).
 */
export function buildGraphFromWorkspace(workspace: Blockly.Workspace, registry: BlockTypeDef[]): ParsedGraph {
    const byId = registryById(registry)
    const nodes: ParsedGraph['nodes'] = []
    const connectors: GraphConnector[] = []
    let counter = 0
    const idFor = new Map<string, string>()
    const nextId = (blocklyId: string): string => {
        const existing = idFor.get(blocklyId)
        if (existing) return existing
        const id = blocklyId === hatBlocklyId ? 'hat' : `n${++counter}`
        idFor.set(blocklyId, id)
        return id
    }

    const hatBlock = workspace.getTopBlocks(true).find((b) => byId.get(b.type)?.shape === 'hat')
    if (!hatBlock) return { nodes: [], connectors: [], hatNodeId: 'hat' }
    const hatBlocklyId = hatBlock.id

    function readParamValues(block: Blockly.Block, def: BlockTypeDef): Record<string, string | number> {
        const values: Record<string, string | number> = {}
        for (const p of def.params) {
            const raw = block.getFieldValue(p.name)
            if (raw !== null && raw !== undefined) values[p.name] = paramValueFromField(p.kind, String(raw))
        }
        return values
    }

    function walkChain(block: Blockly.Block | null, sourceId: string | undefined, portKey: 'next' | 'then' | 'else'): void {
        let current = block
        let prevId = sourceId
        while (current !== null) {
            const def = byId.get(current.type)
            if (!def) break
            const id = nextId(current.id)
            const info: CanvasNodeInfo = { blockTypeId: def.id, paramValues: readParamValues(current, def) }
            nodes.push({ id, info })

            if (prevId !== undefined) {
                if (portKey === 'next') {
                    connectors.push({ id: `c_${prevId}_${id}`, sourceID: prevId, targetID: id })
                } else if (portKey === 'then') {
                    const parent = nodes.find((n) => n.id === prevId)?.info
                    if (parent) parent.thenChildFirstId = id
                } else {
                    const parent = nodes.find((n) => n.id === prevId)?.info
                    if (parent) parent.elseChildFirstId = id
                }
            }

            if (def.shape === 'branch') {
                const thenBlock = current.getInputTargetBlock('THEN')
                walkChain(thenBlock, id, 'then')
                const elseBlock = current.getInputTargetBlock('ELSE')
                walkChain(elseBlock, id, 'else')
            }

            current = current.getNextBlock()
            prevId = id
            portKey = 'next'
        }
    }

    const hatDef = byId.get(hatBlock.type)
    const hatId = nextId(hatBlock.id)
    nodes.push({ id: hatId, info: { blockTypeId: hatDef?.id ?? hatBlock.type, paramValues: {} } })
    walkChain(hatBlock.getNextBlock(), hatId, 'next')

    return { nodes, connectors, hatNodeId: hatId }
}
