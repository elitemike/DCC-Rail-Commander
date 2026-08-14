/**
 * Text <-> graph conversion for the EXRAIL block canvas editor.
 *
 * Pure logic only — no DOM/EJ2 dependency — so it can be unit tested directly
 * and reused by exrail-block-canvas.ts without pulling any UI framework in.
 *
 * The registry (exrail-block-registry.ts) is passed in as a parameter rather
 * than imported, so this module has no dependency on it (registry.ts imports
 * types from here instead — see exrail-block-registry.ts).
 */

import type { ExrailCompletionData } from '../../utils/exrail-completions'
import type { SignalEntry } from '../../utils/myAutomationParser'

// ── Block type registry shapes ────────────────────────────────────────────

export type BlockShape = 'hat' | 'stack' | 'branch' | 'cap'

export type BlockParamKind =
    | 'turnoutRef'
    | 'sensorRef'
    | 'signalRef'
    | 'rosterRef'
    | 'routeOrSequenceRef'
    | 'number'
    | 'string'

export interface BlockParamDef {
    name: string
    kind: BlockParamKind
    label: string
    optional?: boolean
}

/** Object collections the registry's `isAvailable()` filters palette blocks against. */
export interface DefinedObjects extends ExrailCompletionData {
    signals: SignalEntry[]
}

export interface BlockTypeDef {
    id: string // 'THROW', 'IF', 'DONE', ... — must be the exact-case EXRAIL command name
    shape: BlockShape
    label: string
    color: string
    params: BlockParamDef[]
    isAvailable(defined: DefinedObjects): boolean
    /**
     * EXRAIL text for this node's own header line, given resolved param values.
     * Branch nodes: header line only (`IF(200)`) — compileBody owns ELSE/ENDIF.
     */
    emit(paramValues: Record<string, string | number>): string
}

// ── Canvas graph shapes ───────────────────────────────────────────────────

export interface CanvasNodeInfo {
    blockTypeId: string
    paramValues: Record<string, string | number>
    /** Branch nodes only — id of the first node in the "then" chain. */
    thenChildFirstId?: string
    /** Branch nodes only — id of the first node in the optional "else" chain. */
    elseChildFirstId?: string
    /**
     * Canvas-only, never produced by parseBody/consumed by compileBody: marks the synthetic
     * trailing DONE node exrail-block-canvas.ts draws to represent the file's own
     * auto-appended terminating DONE (see serializeRoutesToFile/serializeSequencesToFile).
     * Always excluded from the graph compileBody walks, so it can never duplicate that DONE.
     */
    isTerminalMarker?: boolean
}

export interface GraphConnector {
    id: string
    sourceID: string
    targetID: string
}

export interface ParsedGraph {
    nodes: Array<{ id: string; info: CanvasNodeInfo }>
    connectors: GraphConnector[]
    hatNodeId: string
}

export type ParseResult =
    | { ok: true; graph: ParsedGraph }
    | { ok: false; reason: string }

// ── parseBody: EXRAIL text -> graph ───────────────────────────────────────

interface StmtNode {
    blockTypeId: string
    paramValues: Record<string, string | number>
    then?: StmtNode[]
    else?: StmtNode[]
}

const LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([\s\S]*)\))?\s*$/

/** Splits macro-call argument text on top-level commas, respecting quoted strings and nested parens. */
function splitArgs(argsRaw: string): string[] {
    const trimmed = argsRaw.trim()
    if (trimmed === '') return []

    const parts: string[] = []
    let depth = 0
    let inStr = false
    let esc = false
    let start = 0

    for (let i = 0; i < argsRaw.length; i++) {
        const ch = argsRaw[i]
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if (ch === '"') { inStr = !inStr; continue }
        if (!inStr) {
            if (ch === '(') depth++
            else if (ch === ')') depth--
            else if (ch === ',' && depth === 0) {
                parts.push(argsRaw.slice(start, i).trim())
                start = i + 1
            }
        }
    }
    parts.push(argsRaw.slice(start).trim())
    return parts
}

function stripQuotes(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1)
    }
    return value
}

/** Every param kind that refers to another object by numeric ID *or* an ALIAS(name) identifier. */
const REF_KINDS = new Set<BlockParamKind>(['turnoutRef', 'sensorRef', 'signalRef', 'rosterRef', 'routeOrSequenceRef'])

function isPlainInt(s: string): boolean {
    return /^-?\d+$/.test(s)
}

/**
 * Parses a route/sequence `body` string (the raw text between `ROUTE(...)`/`SEQUENCE(...)`
 * and the file's terminating `DONE`, as produced by `parseRoutesFromFile`/`parseSequencesFromFile`
 * in myAutomationParser.ts) into a block graph.
 *
 * Never partially compiles: any unrecognized line, casing mismatch, unbalanced IF/ENDIF, or
 * comment returns `{ ok: false, reason }` instead of a best-effort graph, so a hand-edited body
 * that doesn't fit the block model is never silently corrupted.
 */
export function parseBody(bodyText: string, kind: 'route' | 'sequence', registry: BlockTypeDef[]): ParseResult {
    const registryById = new Map(registry.map((b) => [b.id, b]))
    const lines = bodyText.split('\n')

    const root: StmtNode[] = []
    const frameStack: Array<{ node: StmtNode; target: 'then' | 'else' }> = []

    const currentList = (): StmtNode[] => {
        if (frameStack.length === 0) return root
        const top = frameStack[frameStack.length - 1]
        return top.target === 'then' ? top.node.then! : top.node.else!
    }

    for (const raw of lines) {
        const line = raw.trim()
        if (line === '') continue

        const withoutStrings = line.replace(/"[^"]*"/g, '')
        if (withoutStrings.includes('//')) {
            return { ok: false, reason: 'Comments inside a route/sequence body are not supported in Blocks mode yet — edit as Text.' }
        }

        const m = line.match(LINE_RE)
        if (!m) return { ok: false, reason: `Couldn't parse line: "${line}".` }
        const [, rawCommand, argsRaw] = m

        if (rawCommand === 'ELSE') {
            if (frameStack.length === 0 || frameStack[frameStack.length - 1].target !== 'then') {
                return { ok: false, reason: 'Found ELSE without a matching IF.' }
            }
            const top = frameStack[frameStack.length - 1]
            top.node.else = []
            top.target = 'else'
            continue
        }

        if (rawCommand === 'ENDIF') {
            if (frameStack.length === 0) return { ok: false, reason: 'Found ENDIF without a matching IF.' }
            frameStack.pop()
            continue
        }

        if (rawCommand !== rawCommand.toUpperCase()) {
            return { ok: false, reason: `EXRAIL commands are case-sensitive — found "${rawCommand}", expected "${rawCommand.toUpperCase()}".` }
        }

        const def = registryById.get(rawCommand)
        if (!def) return { ok: false, reason: `"${rawCommand}" isn't supported in Blocks mode yet — edit as Text.` }
        if (def.shape === 'hat') return { ok: false, reason: `Unexpected "${rawCommand}" inside a body.` }

        const argValues = argsRaw !== undefined ? splitArgs(argsRaw) : []
        if (argValues.length !== def.params.length) {
            return { ok: false, reason: `"${rawCommand}" expects ${def.params.length} argument(s) but found ${argValues.length}.` }
        }

        const paramValues: Record<string, string | number> = {}
        def.params.forEach((p, i) => {
            const value = argValues[i]
            if (p.kind === 'string') {
                paramValues[p.name] = stripQuotes(value)
            } else if (REF_KINDS.has(p.kind)) {
                // A ref arg is either a raw numeric ID or an ALIAS(name) identifier —
                // e.g. THROW(mysidingpoint). Number()-coercing the latter produced NaN.
                paramValues[p.name] = isPlainInt(value) ? Number(value) : value
            } else {
                paramValues[p.name] = Number(value)
            }
        })

        const stmt: StmtNode = { blockTypeId: rawCommand, paramValues }
        currentList().push(stmt)

        if (def.shape === 'branch') {
            stmt.then = []
            frameStack.push({ node: stmt, target: 'then' })
        }
    }

    if (frameStack.length > 0) return { ok: false, reason: 'Missing ENDIF for an open IF block.' }

    let counter = 0
    const nextNodeId = () => `n${++counter}`
    const nodes: ParsedGraph['nodes'] = []
    const connectors: GraphConnector[] = []

    function emitChain(list: StmtNode[]): string | undefined {
        let firstId: string | undefined
        let prevId: string | undefined
        for (const stmt of list) {
            const id = nextNodeId()
            const info: CanvasNodeInfo = { blockTypeId: stmt.blockTypeId, paramValues: stmt.paramValues }
            nodes.push({ id, info })
            if (firstId === undefined) firstId = id
            if (prevId !== undefined) connectors.push({ id: `c_${prevId}_${id}`, sourceID: prevId, targetID: id })
            if (stmt.then) info.thenChildFirstId = emitChain(stmt.then)
            if (stmt.else) info.elseChildFirstId = emitChain(stmt.else)
            prevId = id
        }
        return firstId
    }

    const hatNodeId = 'hat'
    nodes.push({
        id: hatNodeId,
        info: { blockTypeId: kind === 'route' ? 'ROUTE' : 'SEQUENCE', paramValues: {} },
    })
    const firstBodyId = emitChain(root)
    if (firstBodyId !== undefined) {
        connectors.push({ id: `c_${hatNodeId}_${firstBodyId}`, sourceID: hatNodeId, targetID: firstBodyId })
    }

    return { ok: true, graph: { nodes, connectors, hatNodeId } }
}

// ── compileBody: graph -> EXRAIL text ─────────────────────────────────────

/** Id of the node reached by following `nodeId`'s single forward (stack/hat) connector, if any. */
function nextIdOf(nodeId: string, connectors: GraphConnector[]): string | undefined {
    return connectors.find((c) => c.sourceID === nodeId)?.targetID
}

/**
 * Compiles a block graph back into EXRAIL text (the `body` string for a
 * RouteEntry/SequenceEntry — the caller supplies the `ROUTE(...)`/`SEQUENCE(...)`
 * header and the file's terminating `DONE` separately).
 *
 * A `DONE` cap block must only ever appear nested inside a branch (depth >= 1):
 * at depth 0 it would collide with the always-appended terminating `DONE` that
 * serializeRoutesToFile/serializeSequencesToFile add after this text, corrupting
 * the next parse. Canvas-level validation (exrail-block-canvas.ts) is responsible
 * for never letting the user connect a DONE block at the top level — this
 * function trusts its input and does not re-check it.
 */
export function compileBody(graph: ParsedGraph, registry: BlockTypeDef[]): string {
    const registryById = new Map(registry.map((b) => [b.id, b]))
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n.info]))
    const lines: string[] = []

    function walk(id: string | undefined, depth: number): void {
        if (id === undefined) return
        const info = nodeById.get(id)
        if (!info) return
        const def = registryById.get(info.blockTypeId)
        if (!def) return

        const pad = '  '.repeat(depth)

        if (def.shape === 'branch') {
            lines.push(pad + def.emit(info.paramValues))
            walk(info.thenChildFirstId, depth + 1)
            if (info.elseChildFirstId !== undefined) {
                lines.push(pad + 'ELSE')
                walk(info.elseChildFirstId, depth + 1)
            }
            lines.push(pad + 'ENDIF')
            walk(nextIdOf(id, graph.connectors), depth)
            return
        }

        lines.push(pad + def.emit(info.paramValues))
        if (def.shape !== 'cap') {
            walk(nextIdOf(id, graph.connectors), depth)
        }
    }

    walk(nextIdOf(graph.hatNodeId, graph.connectors), 0)
    return lines.join('\n')
}
