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
import type { AliasTargetType, SignalEntry } from '../../utils/myAutomationParser'
import { parseAliasNumericValue } from '../../utils/myAutomationParser'

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
    /**
     * Palette sidebar placement, e.g. 'Turnouts' or 'Locomotives/Driving' (slash-separated for a
     * nested subcategory) — see exrail-blockly-toolbox.ts's buildCategoryTree()/flatToolboxForPath(),
     * which build the custom category sidebar and its flyout contents from this field alone, so the
     * registry stays the one place a block's palette location is decided. Ignored for hat-shaped
     * blocks (never placed from the toolbox).
     */
    category: string
    params: BlockParamDef[]
    isAvailable(defined: DefinedObjects): boolean
    /**
     * EXRAIL text for this node's own header line, given resolved param values.
     * Branch nodes: header line only (`IF(200)`) — compileBody owns ELSE/ENDIF.
     */
    emit(paramValues: Record<string, string | number>): string
    /** DCC-EX command-reference URL shown via Blockly's right-click "Help" menu item, if set. */
    helpUrl?: string
}

// ── Ref-kind param options ────────────────────────────────────────────────

export interface RefOption {
    value: string | number
    label: string
}

/** Which AliasEntry.aliasType(s) an object reference kind is addressable by — signalRef has none (not a valid AliasTargetType). */
const ALIAS_TARGETS_FOR_KIND: Partial<Record<BlockParamKind, AliasTargetType[]>> = {
    turnoutRef: ['Turnout'],
    sensorRef: ['Sensor'],
    rosterRef: ['Roster'],
    routeOrSequenceRef: ['Route', 'Sequence'],
}

/**
 * Known-value options for a ref-kind param: one entry per configured object of the matching
 * kind, plus one per alias that targets it — a block must only ever emit a reference that
 * resolves to something real, never free text. An object that already has an alias is listed
 * ONLY by that alias, not also by id/description — EXRAIL scripts should read by name where a
 * name exists, and showing both would just be two entries for the same target with no way to
 * tell them apart at a glance.
 *
 * If `currentValue` doesn't match any of those (e.g. the object/alias was since deleted, or
 * it's a raw id that a later-added alias has since superseded), it's kept as a leading
 * "not found" option so a picker built on this never silently discards it.
 */
export function optionsForRefKind(
    kind: BlockParamKind,
    defined: DefinedObjects,
    currentValue: string | number | undefined,
): RefOption[] {
    let options: RefOption[]
    switch (kind) {
        case 'turnoutRef':
            options = defined.turnouts.map((t) => ({ value: t.id, label: t.description ? `${t.description} (${t.id})` : `Turnout ${t.id}` }))
            break
        case 'sensorRef':
            options = (defined.sensors ?? []).map((s) => ({ value: s.id, label: s.description ? `${s.description} (${s.id})` : `Sensor ${s.id}` }))
            break
        case 'rosterRef':
            options = defined.roster.map((r) => ({ value: r.dccAddress, label: r.name ? `${r.name} (${r.dccAddress})` : `Loco ${r.dccAddress}` }))
            break
        case 'routeOrSequenceRef':
            options = [
                ...(defined.routes ?? []).map((r) => ({ value: r.id, label: r.description ? `${r.description} (${r.id})` : `Route ${r.id}` })),
                ...(defined.sequences ?? []).map((s) => ({ value: s.id, label: s.description ? `${s.description} (${s.id})` : `Sequence ${s.id}` })),
            ]
            break
        case 'signalRef':
            options = defined.signals.map((s) => ({ value: s.red, label: s.description ? `${s.description} (${s.red})` : `Signal ${s.red}` }))
            break
        default:
            return []
    }

    const aliasTargets = ALIAS_TARGETS_FOR_KIND[kind]
    if (aliasTargets) {
        const relevantAliases = defined.aliases.filter((a) => !a.aliasType || aliasTargets.includes(a.aliasType))
        const aliasedIds = new Set(
            relevantAliases.map((a) => parseAliasNumericValue(a.value)).filter((id): id is number => id !== null),
        )
        options = options.filter((o) => typeof o.value !== 'number' || !aliasedIds.has(o.value))
        options = [
            ...options,
            ...relevantAliases.map((a) => {
                const targetId = parseAliasNumericValue(a.value)
                return { value: a.name, label: targetId !== null ? `${a.name} (${targetId})` : `${a.name} (alias)` }
            }),
        ]
    }

    if (currentValue !== '' && currentValue !== undefined && !options.some((o) => String(o.value) === String(currentValue))) {
        options = [{ value: currentValue, label: `${currentValue} (not found)` }, ...options]
    }

    return options
}

/**
 * Rewrites a ref-kind param value stored as a raw numeric ID to its alias name, if one now
 * covers that id — e.g. a THROW(201) written before `ALIAS(mysidingpoint, 201)` existed should
 * migrate to THROW(mysidingpoint), the same canonical form optionsForRefKind() would already
 * show for a freshly-picked value (see its own alias-preferred dedup). Returns `value` unchanged
 * if it isn't a plain numeric id, or no alias covers it. Called whenever `defined` changes (an
 * alias can be added after a body already referencing that object by id was loaded).
 */
export function canonicalRefValue(kind: BlockParamKind, defined: DefinedObjects, value: string | number): string | number {
    const aliasTargets = ALIAS_TARGETS_FOR_KIND[kind]
    if (!aliasTargets) return value
    const numericId = typeof value === 'number' ? value : (isPlainInt(value) ? Number(value) : null)
    if (numericId === null) return value
    const match = defined.aliases.find((a) => (!a.aliasType || aliasTargets.includes(a.aliasType)) && parseAliasNumericValue(a.value) === numericId)
    return match ? match.name : value
}

// ── Canvas graph shapes ───────────────────────────────────────────────────

export interface CanvasNodeInfo {
    blockTypeId: string
    paramValues: Record<string, string | number>
    /** Branch nodes only — id of the first node in the "then" chain. */
    thenChildFirstId?: string
    /** Branch nodes only — id of the first node in the optional "else" chain. */
    elseChildFirstId?: string
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
export const REF_KINDS = new Set<BlockParamKind>(['turnoutRef', 'sensorRef', 'signalRef', 'rosterRef', 'routeOrSequenceRef'])

/** A ref arg is either a raw numeric ID or an ALIAS(name) identifier — e.g. THROW(mysidingpoint). Number()-coercing the latter produces NaN. */
export function isPlainInt(s: string): boolean {
    return /^-?\d+$/.test(s)
}

/**
 * Parses a route/sequence `body` string (the raw text between `ROUTE(...)`/`SEQUENCE(...)` and
 * the next block/EOF, as produced by `parseRoutesFromFile`/`parseSequencesFromFile` in
 * myAutomationParser.ts — including a trailing top-level `DONE` line when the file has one) into
 * a block graph. A top-level `DONE` parses like any other cap-shaped command: it becomes an
 * ordinary node at the end of the chain, same as one nested inside a branch.
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
 * RouteEntry/SequenceEntry — the caller supplies the `ROUTE(...)`/`SEQUENCE(...)` header
 * separately). A top-level `DONE`/`FOLLOW` cap node, if present, is emitted like any other node
 * and becomes the last line of `body` — serializeRoutesToFile/serializeSequencesToFile only add
 * their own `DONE` when `body` has no content at all, so this never produces a duplicate.
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
