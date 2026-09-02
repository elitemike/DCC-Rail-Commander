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
    | 'trackRef'
    | 'number'
    | 'string'
    /** Same runtime shape as 'string' (parsed/emitted identically — see parseArgsForParams'
     *  variadic tail, which never branches on kind) — exists purely so fieldJsonFor() can give
     *  this one param type (STEALTH/STEALTH_GLOBAL's raw C++ body) a full Monaco popup editor
     *  instead of Blockly's inline single-line text field. See ExrailCodeField. */
    | 'code'

export interface BlockParamDef {
    name: string
    kind: BlockParamKind
    label: string
    /** Marks this param, and every param after it, as omittable from the tail of the argument
     *  list (e.g. `AFTER(vpin, timer...)` — DCC-EX's own docs give `timer` a default of 500 when
     *  left out). Only meaningful on trailing params — see parseArgsForParams. */
    optional?: boolean
    /** Value substituted when `optional` is true and the caller omitted this argument entirely. */
    default?: string | number
    /**
     * Marks the LAST param in a block's `params` as a free-text catch-all for a variadic EXRAIL
     * signature (e.g. `SET(vpin, count...)`, `IF_ALL(vpinList...)`) — `BlockParamDef` has no
     * concept of a repeating socket, so the whole comma-separated tail is captured verbatim as one
     * string field instead (see parseBody's arity check and value-assignment loop below, and
     * emit()'s own handling in each such registry entry). Only meaningful on the final param.
     */
    variadic?: boolean
}

/** Object collections the registry's `isAvailable()` filters palette blocks against. */
export interface DefinedObjects extends ExrailCompletionData {
    signals: SignalEntry[]
    /**
     * Track ids (e.g. 'A', 'B') currently available on the board — always A/B, plus C/D only
     * when a stacked motor shield is configured (see ConfigEditorState.hasStackedMotorShield).
     * Optional, like the other ObjectIdCollections fields, since a caller with no track concept
     * (e.g. a non-CommandStation product) simply omits it.
     */
    tracks?: RefOption[]
}

export interface BlockTypeDef {
    id: string // 'THROW', 'IF', 'DONE', ... — must be the exact-case EXRAIL command name
    shape: BlockShape
    label: string
    /**
     * Longer hover tooltip text (Blockly's block-level `tooltip` JSON field, distinct from the
     * short `label` shown on the block face) — the DCC-EX command-reference's one-line
     * description for this command. Falls back to `label` when omitted (see jsonFor()).
     */
    description?: string
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
    /**
     * Only meaningful when `shape === 'hat'`. `true` marks a param-flavored hat — a task entry
     * point with real typed params on its own block face (e.g. ONSENSOR) and no id/alias/
     * description concept at all. Omitted/false is the id/alias-flavored shape (ROUTE/SEQUENCE):
     * `params` is `[]`, and the block instead gets the editable ID/ALIAS fields wired through
     * `ExrailBlockCanvasCustomElement`'s headerId/headerAlias/headerDescription bindables.
     *
     * This can't be inferred from `params.length > 0` alone — a zero-arg event handler (e.g.
     * ONRAILSYNCON) is still param-flavored (no id/alias), just with an empty params array, so it
     * would otherwise be indistinguishable from ROUTE/SEQUENCE. See jsonFor() (exrail-blockly-
     * blocks.ts), buildGraphFromWorkspace() (exrail-blockly-bridge.ts), and
     * ExrailBlockCanvasCustomElement's `_isParamFlavoredHat()`, which all key off this flag.
     */
    paramFlavoredHat?: boolean
    isAvailable(defined: DefinedObjects): boolean
    /**
     * EXRAIL text for this node's own header line, given resolved param values.
     * Branch nodes: header line only (`IF(200)`) — compileBody owns ELSE/ENDIF.
     */
    emit(paramValues: Record<string, string | number>): string
    /** DCC-EX command-reference URL shown via Blockly's right-click "Help" menu item, if set. */
    helpUrl?: string
    /**
     * Only set on a synthetic "Also on ..." trigger-marker block (see exrail-block-registry.ts's
     * `alsoTriggerVariant()`) — the id of the param-flavored hat this marker adds another trigger
     * for (its `emit()` is literally the hat's own `emit()`, reused verbatim). EXRAIL compiles
     * several `ON*()` header lines stacked back to back with nothing between them as one shared
     * body — each empty one just falls through to the next label in the compiled bytecode — so a
     * run of these markers dropped directly under a hat (or under each other) reproduces that
     * idiom visually: hat header, then each marker's own header line, then the real body.
     * `shape: 'stack'` (not 'hat') — see `triggerMarkerFor`'s own connection-check handling in
     * exrail-blockly-blocks.ts's jsonFor(), which is what actually restricts these to only ever
     * sitting in that leading run, never mid-body or inside a branch.
     */
    triggerMarkerFor?: string
}

// ── Ref-kind param options ────────────────────────────────────────────────

export interface RefOption {
    value: string | number
    label: string
}

/**
 * The track ids actually available on the current board — A/B always exist; C/D only when a
 * stacked motor shield is configured (ConfigEditorState.hasStackedMotorShield). Shared by
 * routes-editor.ts/sequences-editor.ts's `defined` getters so trackRef params (AFTEROVERLOAD)
 * only ever offer a track the board can really have.
 */
export function definedTracksFor(hasStackedMotorShield: boolean): RefOption[] {
    const tracks: RefOption[] = [
        { value: 'A', label: 'Track A' },
        { value: 'B', label: 'Track B' },
    ]
    if (hasStackedMotorShield) tracks.push({ value: 'C', label: 'Track C' }, { value: 'D', label: 'Track D' })
    return tracks
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
            options = defined.signals.map((s) => {
                const id = s.type === 'DCC' ? s.id : s.red
                return { value: id, label: s.description ? `${s.description} (${id})` : `Signal ${id}` }
            })
            break
        case 'trackRef':
            options = defined.tracks ?? []
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
    /** A trailing `// ...` comment on this statement's line, or a standalone comment line
     *  immediately preceding it with nothing else in between — see parseBody's comment
     *  handling. Re-emitted by compileBody so it survives a parse/edit/recompile round trip. */
    comment?: string
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
    comment?: string
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

/**
 * Net paren-depth change contributed by one physical line — `(` count minus `)` count — ignoring
 * anything inside a double-quoted string or after an (unquoted) `//` marker, since neither
 * contributes real structure (mirrors how the C++ compiler itself would see it). Used by
 * parseBody() below to recognize when a statement's argument (e.g. a STEALTH block embedding
 * multi-line C++) genuinely continues onto the next physical line, rather than assuming every
 * statement fits on exactly one line.
 */
function netParenDelta(line: string): number {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inStr) {
            if (esc) { esc = false; continue }
            if (ch === '\\') { esc = true; continue }
            if (ch === '"') inStr = false
            continue
        }
        if (ch === '"') { inStr = true; continue }
        if (ch === '/' && line[i + 1] === '/') break
        if (ch === '(') depth++
        else if (ch === ')') depth--
    }
    return depth
}

/** Splits `line` into its code portion and trailing `//` comment (if any), respecting quoted
 *  strings so `PRINT("a // b")` isn't mistaken for a comment start, and paren depth so a `//`
 *  nested inside a still-open argument list is left alone. That second guard matters for a
 *  multi-line statement (e.g. STEALTH embedding real C++): its own internal comments sit at
 *  depth > 0 relative to the statement's outer parens and must stay part of the captured code,
 *  not get mistaken for a top-level EXRAIL comment terminating the statement early. `comment` is
 *  `undefined` when there is none. */
function splitTrailingComment(line: string): { code: string; comment?: string } {
    let inStr = false
    let esc = false
    let depth = 0
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inStr) {
            if (esc) { esc = false; continue }
            if (ch === '\\') { esc = true; continue }
            if (ch === '"') inStr = false
            continue
        }
        if (ch === '"') { inStr = true; continue }
        if (ch === '(') { depth++; continue }
        if (ch === ')') { depth--; continue }
        if (depth === 0 && ch === '/' && line[i + 1] === '/') {
            return { code: line.slice(0, i).trim(), comment: line.slice(i + 2).trim() }
        }
    }
    return { code: line }
}

function stripQuotes(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1)
    }
    return value
}

/** Every param kind that refers to another object by numeric ID *or* an ALIAS(name) identifier. */
export const REF_KINDS = new Set<BlockParamKind>(['turnoutRef', 'sensorRef', 'signalRef', 'rosterRef', 'routeOrSequenceRef', 'trackRef'])

/** A ref arg is either a raw numeric ID or an ALIAS(name) identifier — e.g. THROW(mysidingpoint). Number()-coercing the latter produces NaN. */
export function isPlainInt(s: string): boolean {
    return /^-?\d+$/.test(s)
}

/**
 * Parses one command's parenthesized argument text against its registry param list — shared by
 * parseBody's per-line loop and parseEventHandlerBlock's header-line parsing below, since a
 * param-flavored hat's header (`ONSENSOR(200)`) is parsed exactly the same way a body statement's
 * line is. `commandName` is only used to word the arity-mismatch error.
 */
export function parseArgsForParams(
    commandName: string,
    argsRaw: string | undefined,
    params: BlockParamDef[],
): { ok: true; values: Record<string, string | number> } | { ok: false; reason: string } {
    const argValues = argsRaw !== undefined ? splitArgs(argsRaw) : []
    // A variadic last param (see BlockParamDef.variadic) absorbs every arg from its own
    // position onward as one joined string, so the fixed prefix just needs *at least*
    // enough args to fill every param before it — the usual exact-count check still applies
    // when there's no variadic param.
    const isVariadic = params.length > 0 && params[params.length - 1].variadic === true
    // Optional params (see BlockParamDef.optional) are only meaningful trailing — count how many
    // consecutive params at the end are marked optional to get the true minimum arg count (e.g.
    // AFTER(vpin, timer...) needs only `vpin`; DCC-EX defaults `timer` to 500 when omitted).
    let requiredCount = params.length
    if (!isVariadic) {
        while (requiredCount > 0 && params[requiredCount - 1].optional === true) requiredCount--
    }
    const minArgs = isVariadic ? params.length - 1 : requiredCount
    const maxArgs = isVariadic ? Infinity : params.length
    if (argValues.length < minArgs || argValues.length > maxArgs) {
        const expected = isVariadic
            ? `at least ${minArgs}`
            : (minArgs === maxArgs ? `${minArgs}` : `${minArgs}-${maxArgs}`)
        return { ok: false, reason: `"${commandName}" expects ${expected} argument(s) but found ${argValues.length}.` }
    }

    const values: Record<string, string | number> = {}
    params.forEach((p, i) => {
        if (isVariadic && i === params.length - 1) {
            // The variadic tail is stored verbatim (rejoined, not re-parsed) — it may itself
            // contain a mix of quoted strings and bare numbers/refs (e.g. IFLOCO("Thomas",
            // 6211)), which no single BlockParamKind coercion could handle correctly.
            values[p.name] = argValues.slice(i).join(', ')
            return
        }
        if (i >= argValues.length) {
            // Optional trailing param the caller omitted entirely.
            values[p.name] = p.default ?? (p.kind === 'string' ? '' : 0)
            return
        }
        const value = argValues[i]
        if (p.kind === 'string') {
            values[p.name] = stripQuotes(value)
        } else if (REF_KINDS.has(p.kind)) {
            // A ref arg is either a raw numeric ID or an ALIAS(name) identifier —
            // e.g. THROW(mysidingpoint). Number()-coercing the latter produced NaN.
            values[p.name] = isPlainInt(value) ? Number(value) : value
        } else {
            values[p.name] = Number(value)
        }
    })
    return { ok: true, values }
}

/**
 * Parses a route/sequence/event-handler `body` string (the raw text between the header line —
 * `ROUTE(...)`/`SEQUENCE(...)`/etc. — and the next block/EOF, as produced by
 * `parseRoutesFromFile`/`parseSequencesFromFile`/`parseEventHandlersFromFile` in
 * myAutomationParser.ts — including a trailing top-level `DONE` line when the file has one) into
 * a block graph. A top-level `DONE` parses like any other cap-shaped command: it becomes an
 * ordinary node at the end of the chain, same as one nested inside a branch.
 *
 * `kind` is the literal hat block-type id from the registry (`'ROUTE'`, `'SEQUENCE'`, or a
 * param-flavored hat like `'ONSENSOR'`) used to seed the synthetic root node when `bodyText` is
 * empty — see BLOCK_REGISTRY and exrail-block-canvas.ts's `kind` bindable, which is this
 * function's only caller for that value.
 *
 * Never partially compiles: any unrecognized line, casing mismatch, or unbalanced IF/ENDIF
 * returns `{ ok: false, reason }` instead of a best-effort graph, so a hand-edited body that
 * doesn't fit the block model is never silently corrupted. C-style block comments are stripped
 * outright before parsing (hand-written EXRAIL uses them almost exclusively to keep old,
 * disabled code around for reference — see the doc comment on the strip below); a trailing `//`
 * comment on a statement's own line, or a standalone `//` line immediately before one, is instead
 * preserved as that statement's `comment` (see CanvasNodeInfo.comment) and re-emitted by
 * compileBody, so it survives a parse/edit/recompile round trip rather than being rejected.
 */
export function parseBody(bodyText: string, kind: string, registry: BlockTypeDef[]): ParseResult {
    const registryById = new Map(registry.map((b) => [b.id, b]))
    // Block comments can span many lines and legally contain text that looks like statements
    // (commented-out code) — stripped wholesale before line-based parsing even starts, the same
    // way myAutomationParser.ts's own parsers pre-strip comments rather than handling them inline.
    // Non-greedy so multiple separate /* */ spans in one body don't collapse into one.
    const lines = bodyText.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')

    const root: StmtNode[] = []
    const frameStack: Array<{ node: StmtNode; target: 'then' | 'else' }> = []
    // A standalone comment line (nothing but `//...`) attaches to whichever real statement comes
    // next, on the common assumption that a comment describes the code below it — reset once
    // consumed. A comment with no following statement at all (trailing at the very end of a body)
    // has nowhere to attach and is dropped; every other case is preserved.
    let pendingComment: string | undefined

    const currentList = (): StmtNode[] => {
        if (frameStack.length === 0) return root
        const top = frameStack[frameStack.length - 1]
        return top.target === 'then' ? top.node.then! : top.node.else!
    }

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim()
        if (line === '') continue

        // A statement whose opening paren isn't yet balanced by a closing one on this same
        // physical line continues onto the next (e.g. STEALTH embedding a multi-line C++
        // function) — keep consuming lines, joined back with real newlines so the statement's
        // own internal formatting/comments survive, until the parens balance. EXRAIL itself
        // doesn't care about embedded line breaks inside a macro call's argument; only this
        // parser's own line-by-line scan needs to know where one statement actually ends.
        let depth = netParenDelta(line)
        while (depth > 0 && i + 1 < lines.length) {
            i++
            line += '\n' + lines[i]
            depth += netParenDelta(lines[i])
        }

        const { code, comment: trailingComment } = splitTrailingComment(line)
        if (code === '') {
            // A standalone comment line — nothing to attach it to yet, carry it forward.
            if (trailingComment !== undefined) {
                pendingComment = pendingComment !== undefined ? `${pendingComment}\n${trailingComment}` : trailingComment
            }
            continue
        }
        line = code

        const m = line.match(LINE_RE)
        if (!m) return { ok: false, reason: `Couldn't parse line: "${line}".` }
        const [, rawCommand, argsRaw] = m

        // ELSE/ENDIF create no node of their own — a comment riding on one of these lines has
        // nowhere to attach yet, so it carries forward to whatever real statement comes next
        // (pendingComment is left untouched; only trailingComment, this line's own, needs folding in).
        if (rawCommand === 'ELSE' || rawCommand === 'ENDIF') {
            if (trailingComment !== undefined) {
                pendingComment = pendingComment !== undefined ? `${pendingComment}\n${trailingComment}` : trailingComment
            }
        }

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

        // A trailing empty segment (`${pendingComment}\n`) marks "every line here is a leading
        // standalone comment, none of them rode on the statement's own line" — see commentLines()
        // in compileBody, the only reader of that convention. Without it, a single standalone
        // leading comment (pendingComment set, no trailingComment) is indistinguishable from a
        // same-line trailing one once both collapse to a single-line string, and compileBody would
        // wrongly re-emit it as `STATEMENT() // comment` instead of `// comment` above the statement.
        const comment = pendingComment !== undefined
            ? (trailingComment !== undefined ? `${pendingComment}\n${trailingComment}` : `${pendingComment}\n`)
            : trailingComment
        pendingComment = undefined

        if (rawCommand !== rawCommand.toUpperCase()) {
            return { ok: false, reason: `EXRAIL commands are case-sensitive — found "${rawCommand}", expected "${rawCommand.toUpperCase()}".` }
        }

        const def = registryById.get(rawCommand)
        if (!def) return { ok: false, reason: `"${rawCommand}" isn't supported in Blocks mode yet — edit as Text.` }
        if (def.shape === 'hat') return { ok: false, reason: `Unexpected "${rawCommand}" inside a body.` }

        const parsed = parseArgsForParams(rawCommand, argsRaw, def.params)
        if (!parsed.ok) return parsed

        const stmt: StmtNode = { blockTypeId: rawCommand, paramValues: parsed.values, comment }
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
            const info: CanvasNodeInfo = { blockTypeId: stmt.blockTypeId, paramValues: stmt.paramValues, comment: stmt.comment }
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
        info: { blockTypeId: kind, paramValues: {} },
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

    // A multi-line comment (accumulated from several standalone `//` lines before this
    // statement — see parseBody's pendingComment) can't be represented as one trailing `//`,
    // since EXRAIL's own comment syntax only runs to end of line: every line but the last is
    // re-emitted as its own standalone comment line immediately above the statement, and the
    // last rides trailing on the statement's own line, exactly reconstructing what parseBody saw.
    function commentLines(comment: string | undefined, pad: string): { leading: string[]; trailing?: string } {
        if (comment === undefined) return { leading: [] }
        const parts = comment.split('\n')
        // A trailing empty segment is parseBody's marker for "no same-line comment — every line
        // here is leading" (see the `comment` construction there); drop it and treat every
        // remaining part as a leading line, with no trailing comment on the statement's own line.
        if (parts[parts.length - 1] === '') {
            parts.pop()
            return { leading: parts.map((p) => `${pad}// ${p}`) }
        }
        const trailing = parts.pop()
        return { leading: parts.map((p) => `${pad}// ${p}`), trailing }
    }

    function walk(id: string | undefined, depth: number): void {
        if (id === undefined) return
        const info = nodeById.get(id)
        if (!info) return
        const def = registryById.get(info.blockTypeId)
        if (!def) return

        const pad = '  '.repeat(depth)
        const { leading, trailing } = commentLines(info.comment, pad)
        lines.push(...leading)

        if (def.shape === 'branch') {
            lines.push(pad + def.emit(info.paramValues) + (trailing ? ` // ${trailing}` : ''))
            walk(info.thenChildFirstId, depth + 1)
            if (info.elseChildFirstId !== undefined) {
                lines.push(pad + 'ELSE')
                walk(info.elseChildFirstId, depth + 1)
            }
            lines.push(pad + 'ENDIF')
            walk(nextIdOf(id, graph.connectors), depth)
            return
        }

        lines.push(pad + def.emit(info.paramValues) + (trailing ? ` // ${trailing}` : ''))
        if (def.shape !== 'cap') {
            walk(nextIdOf(id, graph.connectors), depth)
        }
    }

    walk(nextIdOf(graph.hatNodeId, graph.connectors), 0)
    return lines.join('\n')
}

/** Collapses whitespace runs outside double-quoted strings to a single space and trims the
 *  ends, leaving quoted content untouched — used by exrailBodiesEquivalent() below so a source
 *  string like `PARSE("<S 172 172 0>")` keeps its internal spaces while indentation and
 *  pre-comment padding (never preserved by compileBody()) don't count as a real difference. */
function collapseWhitespaceOutsideQuotes(s: string): string {
    let out = ''
    let inStr = false
    let esc = false
    let lastWasSpace = false
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]
        if (inStr) {
            out += ch
            if (esc) { esc = false; continue }
            if (ch === '\\') { esc = true; continue }
            if (ch === '"') inStr = false
            lastWasSpace = false
            continue
        }
        if (ch === '"') { inStr = true; out += ch; lastWasSpace = false; continue }
        if (/\s/.test(ch)) {
            if (!lastWasSpace) out += ' '
            lastWasSpace = true
            continue
        }
        out += ch
        lastWasSpace = false
    }
    return out.trim()
}

/**
 * True if `a` and `b` are the same EXRAIL modulo the formatting compileBody()/
 * compileEventHandlerBlock() always normalize regardless of source style — indentation depth,
 * and whitespace runs outside string literals (so `// comment` vs `   // comment` don't count).
 * Blank lines are ignored on both sides. Anything else — a dropped/reordered statement, a
 * changed argument, comment text that differs — counts as a real difference.
 *
 * Used as a load-time self-check (see exrail-block-canvas.ts's `_loadGraph()`) so opening
 * Blocks mode on an existing body never silently produces something that would rewrite the
 * file differently on save, before the user has touched anything: parse the body, immediately
 * recompile it, and compare against the original with this function rather than trusting a
 * successful parse alone.
 */
export function exrailBodiesEquivalent(a: string, b: string): boolean {
    const normalize = (text: string): string[] =>
        text
            .split('\n')
            .map((line) => {
                const { code, comment } = splitTrailingComment(line)
                const normCode = collapseWhitespaceOutsideQuotes(code)
                const normComment = comment !== undefined ? collapseWhitespaceOutsideQuotes(comment) : undefined
                return normComment !== undefined ? `${normCode}//${normComment}` : normCode
            })
            .filter((line) => line !== '')
    const na = normalize(a)
    const nb = normalize(b)
    if (na.length !== nb.length) return false
    return na.every((line, i) => line === nb[i])
}

// ── Event-handler blocks: header-line-plus-body <-> graph ────────────────

/**
 * Parses a full event-handler block — header line (`ONSENSOR(200)`) *and* body, unlike
 * `parseBody()` which only ever receives the post-header body text for ROUTE/SEQUENCE (their
 * id/description live in RouteEntry/SequenceEntry, not the block). A param-flavored hat
 * (`def.params.length > 0`) has no such separate structured home for its arguments — they're
 * edited directly on the hat block's own face, so this wrapper parses the header with the exact
 * same per-line logic (`parseArgsForParams`) a body statement uses, then hands the remainder to
 * the unchanged `parseBody()` and overwrites its (always-`{}`) hat paramValues with the parsed
 * header args. See exrail-block-canvas.ts's `_loadGraph()`, the only caller.
 */
export function parseEventHandlerBlock(fullText: string, registry: BlockTypeDef[]): ParseResult {
    const registryById = new Map(registry.map((b) => [b.id, b]))
    // Trigger-marker block types (see BlockTypeDef.triggerMarkerFor), keyed by the ON* command
    // their header line reuses (e.g. 'ONTHROW' -> the 'ONTHROW__ALSO' marker's own def).
    const markerDefByCommand = new Map(registry.filter((b) => b.triggerMarkerFor !== undefined).map((b) => [b.triggerMarkerFor!, b]))

    const newlineIdx = fullText.indexOf('\n')
    const headerLine = (newlineIdx === -1 ? fullText : fullText.slice(0, newlineIdx)).trim()
    const restText = newlineIdx === -1 ? '' : fullText.slice(newlineIdx + 1)

    const m = headerLine.match(LINE_RE)
    if (!m) return { ok: false, reason: `Couldn't parse header line: "${headerLine}".` }
    const [, command, argsRaw] = m

    const def = registryById.get(command)
    if (!def || def.shape !== 'hat' || !def.paramFlavoredHat) {
        return { ok: false, reason: `"${command}" isn't a recognized event-handler command.` }
    }

    const parsed = parseArgsForParams(command, argsRaw, def.params)
    if (!parsed.ok) return parsed

    // Peel off a leading run of stacked ON*() header lines (EXRAIL's own fallthrough idiom for
    // sharing one body across several triggers — see BlockTypeDef.triggerMarkerFor) into synthetic
    // marker nodes, before handing the true remainder to parseBody(). Stops at the first line that
    // isn't itself a recognized param-flavored hat's header — that's where the real body starts.
    const restLines = restText.split('\n')
    const markerNodes: ParsedGraph['nodes'] = []
    let bodyStart = 0
    while (bodyStart < restLines.length) {
        const trimmed = restLines[bodyStart].trim()
        if (trimmed === '') break
        const lm = trimmed.match(LINE_RE)
        if (!lm) break
        const [, markerCommand, markerArgsRaw] = lm
        const hatDefForMarker = registryById.get(markerCommand)
        if (!hatDefForMarker || hatDefForMarker.shape !== 'hat' || !hatDefForMarker.paramFlavoredHat) break
        const markerDef = markerDefByCommand.get(markerCommand)
        if (!markerDef) break
        const markerParsed = parseArgsForParams(markerCommand, markerArgsRaw, hatDefForMarker.params)
        if (!markerParsed.ok) break
        markerNodes.push({ id: `m${markerNodes.length + 1}`, info: { blockTypeId: markerDef.id, paramValues: markerParsed.values } })
        bodyStart++
    }
    const remainderText = restLines.slice(bodyStart).join('\n')

    const bodyResult = parseBody(remainderText, command, registry)
    if (!bodyResult.ok) return bodyResult

    const hatNode = bodyResult.graph.nodes.find((n) => n.id === bodyResult.graph.hatNodeId)
    if (hatNode) hatNode.info.paramValues = parsed.values

    if (markerNodes.length > 0) {
        const { graph } = bodyResult
        const oldFirstConnector = graph.connectors.find((c) => c.sourceID === graph.hatNodeId)
        graph.connectors = graph.connectors.filter((c) => c.sourceID !== graph.hatNodeId)
        graph.nodes.push(...markerNodes)
        let prevId = graph.hatNodeId
        for (const marker of markerNodes) {
            graph.connectors.push({ id: `c_${prevId}_${marker.id}`, sourceID: prevId, targetID: marker.id })
            prevId = marker.id
        }
        if (oldFirstConnector) {
            graph.connectors.push({ id: `c_${prevId}_${oldFirstConnector.targetID}`, sourceID: prevId, targetID: oldFirstConnector.targetID })
        }
    }

    return bodyResult
}

/**
 * Mirror of parseEventHandlerBlock() — compiles a param-flavored hat's graph back into the full
 * on-disk block (header line + body), unlike `compileBody()` which deliberately never emits the
 * hat node (ROUTE/SEQUENCE's header is composed separately by the host from RouteEntry/
 * SequenceEntry fields — see compileBody's own doc comment). Here the hat node's paramValues
 * *are* the entry's only source of truth for its header args, so `hatDef.emit()` — the exact same
 * contract every stack block already uses — produces the header line directly.
 */
export function compileEventHandlerBlock(graph: ParsedGraph, registry: BlockTypeDef[]): string {
    const registryById = new Map(registry.map((b) => [b.id, b]))
    const hatNode = graph.nodes.find((n) => n.id === graph.hatNodeId)
    const hatDef = hatNode ? registryById.get(hatNode.info.blockTypeId) : undefined
    const headerLine = hatDef ? hatDef.emit(hatNode!.info.paramValues) : ''
    const body = compileBody(graph, registry)
    return `${headerLine}\n${body}`
}
