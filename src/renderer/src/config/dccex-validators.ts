/**
 * dccex-validators.ts
 *
 * Monaco editor diagnostic validators for DCC-EX macro files.
 * Each validator parses the macro calls in a model and returns an array of
 * `monaco.editor.IMarkerData` describing any errors found.
 *
 * Registered once via `registerDiagnosticProviders()` (called from monaco-editor.ts).
 * Uses `monaco.editor.setModelMarkers()` to show red squiggles inline.
 */

import * as monaco from 'monaco-editor'
import { EXRAIL_REFERENCE_COMMANDS, getTargetTypes, isExrailCompletionFile, type ExrailCompletionData, type ExrailRefKind } from '../utils/exrail-completions'
import { definedTracksFor } from '../components/visual-editors/exrail-block-compiler'
import { collectObjectIdReferences, inferAliasTypes, parseAliasNumericValue, validateAliasName, validateAliasValue, validateSequenceIds, type AliasEntry, type AliasTargetType, type ObjectIdCollections, type SequenceIdEntry, type SequenceIdViolation, type SequenceObjectKind } from '../utils/myAutomationParser'
import { getSharedConfigEditorState } from '../utils/exrail-editor-state'
import { getCompletions } from './file-configs'

// ── Parsing helpers ───────────────────────────────────────────────────────────

/** Convert an absolute character offset in `text` to a 1-based { line, col }. */
function offsetToPos(text: string, offset: number): { line: number; col: number } {
    const before = text.slice(0, offset)
    const lines = before.split('\n')
    return { line: lines.length, col: lines[lines.length - 1].length + 1 }
}

/** Build a marker from absolute text offsets. */
function makeMarker(
    text: string,
    start: number,
    end: number,
    message: string,
    severity = monaco.MarkerSeverity.Error,
): monaco.editor.IMarkerData {
    const s = offsetToPos(text, start)
    const e = offsetToPos(text, end)
    return {
        severity,
        message,
        startLineNumber: s.line,
        startColumn: s.col,
        endLineNumber: e.line,
        endColumn: e.col,
    }
}

interface ArgSpan {
    /** Trimmed text value of the argument */
    value: string
    /** Absolute offset of the first non-whitespace character */
    start: number
    /** Absolute offset just past the last non-whitespace character */
    end: number
}

/**
 * Parse the content inside a macro's parentheses into argument spans.
 * Commas inside double-quoted strings are not treated as separators.
 *
 * `innerStart` — absolute offset in the full file text where `argsRaw[0]` sits.
 */
function parseArgSpans(argsRaw: string, innerStart: number): ArgSpan[] {
    const spans: ArgSpan[] = []
    let inStr = false
    let esc = false
    let segStart = 0

    const flush = (segEnd: number) => {
        const raw = argsRaw.slice(segStart, segEnd)
        const trimStart = raw.search(/\S/)
        const trimEnd = raw.search(/\s*$/)
        const valueStart = trimStart >= 0 ? trimStart : 0
        const valueEnd = trimEnd > 0 ? trimEnd : raw.length
        spans.push({
            value: raw.slice(valueStart, valueEnd),
            start: innerStart + segStart + valueStart,
            end: innerStart + segStart + Math.max(valueEnd, valueStart + 1),
        })
    }

    for (let i = 0; i <= argsRaw.length; i++) {
        const ch = argsRaw[i]
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if (ch === '"') { inStr = !inStr; continue }
        if ((ch === ',' && !inStr) || i === argsRaw.length) {
            flush(i)
            segStart = i + 1
        }
    }

    return spans
}

/**
 * Iterate over every occurrence of `MACRO_NAME(...)` in `text`.
 * Yields the full regex match, the content inside the parens, and the
 * absolute offset where the character after the opening paren sits.
 *
 * Properly handles parentheses inside quoted strings (e.g., "Thomas (copy)").
 */
function* eachMacroCall(
    text: string,
    macroName: string,
): Generator<{ fullMatch: RegExpExecArray; argsRaw: string; innerStart: number }> {
    // Find all positions where MACRO_NAME( appears
    const startRe = new RegExp(String.raw`\b${macroName}\s*\(`, 'g')
    let startMatch: RegExpExecArray | null

    while ((startMatch = startRe.exec(text)) !== null) {
        const parenStart = startMatch.index + startMatch[0].indexOf('(')
        const innerStart = parenStart + 1

        // Find matching closing paren, respecting quoted strings
        let depth = 1
        let inQuote = false
        let escaped = false
        let pos = innerStart

        while (pos < text.length && depth > 0) {
            const ch = text[pos]

            if (escaped) {
                escaped = false
                pos++
                continue
            }

            if (ch === '\\') {
                escaped = true
                pos++
                continue
            }

            if (ch === '"') {
                inQuote = !inQuote
                pos++
                continue
            }

            if (!inQuote) {
                if (ch === '(') depth++
                else if (ch === ')') depth--
            }

            pos++
        }

        if (depth === 0) {
            const argsRaw = text.slice(innerStart, pos - 1)
            const fullMatch = new RegExp(String.raw`\b${macroName}\s*\([^)]*\)`) as unknown as RegExpExecArray

            // Create a fake RegExpExecArray for compatibility
            const result = {
                0: text.slice(parenStart - macroName.length, pos),
                1: argsRaw,
                index: parenStart - macroName.length,
            } as unknown as RegExpExecArray

            yield {
                fullMatch: result,
                argsRaw,
                innerStart,
            }
        }
    }
}

function isQuotedString(s: string): boolean {
    return s.startsWith('"') && s.endsWith('"') && s.length >= 2
}

function isInt(s: string): boolean {
    return s !== '' && Number.isInteger(Number(s)) && !s.includes('.')
}

function isIdentifier(s: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
}

/** Collect every name introduced by `#define NAME ...` in the given text. */
function getDefineNames(text: string): Set<string> {
    const names = new Set<string>()
    const re = /^#define\s+([A-Za-z_][A-Za-z0-9_]*)/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) names.add(m[1])
    return names
}

// ── ROSTER validator ──────────────────────────────────────────────────────────

/**
 * ROSTER(dccAddress, "Name", "Fn0/Fn1/..." | DEFINE | DEFINE "/suffix")
 *   arg 1 — integer DCC address (1–9999)
 *   arg 2 — double-quoted loco name string
 *   arg 3 — double-quoted function list string OR a #define identifier OR identifier + "/suffix"
 */
function validateRoster(text: string, out: monaco.editor.IMarkerData[]): void {
    const defines = getDefineNames(text)

    for (const { fullMatch: m, argsRaw, innerStart } of eachMacroCall(text, 'ROSTER')) {
        const args = parseArgSpans(argsRaw, innerStart)

        if (args.length !== 3) {
            out.push(makeMarker(
                text, m.index, m.index + m[0].length,
                `ROSTER expects 3 arguments (dccAddress, "Name", "FnList") but got ${args.length}.`,
            ))
            continue
        }

        const [addr, name, fnList] = args

        if (!isInt(addr.value)) {
            out.push(makeMarker(text, addr.start, addr.end,
                `DCC address must be an integer, got: ${addr.value || '(empty)'}.`,
            ))
        } else {
            const n = Number(addr.value)
            if (n < 1 || n > 9999) {
                out.push(makeMarker(text, addr.start, addr.end,
                    `DCC address ${n} is out of range (1–9999).`,
                    monaco.MarkerSeverity.Warning,
                ))
            }
        }

        if (!isQuotedString(name.value)) {
            out.push(makeMarker(text, name.start, name.end,
                `Loco name must be a double-quoted string, e.g. "My Loco".`,
            ))
        }

        // Validate function list: can be quoted string, identifier only, or identifier + quoted suffix
        if (!isQuotedString(fnList.value)) {
            // Check if it's "IDENTIFIER SPACE QUOTED_STRING" (preprocessor concatenation for appended functions)
            // Matches: MACRO_NAME "/functionList"
            const macroWithSuffixMatch = fnList.value.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]*)"\s*$/)
            if (macroWithSuffixMatch) {
                const [, macroName, suffixContent] = macroWithSuffixMatch
                // Verify macro is defined
                if (!defines.has(macroName)) {
                    out.push(makeMarker(text, fnList.start, fnList.end,
                        `'${macroName}' is not defined in this file. Add '#define ${macroName} "Fn0/Fn1/..."' above the ROSTER entry.`,
                        monaco.MarkerSeverity.Warning,
                    ))
                }
                // Suffix content is already extracted (without quotes)
                // It should contain function names separated by slashes, possibly with a leading slash
                // Example: "/BRAKE" or "BRAKE" or "/F1/F2"
                // Leading slash is allowed as it matches the preprocessor concatenation format
            } else if (isIdentifier(fnList.value)) {
                // Plain identifier — must be defined
                if (!defines.has(fnList.value)) {
                    out.push(makeMarker(text, fnList.start, fnList.end,
                        `'${fnList.value}' is not defined in this file. Add '#define ${fnList.value} "Fn0/Fn1/..."' above the ROSTER entry.`,
                        monaco.MarkerSeverity.Warning,
                    ))
                }
            } else {
                // Neither quoted string, nor identifier, nor macro+suffix format
                out.push(makeMarker(text, fnList.start, fnList.end,
                    `Function list must be a quoted string (e.g. "LIGHT/*HORN"), a #define identifier, or a macro with appended functions (e.g. MACRO "/EXTRA").`,
                ))
            }
        }
    }
}

// ── SERVO_TURNOUT validator ───────────────────────────────────────────────────

const SERVO_PROFILES = new Set(['Instant', 'Fast', 'Medium', 'Slow', 'Bounce'])

/**
 * SERVO_TURNOUT(id, pin, activeAngle, inactiveAngle, profile, "description")
 *   arg 1 — integer ID
 *   arg 2 — integer VPin
 *   arg 3 — integer active angle (0–512)
 *   arg 4 — integer inactive angle (0–512)
 *   arg 5 — profile keyword (Instant|Fast|Medium|Slow|Bounce)
 *   arg 6 — double-quoted description string
 */
function validateServoTurnout(text: string, out: monaco.editor.IMarkerData[]): void {
    for (const { fullMatch: m, argsRaw, innerStart } of eachMacroCall(text, 'SERVO_TURNOUT')) {
        const args = parseArgSpans(argsRaw, innerStart)

        if (args.length !== 6) {
            out.push(makeMarker(
                text, m.index, m.index + m[0].length,
                `SERVO_TURNOUT expects 6 arguments (id, pin, activeAngle, inactiveAngle, profile, "desc") but got ${args.length}.`,
            ))
            continue
        }

        const intChecks: Array<{ idx: number; label: string; min: number; max: number }> = [
            { idx: 0, label: 'ID', min: 0, max: 32767 },
            { idx: 1, label: 'VPin', min: 0, max: 65535 },
            { idx: 2, label: 'active angle', min: 0, max: 512 },
            { idx: 3, label: 'inactive angle', min: 0, max: 512 },
        ]

        for (const { idx, label, min, max } of intChecks) {
            const a = args[idx]
            if (!isInt(a.value)) {
                out.push(makeMarker(text, a.start, a.end,
                    `${label} must be an integer, got: ${a.value || '(empty)'}.`,
                ))
            } else {
                const n = Number(a.value)
                if (n < min || n > max) {
                    out.push(makeMarker(text, a.start, a.end,
                        `${label} value ${n} is out of range (${min}–${max}).`,
                        monaco.MarkerSeverity.Warning,
                    ))
                }
            }
        }

        const profile = args[4]
        if (!SERVO_PROFILES.has(profile.value)) {
            out.push(makeMarker(text, profile.start, profile.end,
                `Profile must be one of: ${[...SERVO_PROFILES].join(', ')}. Got: "${profile.value}".`,
            ))
        }

        const desc = args[5]
        if (!isQuotedString(desc.value)) {
            out.push(makeMarker(text, desc.start, desc.end,
                `Description must be a double-quoted string, e.g. "Platform 1".`,
            ))
        }
    }
}

// ── TURNOUT validator ─────────────────────────────────────────────────────────

/**
 * TURNOUT(id, addr, subAddr, "description")
 *   arg 1 — integer ID
 *   arg 2 — integer DCC accessory address (0–511)
 *   arg 3 — integer sub-address (0–3)
 *   arg 4 — double-quoted description string
 *
 * Note: SERVO_TURNOUT and PIN_TURNOUT are handled separately.
 * The regex uses \bTURNOUT to avoid matching the suffix of longer names,
 * but we also skip matches that are preceded by a word character.
 */
function validateTurnout(text: string, out: monaco.editor.IMarkerData[]): void {
    for (const { fullMatch: m, argsRaw, innerStart } of eachMacroCall(text, 'TURNOUT')) {
        // Skip if preceded by a word character (i.e. part of SERVO_TURNOUT / PIN_TURNOUT)
        if (m.index > 0 && /\w/.test(text[m.index - 1])) continue

        const args = parseArgSpans(argsRaw, innerStart)
        if (args.length !== 4) {
            out.push(makeMarker(
                text, m.index, m.index + m[0].length,
                `TURNOUT expects 4 arguments (id, addr, subAddr, "desc") but got ${args.length}.`,
            ))
            continue
        }

        const intChecks: Array<{ idx: number; label: string; min: number; max: number }> = [
            { idx: 0, label: 'ID', min: 0, max: 32767 },
            { idx: 1, label: 'DCC address', min: 0, max: 511 },
            { idx: 2, label: 'sub-address', min: 0, max: 3 },
        ]
        for (const { idx, label, min, max } of intChecks) {
            const a = args[idx]
            if (!isInt(a.value)) {
                out.push(makeMarker(text, a.start, a.end,
                    `${label} must be an integer, got: ${a.value || '(empty)'}.`,
                ))
            } else {
                const n = Number(a.value)
                if (n < min || n > max) {
                    out.push(makeMarker(text, a.start, a.end,
                        `${label} value ${n} is out of range (${min}–${max}).`,
                        monaco.MarkerSeverity.Warning,
                    ))
                }
            }
        }

        const desc = args[3]
        if (!isQuotedString(desc.value)) {
            out.push(makeMarker(text, desc.start, desc.end,
                `Description must be a double-quoted string, e.g. "Yard Exit".`,
            ))
        }
    }
}

// ── PIN_TURNOUT validator ─────────────────────────────────────────────────────

/**
 * PIN_TURNOUT(id, pin, "description")
 */
function validatePinTurnout(text: string, out: monaco.editor.IMarkerData[]): void {
    for (const { fullMatch: m, argsRaw, innerStart } of eachMacroCall(text, 'PIN_TURNOUT')) {
        const args = parseArgSpans(argsRaw, innerStart)
        if (args.length !== 3) {
            out.push(makeMarker(
                text, m.index, m.index + m[0].length,
                `PIN_TURNOUT expects 3 arguments (id, pin, "desc") but got ${args.length}.`,
            ))
            continue
        }

        const intChecks: Array<{ idx: number; label: string; min: number; max: number }> = [
            { idx: 0, label: 'ID', min: 0, max: 32767 },
            { idx: 1, label: 'pin', min: 0, max: 65535 },
        ]
        for (const { idx, label, min, max } of intChecks) {
            const a = args[idx]
            if (!isInt(a.value)) {
                out.push(makeMarker(text, a.start, a.end,
                    `${label} must be an integer, got: ${a.value || '(empty)'}.`,
                ))
            } else {
                const n = Number(a.value)
                if (n < min || n > max) {
                    out.push(makeMarker(text, a.start, a.end,
                        `${label} value ${n} is out of range (${min}–${max}).`,
                        monaco.MarkerSeverity.Warning,
                    ))
                }
            }
        }

        const desc = args[2]
        if (!isQuotedString(desc.value)) {
            out.push(makeMarker(text, desc.start, desc.end,
                `Description must be a double-quoted string, e.g. "Siding".`,
            ))
        }
    }
}

// ── Turnout ID uniqueness (myTurnouts.h) ──────────────────────────────────────

/**
 * SERVO_TURNOUT/TURNOUT/PIN_TURNOUT all share one ID namespace (see
 * `collectObjectIdReferences` — a Turnout is matched purely on `id`, regardless
 * of which of the three macros defined it). Flags the 2nd+ occurrence of any ID.
 */
function validateTurnoutIdUniqueness(text: string, out: monaco.editor.IMarkerData[]): void {
    const seen = new Set<number>()

    for (const macroName of ['SERVO_TURNOUT', 'TURNOUT', 'PIN_TURNOUT']) {
        for (const { fullMatch: m, argsRaw, innerStart } of eachMacroCall(text, macroName)) {
            if (macroName === 'TURNOUT' && m.index > 0 && /\w/.test(text[m.index - 1])) continue

            const idArg = parseArgSpans(argsRaw, innerStart)[0]
            if (!idArg || !isInt(idArg.value)) continue

            const id = Number(idArg.value)
            if (seen.has(id)) {
                out.push(makeMarker(text, idArg.start, idArg.end,
                    `Turnout ID ${id} is already used by another entry in this file.`,
                ))
            } else {
                seen.add(id)
            }
        }
    }
}

// ── ROUTE/AUTOMATION/SEQUENCE ID uniqueness (myRoutes.h / mySequences.h / myAutomation.h) ─────

const SEQUENCE_ID_MACRO: Record<string, { macroName: 'ROUTE' | 'SEQUENCE' | 'AUTOMATION'; kind: SequenceObjectKind }> = {
    'myRoutes.h': { macroName: 'ROUTE', kind: 'Route' },
    'mySequences.h': { macroName: 'SEQUENCE', kind: 'Sequence' },
    'myAutomation.h': { macroName: 'AUTOMATION', kind: 'Automation' },
}

/**
 * Flags every ROUTE/AUTOMATION/SEQUENCE id in this file that `validateSequenceIds` (see
 * myAutomationParser.ts) reports as out-of-range or colliding with another entry — including one
 * living in a different one of the three files, since they all share one id namespace.
 */
function validateSequenceIdRules(
    text: string,
    filename: string,
    violations: SequenceIdViolation[],
    out: monaco.editor.IMarkerData[],
): void {
    const target = SEQUENCE_ID_MACRO[filename]
    if (!target) return

    const byId = new Map<number, string[]>()
    for (const v of violations) {
        if (v.kind !== target.kind) continue
        const list = byId.get(v.id)
        if (list) list.push(v.reason)
        else byId.set(v.id, [v.reason])
    }
    if (byId.size === 0) return

    for (const { argsRaw, innerStart } of eachMacroCall(text, target.macroName)) {
        const idArg = parseArgSpans(argsRaw, innerStart)[0]
        if (!idArg || !isInt(idArg.value)) continue
        const reasons = byId.get(Number(idArg.value))
        if (!reasons) continue
        for (const reason of reasons) {
            out.push(makeMarker(text, idArg.start, idArg.end, reason))
        }
    }
}

// ── ALIAS validator (myAliases.h) ─────────────────────────────────────────────

/**
 * ALIAS(name, value)
 *   arg 1 — identifier: starts with a letter/underscore, then letters/digits/underscores,
 *           must not collide with an EXRAIL command name
 *   arg 2 — required plain integer matching an existing object's ID (no leading zero —
 *           C treats that as octal)
 */
function validateAlias(text: string, out: monaco.editor.IMarkerData[]): void {
    const seen = new Map<string, number>()

    for (const { fullMatch: m, argsRaw, innerStart } of eachMacroCall(text, 'ALIAS')) {
        const args = parseArgSpans(argsRaw, innerStart)

        if (args.length < 1 || args.length > 2) {
            out.push(makeMarker(
                text, m.index, m.index + m[0].length,
                `ALIAS expects 1 or 2 arguments (name[, value]) but got ${args.length}.`,
            ))
            continue
        }

        const [name, value] = args
        const nameCheck = validateAliasName(name.value)
        if (!nameCheck.ok) {
            out.push(makeMarker(text, name.start, name.end, nameCheck.reason))
        } else if (seen.has(name.value)) {
            out.push(makeMarker(text, name.start, name.end,
                `Alias name "${name.value}" is defined more than once.`,
            ))
        } else {
            seen.set(name.value, name.start)
        }

        if (value) {
            const valueCheck = validateAliasValue(value.value)
            if (!valueCheck.ok) {
                out.push(makeMarker(text, value.start, value.end, valueCheck.reason))
            }
        } else {
            out.push(makeMarker(
                text, m.index, m.index + m[0].length,
                'ALIAS requires a value referencing an existing Roster/Turnout/Sensor/Route/Sequence ID.',
            ))
        }
    }
}

// ── ALIAS target-reference validator (myAliases.h) ────────────────────────────

/** Data an ALIAS's numeric value is checked against — same shape as `ExrailCompletionData`. */
interface AliasTargetData extends ObjectIdCollections {
    aliases: AliasEntry[]
}

/**
 * Flags an ALIAS whose numeric value doesn't match any currently configured
 * Roster/Turnout/Sensor/Route/Sequence ID — the alias would resolve to nothing.
 */
function validateAliasTargets(text: string, out: monaco.editor.IMarkerData[], data: AliasTargetData): void {
    for (const { argsRaw, innerStart } of eachMacroCall(text, 'ALIAS')) {
        const args = parseArgSpans(argsRaw, innerStart)
        if (args.length < 2) continue // missing value already flagged by validateAlias

        const value = args[1]
        if (!isInt(value.value)) continue // malformed value already flagged by validateAliasValue

        const n = Number(value.value)
        if (collectObjectIdReferences(n, data).length === 0) {
            out.push(makeMarker(text, value.start, value.end,
                `Alias value ${n} does not match any configured Roster/Turnout/Sensor/Route/Sequence ID.`,
            ))
        }
    }
}

// ── EXRAIL object-reference validator (myAutomation.h / myRoutes.h / mySequences.h) ────

/** True when `value` is a configured object ID or a defined alias resolving to one of `targetTypes`. */
function isValidExrailReference(value: string, targetTypes: ExrailRefKind[], data: ExrailCompletionData): boolean {
    if (isInt(value)) {
        const n = Number(value)
        return targetTypes.some((type) => {
            switch (type) {
                case 'Roster': return data.roster.some((r) => r.dccAddress === n)
                case 'Turnout': return data.turnouts.some((t) => t.id === n)
                case 'Sensor': return (data.sensors ?? []).some((s) => s.id === n)
                case 'Route': return (data.routes ?? []).some((r) => r.id === n)
                case 'Sequence': return (data.sequences ?? []).some((s) => s.id === n)
                case 'Signal': return (data.signals ?? []).some((s) => s.red === n)
                default: return false
            }
        })
    }
    // Track is a bare letter (A/B/C/D) — never numeric, and never alias-eligible (no ALIAS
    // mechanism covers tracks) — so it's checked directly rather than falling into the
    // identifier/alias branch below, which would otherwise (incorrectly) look it up as an alias
    // name and almost always fail.
    if (targetTypes.includes('Track') && (data.tracks ?? []).some((t) => String(t.value) === value)) {
        return true
    }
    if (isIdentifier(value)) {
        const alias = data.aliases.find((a) => a.name === value)
        if (!alias) return false
        const aliasTypes = alias.aliasType ? [alias.aliasType] : inferAliasTypes(alias, data)
        return aliasTypes.some((t) => targetTypes.includes(t))
    }
    // Neither a number nor a bare identifier — e.g. an expression or quoted string
    // where an object reference was expected.
    return false
}

/**
 * Flags THROW/CLOSE/AT/SETLOCO/etc. arguments that don't resolve to any
 * currently configured turnout/sensor/route/sequence/roster entry or alias.
 */
function validateExrailReferences(text: string, out: monaco.editor.IMarkerData[], data: ExrailCompletionData): void {
    for (const command of EXRAIL_REFERENCE_COMMANDS) {
        for (const { argsRaw, innerStart } of eachMacroCall(text, command)) {
            const args = parseArgSpans(argsRaw, innerStart)
            args.forEach((arg, argumentIndex) => {
                if (arg.value === '') return  // missing/empty argument — not this validator's concern

                const targetTypes = getTargetTypes(command, argumentIndex)
                if (targetTypes.length === 0) return  // this argument slot isn't an object reference

                if (!isValidExrailReference(arg.value, targetTypes, data)) {
                    const typeLabel = targetTypes.join('/')
                    out.push(makeMarker(text, arg.start, arg.end,
                        `'${arg.value}' is not a configured ${typeLabel} ID or alias.`,
                    ))
                }
            })
        }
    }
}

// ── EXRAIL command-name casing validator ────────────────────────────────────────

/**
 * Replaces `// ...` line comments with spaces (preserving offsets/newlines) so the
 * casing scan below never matches command-like words inside prose comments.
 * Quoted strings are tracked so a `//` inside a string literal isn't treated as
 * the start of a comment.
 */
function blankLineComments(text: string): string {
    const chars = text.split('')
    let inStr = false
    let esc = false
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]
        if (inStr) {
            if (esc) { esc = false; continue }
            if (ch === '\\') { esc = true; continue }
            if (ch === '"') inStr = false
            continue
        }
        if (ch === '"') { inStr = true; continue }
        if (ch === '/' && chars[i + 1] === '/') {
            while (i < chars.length && chars[i] !== '\n') { chars[i] = ' '; i++ }
        }
    }
    return chars.join('')
}

/** Offset → true while inside a double-quoted string (same scan style as parseArgSpans). */
function buildStringMask(text: string): boolean[] {
    const mask: boolean[] = new Array(text.length).fill(false)
    let inStr = false
    let esc = false
    for (let i = 0; i < text.length; i++) {
        mask[i] = inStr
        const ch = text[i]
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if (ch === '"') { inStr = !inStr; continue }
    }
    return mask
}

/**
 * EXRAIL command names are C preprocessor macros and are case-sensitive —
 * `throw(200)` is not recognised as `THROW(200)`, it's an undefined symbol that
 * fails to compile. Flags any word that matches a known command name only when
 * case is ignored, restricted to genuine command position (immediately followed
 * by `(`, or standing alone on its own line for paren-less keywords like DONE)
 * so identifiers/aliases used as *arguments* are never flagged.
 */
function validateExrailCommandCasing(text: string, filename: string, out: monaco.editor.IMarkerData[]): void {
    const canonicalNames = new Set(
        getCompletions(filename)
            .map((s) => s.label)
            .filter((label) => /^[A-Z][A-Z0-9_]*$/.test(label)),
    )
    if (canonicalNames.size === 0) return

    const scanText = blankLineComments(text)
    const stringMask = buildStringMask(scanText)

    const tokenRe = /[A-Za-z_][A-Za-z0-9_]*/g
    let m: RegExpExecArray | null
    while ((m = tokenRe.exec(scanText)) !== null) {
        const token = m[0]
        const upper = token.toUpperCase()
        if (token === upper) continue  // already correctly cased
        if (!canonicalNames.has(upper)) continue  // not a known EXRAIL command at all
        if (stringMask[m.index]) continue  // inside a quoted string

        const afterIdx = m.index + token.length
        const lineEnd = scanText.indexOf('\n', m.index)
        const restOfLine = scanText.slice(afterIdx, lineEnd === -1 ? scanText.length : lineEnd)
        const followedByParen = /^\s*\(/.test(restOfLine)

        const lineStart = scanText.lastIndexOf('\n', m.index) + 1
        const line = scanText.slice(lineStart, lineEnd === -1 ? scanText.length : lineEnd)
        const isBareLine = line.trim() === token

        if (followedByParen || isBareLine) {
            out.push(makeMarker(text, m.index, afterIdx,
                `EXRAIL commands are case-sensitive — '${token}' should be '${upper}'.`,
            ))
        }
    }
}

/**
 * EXRAIL only recognises a fixed vocabulary of macro names — every other identifier
 * in command position is a compile-time error, not a warning. Flags any word in
 * genuine command position (immediately followed by `(`, or standing alone on its
 * own line for paren-less keywords like DONE) whose uppercased form does *not*
 * match any known command for this file at all — a case mismatch on a real command
 * is validateExrailCommandCasing's job, not this one.
 */
function validateUnknownExrailCommand(text: string, filename: string, out: monaco.editor.IMarkerData[]): void {
    const canonicalNames = new Set(
        getCompletions(filename)
            .map((s) => s.label)
            .filter((label) => /^[A-Z][A-Z0-9_]*$/.test(label)),
    )
    if (canonicalNames.size === 0) return

    const scanText = blankLineComments(text)
    const stringMask = buildStringMask(scanText)

    const tokenRe = /[A-Za-z_][A-Za-z0-9_]*/g
    let m: RegExpExecArray | null
    while ((m = tokenRe.exec(scanText)) !== null) {
        const token = m[0]
        const upper = token.toUpperCase()
        if (canonicalNames.has(upper)) continue  // known command, right case or wrong — casing validator's job
        if (stringMask[m.index]) continue  // inside a quoted string

        const afterIdx = m.index + token.length
        const lineEnd = scanText.indexOf('\n', m.index)
        const restOfLine = scanText.slice(afterIdx, lineEnd === -1 ? scanText.length : lineEnd)
        const followedByParen = /^\s*\(/.test(restOfLine)

        const lineStart = scanText.lastIndexOf('\n', m.index) + 1
        const line = scanText.slice(lineStart, lineEnd === -1 ? scanText.length : lineEnd)
        const isBareLine = line.trim() === token

        if (followedByParen || isBareLine) {
            out.push(makeMarker(text, m.index, afterIdx,
                `'${token}' is not a recognised EXRAIL command.`,
            ))
        }
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

const OWNER = 'dccex-validator'

const FILE_VALIDATORS: Record<string, (text: string, out: monaco.editor.IMarkerData[]) => void> = {
    'myRoster.h': validateRoster,
    'myAliases.h': validateAlias,
    'myTurnouts.h': (text, out) => {
        validateServoTurnout(text, out)
        validateTurnout(text, out)
        validatePinTurnout(text, out)
        validateTurnoutIdUniqueness(text, out)
    },
}

/** True when this file has a known set of macro commands worth case-checking (ROSTER, TURNOUT, THROW, ...). */
function hasCommandVocabulary(filename: string): boolean {
    return getCompletions(filename).length > 0
}

function validateModel(model: monaco.editor.ITextModel): void {
    const filename = model.uri.path.replace(/^\//, '')
    const validate = FILE_VALIDATORS[filename]
    const isExrailFile = isExrailCompletionFile(filename)
    const hasVocabulary = hasCommandVocabulary(filename)
    if (!validate && !isExrailFile && !hasVocabulary) return

    const text = model.getValue()
    const markers: monaco.editor.IMarkerData[] = []

    if (validate) validate(text, markers)

    // Case-sensitivity applies to every macro-file "vocabulary" (ROSTER, SERVO_TURNOUT,
    // SENSOR, SIGNAL, THROW, ...), not just the EXRAIL script files.
    if (hasVocabulary) validateExrailCommandCasing(text, filename, markers)

    // Unknown-command checking, unlike casing, is restricted to the closed-vocabulary
    // object-definition files (myRoster.h, myTurnouts.h, mySensors.h, mySignals.h,
    // myAliases.h) — each holds exactly one or two macro types generated by this app's
    // own forms. The EXRAIL script files (myAutomation.h, myRoutes.h, mySequences.h,
    // myEvents.h, myStartup.h) are real, hand-editable C++ headers where a user may
    // legitimately call their own custom function, so an unrecognised name there is not
    // necessarily an error.
    if (hasVocabulary && !isExrailFile) validateUnknownExrailCommand(text, filename, markers)

    if (isExrailFile) {
        const state = getSharedConfigEditorState()
        if (state) {
            validateExrailReferences(text, markers, {
                aliases: state.aliases,
                roster: state.roster,
                turnouts: state.turnouts,
                sensors: state.sensors,
                routes: state.routes,
                sequences: state.sequences,
                signals: state.signals,
                tracks: definedTracksFor(state.hasStackedMotorShield),
            })
        }
    }

    if (filename === 'myAliases.h') {
        const state = getSharedConfigEditorState()
        if (state) {
            validateAliasTargets(text, markers, {
                aliases: state.aliases,
                roster: state.roster,
                turnouts: state.turnouts,
                sensors: state.sensors,
                routes: state.routes,
                sequences: state.sequences,
            })
        }
    }

    if (SEQUENCE_ID_MACRO[filename]) {
        const state = getSharedConfigEditorState()
        if (state) validateSequenceIdRules(text, filename, state.getSequenceIdViolations(), markers)
    }

    monaco.editor.setModelMarkers(model, OWNER, markers)
}

// ── Test helper ───────────────────────────────────────────────────────────────

/**
 * Run the validators for a given filename against `text` and return simplified
 * marker data.  Use only in unit tests — not part of the public runtime API.
 *
 * `exrailData`, when supplied, also runs the EXRAIL object-reference validator
 * for myAutomation.h / myRoutes.h / mySequences.h (THROW/CLOSE/AT/SETLOCO/etc.),
 * or the ALIAS target-reference validator for myAliases.h.
 *
 * `sequenceIdEntries`, when supplied, also runs the ROUTE/AUTOMATION/SEQUENCE id
 * range/uniqueness validator (see validateSequenceIds in myAutomationParser.ts) for
 * myRoutes.h / mySequences.h / myAutomation.h, using the full combined list — same as
 * ConfigEditorState.sequenceIdEntries would produce in the real app.
 */
export function _runValidatorsForTest(
    filename: string,
    text: string,
    exrailData?: ExrailCompletionData,
    sequenceIdEntries?: SequenceIdEntry[],
): Array<{ message: string; severity: number }> {
    const markers: monaco.editor.IMarkerData[] = []

    const validate = FILE_VALIDATORS[filename]
    if (validate) validate(text, markers)

    if (hasCommandVocabulary(filename)) {
        validateExrailCommandCasing(text, filename, markers)
        if (!isExrailCompletionFile(filename)) validateUnknownExrailCommand(text, filename, markers)
    }

    if (isExrailCompletionFile(filename) && exrailData) {
        validateExrailReferences(text, markers, exrailData)
    }

    if (filename === 'myAliases.h' && exrailData) {
        validateAliasTargets(text, markers, exrailData)
    }

    if (sequenceIdEntries) {
        validateSequenceIdRules(text, filename, validateSequenceIds(sequenceIdEntries), markers)
    }

    return markers.map((m) => ({ message: m.message, severity: m.severity }))
}

/**
 * Re-run validation on a specific model and update its markers, then force
 * the editor's decoration layer to repaint immediately.
 *
 * `editor` is optional — when supplied, `editor.render(true)` is called after
 * `setModelMarkers` so the squiggle background images are flushed to the
 * visible canvas without waiting for the next animation frame.
 */
export function revalidateModel(
    model: monaco.editor.ITextModel,
    editor?: monaco.editor.IStandaloneCodeEditor,
): void {
    validateModel(model)
    // Force a full decoration repaint so squiggly SVG background images appear
    // immediately rather than waiting for the browser's next paint cycle.
    editor?.render(true)
}

/**
 * Register model lifecycle listeners that run validators and set squiggle
 * markers. Call this once from `registerProviders()` in `monaco-editor.ts`.
 */
export function registerDiagnosticProviders(): void {
    // Validate existing models (e.g. after HMR reload)
    for (const model of monaco.editor.getModels()) {
        validateModel(model)
    }
    // Validate on model creation and on every subsequent content change
    monaco.editor.onDidCreateModel((model) => {
        validateModel(model)
        model.onDidChangeContent(() => validateModel(model))
    })
}

/** True if any open Monaco model (any config file) currently has an Error-severity marker. Drives the "strict compile" preference — see workspace.ts's canCompile. */
export function hasErrorMarkers(): boolean {
    return monaco.editor.getModelMarkers({}).some((m) => m.severity === monaco.MarkerSeverity.Error)
}

/** Fires whenever any model's markers change anywhere in the app — used to keep strict-compile's error gate live-updated without polling. */
export function onMarkersChanged(callback: () => void): monaco.IDisposable {
    return monaco.editor.onDidChangeMarkers(() => callback())
}

/** Filenames (matching state.configFiles' `name`, e.g. "myAutomation.h") of every open Monaco model that currently has an Error-severity marker. Drives the file-list error indicator in workspace.html. */
export function filesWithErrorMarkers(): Set<string> {
    const files = new Set<string>()
    for (const m of monaco.editor.getModelMarkers({})) {
        if (m.severity === monaco.MarkerSeverity.Error) files.add(m.resource.path.replace(/^\//, ''))
    }
    return files
}
