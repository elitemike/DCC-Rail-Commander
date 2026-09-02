/**
 * project-importer.ts — aggregates a hand-rolled, multi-file EX-RAIL project (content
 * scattered across arbitrarily-named files, the normal shape for a project not created by this
 * app) into this app's own canonical multi-file layout. Pure data transformation: takes the old
 * project's files in memory, returns a ready-to-load `configFiles` array plus a report of what
 * happened — no filesystem or Aurelia DI access here (see `views/home.ts`'s import flow for the
 * folder-picking/writing side of this).
 *
 * Three problems a real hand-written project creates that this app's structured parsers don't
 * handle on their own:
 *
 * 1. Every structured declaration (ROSTER/TURNOUT-family/SENSOR/SIGNAL/ROUTE/SEQUENCE/AUTOMATION) is
 *    commonly written with an ALIAS *name* in its id position (`SEQUENCE(SEQ_FOO)`), not the
 *    numeric literal every parser's regex requires. `substituteAliasNames()` resolves these
 *    first, mirroring what the C preprocessor does with ALIAS at compile time.
 * 2. `ALIAS` itself is one flat, undifferentiated declaration form reused for locos, turnouts,
 *    sensors, blocks, latches, routes, sequences, and automations — nothing in its syntax says
 *    which. `classifyAliasUsage()` infers each alias's role from how its name is actually used
 *    elsewhere in the project (which macro, which argument position), combined with the
 *    existing numeric-value-match heuristic (`inferAliasTypes`). Confident results get tagged;
 *    anything ambiguous is still imported untouched but flagged for manual review rather than
 *    guessed at.
 * 3. Content this app has no structured editor for at all (turntables, `#define` macros) or
 *    couldn't confidently resolve (an ambiguous bare `HAL(...)` line) must not be silently
 *    dropped. `computeLeftover()` identifies exactly the text no structured parser consumed, per
 *    old file, and that becomes one new custom file per old file that still has something left
 *    in it — the same already-`#include`d, always-raw "custom file" mechanism a user gets from
 *    the Configuration list's own + button (see `ConfigEditorState.addCustomFile`).
 */
import {
    parseAliasesFromFile,
    serializeAliasesToFile,
    parseAliasNumericValue,
    inferAliasTypes,
    parseRosterFromFile,
    serializeRosterToFile,
    commentInvalidRosterLines,
    parseTurnoutFromFile,
    serializeTurnoutToFile,
    commentInvalidTurnoutLines,
    parseSensorsFromFile,
    serializeSensorsToFile,
    parseSignalsFromFile,
    serializeSignalsToFile,
    parseRoutesFromFile,
    serializeRoutesToFile,
    parseSequencesFromFile,
    serializeSequencesToFile,
    parseAutomationsFromFile,
    serializeAutomationsToFile,
    parseEventHandlersFromFile,
    serializeEventHandlersToFile,
    type AliasEntry,
    type AliasTargetType,
    type Roster,
    type Turnout,
    type SensorEntry,
    type SignalEntry,
    type RouteEntry,
    type SequenceEntry,
    type AutomationEntry,
    type EventHandlerEntry,
    type ObjectIdCollections,
} from '../utils/myAutomationParser'
import {
    parseHalDevicesFromAutomation,
    generateHalDevicesBlock,
    HAL_MUX_COMMENT_RE,
    HAL_DEVICE_COMMENT_RE,
    HAL_LINE_RE,
    hasUniqueHalCandidate,
    type HalDeviceInstance,
} from '../config/hal-devices'
export type { HalDeviceInstance }
import { MANAGED_HAL_DEVICES_TAG } from './config-editor-state'

export interface ImportFile {
    name: string
    content: string
}

/** Every role a scan of the project's actual EX-RAIL usage can assign to an alias name.
 *  `AliasTargetType` covers everything with a matching `// type: X` comment this app's alias
 *  editor understands — the rest (Block/Latch/Signal) are real, confidently-determined roles
 *  with no taggable representation, not gaps. */
type UsageRole = AliasTargetType | 'SequenceOrRoute' | 'Block' | 'Latch' | 'Signal'

const TAGGABLE_ROLES: ReadonlySet<UsageRole> = new Set<UsageRole>(['Roster', 'Turnout', 'Sensor', 'Route', 'Sequence', 'Automation'])
const UNTAGGABLE_ROLES: ReadonlySet<UsageRole> = new Set<UsageRole>(['Block', 'Latch', 'Signal'])

export interface AliasReviewItem {
    name: string
    /** Human-readable reason a person needs to look at this one. */
    reason: string
    /** Distinct declared values and which old files declared each — more than one entry means a conflict. */
    values: { value: string; files: string[] }[]
    observedRoles: UsageRole[]
    /** Best-guess type, if any evidence pointed to one — still written untagged in myAliases.h until confirmed. */
    suggestedType?: AliasTargetType
}

export type ImportFileStatus = 'fully-migrated' | 'partial-leftover' | 'fully-leftover'

export interface ImportFileReport {
    originalName: string
    status: ImportFileStatus
    /** Name of the new custom file holding this file's leftover content, if any. */
    leftoverFileName?: string
}

export interface ImportConflict {
    kind: 'Roster' | 'Turnout' | 'Sensor' | 'Signal' | 'Route' | 'Sequence' | 'Automation'
    id: number
    files: string[]
}

export interface ImportResult {
    /** Ready to assign directly to `InstallerState.configFiles`. */
    configFiles: ImportFile[]
    fileReports: ImportFileReport[]
    aliasReview: AliasReviewItem[]
    conflicts: ImportConflict[]
    /** Every HAL accessory device merged across all old files — exposed (in addition to being
     *  already baked into `configFiles`'s `myAutomation.h` entry) so a caller can prompt for real
     *  labels on the ones still carrying a generic catalog default (`isDefaultLabel`) before
     *  finalizing the import — see `buildHalDevicesFile()` below and home.ts's import flow. */
    halDevices: HalDeviceInstance[]
}

/** Builds the `myAutomation.h`-entry-shaped `ImportFile` for a HAL Devices managed block — the
 *  same shape `importExistingProject()`'s Step 4 emits, factored out so a caller can rebuild it
 *  after editing device labels without duplicating the managed-block wrapping. */
export function buildHalDevicesFile(devices: readonly HalDeviceInstance[]): ImportFile {
    const block = [MANAGED_HAL_DEVICES_TAG, generateHalDevicesBlock(devices as HalDeviceInstance[]), MANAGED_HAL_DEVICES_TAG].join('\n')
    return { name: 'myAutomation.h', content: block }
}

// ── Alias-name → numeric-value resolution ──────────────────────────────────

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Marks every character that sits inside a double-quoted string literal (respecting `\"`),
 *  so substitution/consumption logic can skip real description text a user typed, rather than
 *  only code. */
function buildStringMask(text: string): boolean[] {
    const mask = new Array<boolean>(text.length).fill(false)
    let inQuote = false
    let escaped = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (escaped) {
            mask[i] = inQuote
            escaped = false
            continue
        }
        if (ch === '\\') {
            mask[i] = inQuote
            escaped = true
            continue
        }
        if (ch === '"') {
            inQuote = !inQuote
            mask[i] = true
            continue
        }
        mask[i] = inQuote
    }
    return mask
}

/** Substitutes known ALIAS names for their resolved numeric value, mirroring what the C
 *  preprocessor does with ALIAS at compile time — every structured parser in this codebase
 *  expects a numeric literal in an id position, but idiomatic EX-RAIL style commonly declares
 *  ids by alias name instead. Skips occurrences inside quoted strings, so a description that
 *  happens to contain matching text is left untouched. Line count/structure is preserved
 *  exactly (only identifier tokens are replaced), so a resolved line always corresponds 1:1 to
 *  the same line number in the original — `computeLeftover` below depends on that. */
function substituteAliasNames(text: string, aliasValues: ReadonlyMap<string, string>): string {
    if (aliasValues.size === 0) return text
    const names = Array.from(aliasValues.keys()).sort((a, b) => b.length - a.length)
    const re = new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})\\b`, 'g')
    const mask = buildStringMask(text)
    return text.replace(re, (match, offset: number) => (mask[offset] ? match : (aliasValues.get(match) ?? match)))
}

interface AliasOccurrence {
    value: string
    file: string
}

function collectAliasOccurrences(files: readonly ImportFile[]): Map<string, AliasOccurrence[]> {
    const map = new Map<string, AliasOccurrence[]>()
    for (const f of files) {
        for (const a of parseAliasesFromFile(f.content)) {
            if (parseAliasNumericValue(a.value) === null) continue // ALIAS(name) with no value — nothing to resolve or classify
            const list = map.get(a.name) ?? []
            list.push({ value: a.value.trim(), file: f.name })
            map.set(a.name, list)
        }
    }
    return map
}

// ── Usage-context classification ────────────────────────────────────────────

interface RoleRule {
    re: RegExp
    role: UsageRole
}

// One macro/argument-position → implied role per rule. Ordered so a longer name (TURNOUTL,
// SERVO_TURNOUT, IFRESERVE, ATTIMEOUT, IFRED) is tried before a shorter one it starts with
// (TURNOUT, RESERVE, AT, RED) inside the same alternation — matches this codebase's existing
// convention for the same ambiguity elsewhere (see myAutomationParser.ts's TURNOUT/TURNOUTL
// handling). `\b` plus requiring the macro name to be immediately followed by `(` (only
// whitespace between) is what actually prevents cross-matching, as already established there;
// the ordering here is just for readability, not correctness.
const ROLE_RULES: RoleRule[] = [
    { re: /\b(?:TURNOUTL|SERVO_TURNOUT|PIN_TURNOUT|VIRTUAL_TURNOUT|TURNOUT|THROW|CLOSE|ONTHROW|ONCLOSE)\s*\(\s*([A-Za-z_]\w*)/g, role: 'Turnout' },
    { re: /\bSEQUENCE\s*\(\s*([A-Za-z_]\w*)/g, role: 'Sequence' },
    { re: /\b(?:CALL|FOLLOW)\s*\(\s*([A-Za-z_]\w*)/g, role: 'SequenceOrRoute' },
    { re: /\bROUTE\s*\(\s*([A-Za-z_]\w*)/g, role: 'Route' },
    { re: /\bAUTOMATION\s*\(\s*([A-Za-z_]\w*)/g, role: 'Automation' },
    { re: /\b(?:IFRESERVE|RESERVE|FREE)\s*\(\s*([A-Za-z_]\w*)/g, role: 'Block' },
    { re: /\b(?:LATCH|UNLATCH)\s*\(\s*([A-Za-z_]\w*)/g, role: 'Latch' },
    { re: /\b(?:IFLOCO|SETLOCO|ROSTER)\s*\(\s*([A-Za-z_]\w*)/g, role: 'Roster' },
    { re: /\b(?:IFRED|RED|GREEN|AMBER|DCC_SIGNAL|SIGNAL)\s*\(\s*([A-Za-z_]\w*)/g, role: 'Signal' },
    { re: /\b(?:ATTIMEOUT|AT|AFTER)\s*\(\s*-?([A-Za-z_]\w*)/g, role: 'Sensor' },
]
// SENDLOCO(loco, target) names a role per argument position, not per whole call.
const SENDLOCO_RE = /\bSENDLOCO\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g

/** Blanks out `//` comment tails (outside quoted strings) — a commented-out, dead reference to
 *  an alias must not count as real usage evidence, or a leftover-in-a-comment mention can
 *  produce false confidence in a classification nothing actually depends on. */
function stripLineComments(text: string): string {
    const mask = buildStringMask(text)
    return text.replace(/\/\/.*$/gm, (match, offset: number) => (mask[offset] ? match : ''))
}

/** Scans every old file's *original* (pre-substitution) text — the alias names this looks for
 *  are exactly what substitution would have erased. Comments are stripped first (see
 *  `stripLineComments`) so a commented-out reference doesn't count as real usage. */
function scanUsageRoles(files: readonly ImportFile[]): Map<string, Set<UsageRole>> {
    const roles = new Map<string, Set<UsageRole>>()
    const add = (name: string, role: UsageRole): void => {
        const set = roles.get(name) ?? new Set<UsageRole>()
        set.add(role)
        roles.set(name, set)
    }
    for (const original of files) {
        const f = { name: original.name, content: stripLineComments(original.content) }
        for (const rule of ROLE_RULES) {
            rule.re.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = rule.re.exec(f.content)) !== null) add(m[1], rule.role)
        }
        SENDLOCO_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = SENDLOCO_RE.exec(f.content)) !== null) {
            add(m[1], 'Roster')
            add(m[2], 'SequenceOrRoute')
        }
    }
    return roles
}

/**
 * Resolves one alias's type from its declared value(s) plus how its name is actually used
 * across the project. Returns `questionable: true` whenever the answer is a guess rather than a
 * fact — a declared-with-conflicting-values name, no evidence anywhere, or evidence that points
 * more than one way — so it can be surfaced for a human decision instead of silently picked.
 */
function classifyAlias(
    name: string,
    occurrences: readonly AliasOccurrence[],
    observedRoles: ReadonlySet<UsageRole>,
    data: ObjectIdCollections,
): { suggestedType?: AliasTargetType; questionable: boolean; reason?: string } {
    const distinctValues = Array.from(new Set(occurrences.map(o => o.value)))
    if (distinctValues.length > 1) {
        return { questionable: true, reason: `Declared with different values across files: ${distinctValues.join(', ')}.` }
    }

    const value = distinctValues[0]
    const numericValue = parseAliasNumericValue(value)
    const valueMatchTypes = numericValue === null ? [] : inferAliasTypes({ name, value }, data)

    const taggableObserved = Array.from(observedRoles).filter((r): r is AliasTargetType => TAGGABLE_ROLES.has(r))
    const untaggableObserved = Array.from(observedRoles).filter(r => UNTAGGABLE_ROLES.has(r))
    const ambiguousCallTarget = observedRoles.has('SequenceOrRoute')

    if (taggableObserved.length > 1) {
        return { questionable: true, reason: `Used inconsistently as more than one type: ${taggableObserved.join(', ')}.` }
    }
    if (taggableObserved.length === 1) {
        const role = taggableObserved[0]
        if (valueMatchTypes.length > 0 && !valueMatchTypes.includes(role)) {
            return { questionable: true, reason: `Used as a ${role}, but its value (${value}) doesn't match any declared ${role}.` }
        }
        return { suggestedType: role, questionable: false }
    }
    if (untaggableObserved.length > 1) {
        return { questionable: true, reason: `Used inconsistently across more than one role: ${untaggableObserved.join(', ')}.` }
    }
    if (untaggableObserved.length === 1 && !ambiguousCallTarget) {
        // A confident, real classification — Block/Latch/Signal just have no matching
        // AliasTargetType to tag, so this is correct output, not a gap.
        return { questionable: false }
    }
    if (ambiguousCallTarget && untaggableObserved.length === 0) {
        const narrowed = valueMatchTypes.filter(t => t === 'Route' || t === 'Sequence')
        if (narrowed.length === 1) return { suggestedType: narrowed[0], questionable: false }
        return {
            questionable: true,
            reason: 'Used as a CALL/FOLLOW/SENDLOCO target — ambiguous between Route and Sequence, no matching declaration found.',
        }
    }
    if (taggableObserved.length === 0 && untaggableObserved.length === 0 && !ambiguousCallTarget) {
        if (valueMatchTypes.length === 1) return { suggestedType: valueMatchTypes[0], questionable: false }
        if (valueMatchTypes.length > 1) {
            return { questionable: true, reason: `Value ${value} matches more than one declared object type: ${valueMatchTypes.join(', ')}.` }
        }
        return { questionable: true, reason: 'No usage found anywhere in the project — its type can\'t be determined.' }
    }
    return { questionable: true, reason: 'Mixed usage evidence — needs manual review.' }
}

// ── Leftover text — whatever no structured parser consumed ─────────────────

// ROUTE/SEQUENCE/AUTOMATION all get merged into a canonical file (myRoutes.h/mySequences.h/
// myAutomations.h) — a body scan started at any one of them must stop at any of the other two's
// own header, the same way scanBlockBody stops a live-editor parse at the next block's header.
const MERGEABLE_BLOCK_HEADER_RE = /^\s*(?:ROUTE|SEQUENCE|AUTOMATION)\s*\(/
const BLOCK_TERMINATOR_RE = /^\s*(?:DONE|RETURN)\s*$/
// Lenient — a macro-name-only check, not full argument validation. ROSTER/TURNOUT get precise
// invalid-line exclusion below (the app already has that machinery); ALIAS/SENSOR/JMRI_SENSOR/
// SIGNAL/DCC_SIGNAL have no per-line validity check anywhere in the app today, so a malformed
// line there already produces no structured entry with no feedback under normal single-file
// editing — this is no worse than that existing baseline, not a new regression. HAL is handled
// separately below (it alone has a real ambiguity-driven skip case worth being precise about).
const SINGLE_LINE_DECL_RE = /^\s*(?:ALIAS|ROSTER|TURNOUTL|SERVO_TURNOUT|PIN_TURNOUT|VIRTUAL_TURNOUT|TURNOUT|JMRI_SENSOR|SENSOR|DCC_SIGNAL|SIGNAL)\s*\(/
// A hand-rolled project's own myAutomation.h is typically just `AUTOSTART` plus `#include`
// lines wiring its other files together — the exact thing this app generates and manages
// itself. Its #include lines aren't just unneeded after import, they're actively wrong to
// preserve: they'd point at old filenames whose content has now been merged elsewhere and no
// longer exist, breaking compilation if left as leftover text that still gets #include'd.
const INCLUDE_LINE_RE = /^\s*#include\s*"/

/**
 * Computes what's left of one old file after every structured parser has taken what it
 * recognizes. `resolvedLines`/`originalLines` must correspond 1:1 (see
 * `substituteAliasNames`'s doc comment) — matching is done against the resolved (numeric-id)
 * text, since that's what every parser actually requires, but the returned text is built from
 * the original lines so a human reading the leftover file still sees the alias names they wrote.
 */
function computeLeftover(originalContent: string, resolvedContent: string): string {
    const originalLines = originalContent.split('\n')
    const resolvedLines = resolvedContent.split('\n')
    const consumed = new Array<boolean>(resolvedLines.length).fill(false)

    // Multi-line blocks first — same DONE/RETURN-or-next-header rule as scanBlockBody.
    let i = 0
    while (i < resolvedLines.length) {
        if (MERGEABLE_BLOCK_HEADER_RE.test(resolvedLines[i])) {
            let j = i
            consumed[j] = true
            j++
            while (j < resolvedLines.length && !BLOCK_TERMINATOR_RE.test(resolvedLines[j]) && !MERGEABLE_BLOCK_HEADER_RE.test(resolvedLines[j])) {
                consumed[j] = true
                j++
            }
            if (j < resolvedLines.length && BLOCK_TERMINATOR_RE.test(resolvedLines[j])) {
                consumed[j] = true
                j++
            }
            i = j
            continue
        }
        i++
    }

    // HAL — precise, mirroring parseHalDevicesFromAutomation's own 3-pass logic exactly, so an
    // ambiguous/unresolved bare HAL(...) line is correctly left as leftover instead of silently
    // eaten. HAL_IGNORE_DEFAULTS always stays leftover too — nothing in this app ever re-emits
    // it, and dropping it would silently change which sensors/HAL devices DCC-EX auto-registers.
    for (let li = 0; li < resolvedLines.length; li++) {
        if (consumed[li]) continue
        const trimmed = resolvedLines[li].trim()
        if (HAL_MUX_COMMENT_RE.test(trimmed)) {
            consumed[li] = true
            continue
        }
        if (HAL_DEVICE_COMMENT_RE.test(trimmed)) {
            consumed[li] = true
            const next = resolvedLines[li + 1]?.trim()
            if (next && HAL_LINE_RE.test(next)) consumed[li + 1] = true
            continue
        }
        const hm = HAL_LINE_RE.exec(trimmed)
        if (hm) {
            const prevTrimmed = resolvedLines[li - 1]?.trim()
            if (prevTrimmed && HAL_DEVICE_COMMENT_RE.test(prevTrimmed)) continue // handled as the pair above
            if (hasUniqueHalCandidate(hm[1], parseInt(hm[3], 10))) consumed[li] = true
        }
    }

    // ROSTER/TURNOUT — use the app's own invalid-line detection so a malformed line (already
    // surfaced today via a "// [INVALID]" comment on load) is correctly left as leftover.
    const invalidLines = new Set<string>([
        ...commentInvalidRosterLines(resolvedContent).invalidLines.map(l => l.trim()),
        ...commentInvalidTurnoutLines(resolvedContent).invalidLines.map(l => l.trim()),
    ])

    for (let li = 0; li < resolvedLines.length; li++) {
        if (consumed[li]) continue
        const trimmed = resolvedLines[li].trim()
        if (invalidLines.has(trimmed)) continue
        if (INCLUDE_LINE_RE.test(resolvedLines[li])) {
            consumed[li] = true
            continue
        }
        if (SINGLE_LINE_DECL_RE.test(resolvedLines[li])) consumed[li] = true
    }

    return originalLines.filter((_, idx) => !consumed[idx]).join('\n').trim()
}

/** True when `content` has nothing left but blank lines, comments, or a lone `AUTOSTART` (the
 *  harmless remainder of a myAutomation.h whose #include lines were already discarded above) —
 *  nothing worth keeping a file around for. */
function isEffectivelyEmpty(content: string): boolean {
    return content.split('\n').every(l => {
        const t = l.trim()
        return t === '' || t === 'AUTOSTART' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/')
    })
}

/** This app's own canonical output filenames — a leftover file must never collide with one of
 *  these (a hand-rolled project's own `config.h`/`myAutomation.h` are the common real cases). */
const CANONICAL_OUTPUT_NAMES: ReadonlySet<string> = new Set([
    'config.h', 'myConfig.h', 'myRoster.h', 'myTurnouts.h', 'mySignals.h', 'mySensors.h',
    'myRoutes.h', 'myAutomations.h', 'mySequences.h', 'myEvents.h', 'myAliases.h', 'myAutomation.h', 'myStartup.h',
])

/** Appends `_imported` before the extension if `name` collides with one of this app's own
 *  canonical output filenames, so a leftover file never overwrites/duplicates one of those. */
function avoidCanonicalNameCollision(name: string): string {
    if (!CANONICAL_OUTPUT_NAMES.has(name)) return name
    const dot = name.lastIndexOf('.')
    return dot === -1 ? `${name}_imported` : `${name.slice(0, dot)}_imported${name.slice(dot)}`
}

// ── Orchestration ────────────────────────────────────────────────────────────

function mergeByKey<T>(
    kind: ImportConflict['kind'],
    target: T[],
    seen: Map<number, string>,
    entries: readonly T[],
    fileName: string,
    keyOf: (t: T) => number,
    conflicts: ImportConflict[],
): void {
    for (const entry of entries) {
        const key = keyOf(entry)
        const owner = seen.get(key)
        if (owner !== undefined && owner !== fileName) {
            conflicts.push({ kind, id: key, files: [owner, fileName] })
            continue // first-seen entry wins; the conflict is still reported, nothing silently overwritten
        }
        if (owner === undefined) {
            seen.set(key, fileName)
            target.push(entry)
        }
    }
}

export function importExistingProject(files: readonly ImportFile[]): ImportResult {
    // Step 0 — resolve ALIAS-named ids to their numeric value everywhere.
    const aliasOccurrences = collectAliasOccurrences(files)
    const aliasValues = new Map<string, string>()
    for (const [name, occurrences] of aliasOccurrences) {
        aliasValues.set(name, occurrences[0].value) // first-declared value; conflicts are still classified below
    }
    const resolvedFiles = files.map(f => ({ name: f.name, content: substituteAliasNames(f.content, aliasValues) }))

    // Step 1 — merge every structured collection across all files, tracking id conflicts.
    const roster: Roster[] = []
    const turnouts: Turnout[] = []
    const sensors: SensorEntry[] = []
    const signals: SignalEntry[] = []
    const routes: RouteEntry[] = []
    const sequences: SequenceEntry[] = []
    const automations: AutomationEntry[] = []
    const eventHandlers: EventHandlerEntry[] = []
    const halDevices: HalDeviceInstance[] = []
    const conflicts: ImportConflict[] = []

    const rosterSeen = new Map<number, string>()
    const turnoutSeen = new Map<number, string>()
    const sensorSeen = new Map<number, string>()
    const signalSeen = new Map<number, string>()
    const routeSeen = new Map<number, string>()
    const sequenceSeen = new Map<number, string>()
    const automationSeen = new Map<number, string>()
    const halSeen = new Map<number, string>() // keyed by vpinStart (devices) or -address (multiplexers, negative to not collide with real vpins)
    // Files that structurally contained at least one recognized declaration — distinguishes
    // "nothing here migrated at all" (fully-leftover) from "some of this migrated" (partial).
    const contributingFiles = new Set<string>()

    for (const f of resolvedFiles) {
        const rosterEntries = parseRosterFromFile(f.content)
        const turnoutEntries = parseTurnoutFromFile(f.content)
        const sensorEntries = parseSensorsFromFile(f.content)
        const signalEntries = parseSignalsFromFile(f.content)
        const routeEntries = parseRoutesFromFile(f.content)
        const sequenceEntries = parseSequencesFromFile(f.content)
        const automationEntries = parseAutomationsFromFile(f.content)
        const eventEntries = parseEventHandlersFromFile(f.content)
        const halEntries = parseHalDevicesFromAutomation(f.content)

        mergeByKey('Roster', roster, rosterSeen, rosterEntries, f.name, r => r.dccAddress, conflicts)
        mergeByKey('Turnout', turnouts, turnoutSeen, turnoutEntries, f.name, t => t.id, conflicts)
        mergeByKey('Sensor', sensors, sensorSeen, sensorEntries, f.name, s => s.id, conflicts)
        mergeByKey('Signal', signals, signalSeen, signalEntries, f.name, s => (s.type === 'DCC' ? s.id : s.red), conflicts)
        mergeByKey('Route', routes, routeSeen, routeEntries, f.name, r => r.id, conflicts)
        mergeByKey('Sequence', sequences, sequenceSeen, sequenceEntries, f.name, s => s.id, conflicts)
        mergeByKey('Automation', automations, automationSeen, automationEntries, f.name, a => a.id, conflicts)
        eventHandlers.push(...eventEntries)
        for (const d of halEntries) {
            const key = d.vpinStart ?? -d.address
            const owner = halSeen.get(key)
            if (owner !== undefined && owner !== f.name) continue // same collision policy as mergeByKey, no dedicated ImportConflict kind for HAL
            if (owner === undefined) {
                halSeen.set(key, f.name)
                halDevices.push(d)
            }
        }

        if (
            rosterEntries.length > 0 || turnoutEntries.length > 0 || sensorEntries.length > 0 ||
            signalEntries.length > 0 || routeEntries.length > 0 || sequenceEntries.length > 0 ||
            automationEntries.length > 0 || eventEntries.length > 0 || halEntries.length > 0
        ) {
            contributingFiles.add(f.name)
        }
    }
    for (const occurrences of aliasOccurrences.values()) {
        for (const o of occurrences) contributingFiles.add(o.file)
    }

    // Step 2 — classify every alias by usage context, combined with the value-match heuristic.
    const usageRoles = scanUsageRoles(files)
    const objectIds: ObjectIdCollections = { roster, turnouts, sensors, routes, sequences, automations }
    const aliasReview: AliasReviewItem[] = []
    const aliasEntries: AliasEntry[] = []
    for (const [name, occurrences] of aliasOccurrences) {
        const roles = usageRoles.get(name) ?? new Set<UsageRole>()
        const { suggestedType, questionable, reason } = classifyAlias(name, occurrences, roles, objectIds)
        aliasEntries.push({ name, value: occurrences[0].value, aliasType: questionable ? undefined : suggestedType })
        if (questionable) {
            const distinctValues = Array.from(new Set(occurrences.map(o => o.value)))
            aliasReview.push({
                name,
                reason: reason ?? 'Needs manual review.',
                values: distinctValues.map(value => ({ value, files: occurrences.filter(o => o.value === value).map(o => o.file) })),
                observedRoles: Array.from(roles),
                suggestedType,
            })
        }
    }

    // Step 3 — leftover text per old file, and this file's overall status. config.h/myConfig.h
    // is carried straight through as its own explicit entry in Step 4 — it was never a
    // candidate for structured parsing in the first place, so it's excluded here rather than
    // having its entire content misclassified as "leftover" and colliding with that entry.
    const fileReports: ImportFileReport[] = []
    const leftoverFiles: ImportFile[] = []
    for (let idx = 0; idx < files.length; idx++) {
        if (files[idx].name === 'config.h' || files[idx].name === 'myConfig.h') {
            fileReports.push({ originalName: files[idx].name, status: 'fully-migrated' })
            continue
        }
        const leftover = computeLeftover(files[idx].content, resolvedFiles[idx].content)
        if (isEffectivelyEmpty(leftover)) {
            fileReports.push({ originalName: files[idx].name, status: 'fully-migrated' })
            continue
        }
        const leftoverName = avoidCanonicalNameCollision(files[idx].name)
        const header = `// Auto-extracted during project import from "${files[idx].name}" — content this app doesn't have a structured editor for (see the import summary for why).\n\n`
        leftoverFiles.push({ name: leftoverName, content: header + leftover })
        fileReports.push({
            originalName: files[idx].name,
            status: contributingFiles.has(files[idx].name) ? 'partial-leftover' : 'fully-leftover',
            leftoverFileName: leftoverName,
        })
    }

    // Step 4 — assemble the canonical files, macro-bearing leftover files first (their #define
    // lines must be #include'd before anything that expands them — see ordering note above).
    const configFiles: ImportFile[] = []
    const macroLeftovers = leftoverFiles.filter(f => /^\s*#define\b/m.test(f.content))
    const otherLeftovers = leftoverFiles.filter(f => !/^\s*#define\b/m.test(f.content))
    configFiles.push(...macroLeftovers, ...otherLeftovers)

    configFiles.push({ name: 'myRoster.h', content: serializeRosterToFile(roster) })
    configFiles.push({ name: 'myTurnouts.h', content: serializeTurnoutToFile(turnouts) })
    configFiles.push({ name: 'mySensors.h', content: serializeSensorsToFile(sensors) })
    configFiles.push({ name: 'mySignals.h', content: serializeSignalsToFile(signals) })
    configFiles.push({ name: 'myRoutes.h', content: serializeRoutesToFile(routes) })
    configFiles.push({ name: 'myAutomations.h', content: serializeAutomationsToFile(automations) })
    configFiles.push({ name: 'mySequences.h', content: serializeSequencesToFile(sequences) })
    configFiles.push({ name: 'myEvents.h', content: serializeEventHandlersToFile(eventHandlers) })
    configFiles.push({ name: 'myAliases.h', content: serializeAliasesToFile(aliasEntries) })

    if (halDevices.length > 0) {
        configFiles.push(buildHalDevicesFile(halDevices))
    }

    const configH = files.find(f => f.name === 'config.h' || f.name === 'myConfig.h')
    if (configH) configFiles.push({ name: 'config.h', content: configH.content })

    return { configFiles, fileReports, aliasReview, conflicts, halDevices }
}
