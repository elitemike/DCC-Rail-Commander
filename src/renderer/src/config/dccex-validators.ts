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

// ── Registration ──────────────────────────────────────────────────────────────

const OWNER = 'dccex-validator'

const FILE_VALIDATORS: Record<string, (text: string, out: monaco.editor.IMarkerData[]) => void> = {
    'myRoster.h': validateRoster,
    'myTurnouts.h': (text, out) => {
        validateServoTurnout(text, out)
        validateTurnout(text, out)
        validatePinTurnout(text, out)
    },
}

function validateModel(model: monaco.editor.ITextModel): void {
    const filename = model.uri.path.replace(/^\//, '')
    const validate = FILE_VALIDATORS[filename]
    if (!validate) return

    const markers: monaco.editor.IMarkerData[] = []
    validate(model.getValue(), markers)
    monaco.editor.setModelMarkers(model, OWNER, markers)
}

// ── Test helper ───────────────────────────────────────────────────────────────

/**
 * Run the validators for a given filename against `text` and return simplified
 * marker data.  Use only in unit tests — not part of the public runtime API.
 */
export function _runValidatorsForTest(
    filename: string,
    text: string,
): Array<{ message: string; severity: number }> {
    const validate = FILE_VALIDATORS[filename]
    if (!validate) return []
    const markers: monaco.editor.IMarkerData[] = []
    validate(text, markers)
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
