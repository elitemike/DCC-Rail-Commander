/**
 * Parser and serializer for DCC-EX automation files (myRoster.h, myTurnouts.h, myAutomation.h).
 * Ported from https://github.com/elitemike/dcc-ex_ui — pure TypeScript, no framework dependency.
 */

export interface RosterFunction {
    name: string;
    isMomentary: boolean;
    noFunction: boolean;
}

export interface Roster {
    dccAddress: number;
    name: string;
    functions: RosterFunction[];
    comment: string;
    functionMacro?: string;
    /** Friendly name from `// friendlyName: "..."` at the end of the #define line. */
    defineFriendlyName?: string;
    /** Custom functions appended to a group via preprocessor string concatenation (e.g., COMMON "/EXTRA"). */
    appendedFunctions?: RosterFunction[];
}

/** A #define group derived from the roster — one per unique `functionMacro` value. */
export interface DefineGroup {
    macroName: string;
    functions: RosterFunction[];
    friendlyName?: string;
    /** Indices into the roster array for every entry that uses this macro. */
    rosterIndices: number[];
}

export function getRealFunctions(roster: Roster): RosterFunction[] {
    return roster.functions.filter(f => !f.noFunction);
}

/**
 * Derives #define groups and ungrouped indices from the roster array.
 * Groups are entries that share the same `functionMacro` value.
 * Ungrouped are entries with no `functionMacro`.
 */
export function deriveDefineGroups(roster: Roster[]): { groups: DefineGroup[]; ungrouped: number[] } {
    const groupMap = new Map<string, DefineGroup>()
    const ungrouped: number[] = []

    for (let i = 0; i < roster.length; i++) {
        const entry = roster[i]
        if (entry.functionMacro) {
            if (!groupMap.has(entry.functionMacro)) {
                groupMap.set(entry.functionMacro, {
                    macroName: entry.functionMacro,
                    functions: entry.functions.map(f => ({ ...f })),
                    friendlyName: entry.defineFriendlyName,
                    rosterIndices: [],
                })
            }
            groupMap.get(entry.functionMacro)!.rosterIndices.push(i)
        } else {
            ungrouped.push(i)
        }
    }

    return { groups: Array.from(groupMap.values()), ungrouped }
}

export type TurnoutProfile = 'Instant' | 'Fast' | 'Medium' | 'Slow' | 'Bounce';
export type TurnoutType = 'SERVO' | 'DCC' | 'PIN';
export type TurnoutDefaultState = 'NORMAL' | 'THROWN';

interface TurnoutBase { id: number; description: string; comment?: string; defaultState: TurnoutDefaultState; }

/** SERVO_TURNOUT(id, pin, activeAngle, inactiveAngle, profile[, "desc"]) */
export interface ServoTurnout extends TurnoutBase {
    type: 'SERVO';
    pin: number;
    activeAngle: number;
    inactiveAngle: number;
    profile: TurnoutProfile;
}

/** TURNOUT(id, addr, subAddr[, "desc"]) — DCC accessory decoder */
export interface DccTurnout extends TurnoutBase {
    type: 'DCC';
    addr: number;
    subAddr: number;
}

/** PIN_TURNOUT(id, pin[, "desc"]) — GPIO pin-driven */
export interface PinTurnout extends TurnoutBase {
    type: 'PIN';
    pin: number;
}

export type Turnout = ServoTurnout | DccTurnout | PinTurnout;

export interface AutomationData {
    roster: Roster[];
    turnouts: Turnout[];
    preservedContent: string;
}

// ─── Sensors, Signals, Routes, Sequences, Aliases parsing ───────────────

export interface SensorEntry {
    id: number;
    pin: number;
    description: string;
}

export interface SignalEntry {
    red: number;
    amber: number;
    green: number;
    description?: string;
}

export interface RouteEntry {
    id: number;
    description: string;
    body: string; // raw body between ROUTE(...) and DONE
}

export interface SequenceEntry {
    id: number;
    body: string; // raw body between SEQUENCE(...) and DONE
}

export interface AliasEntry {
    name: string;
    value: string;
    aliasType?: AliasTargetType;
}

export type AliasTargetType = 'Roster' | 'Turnout' | 'Sensor' | 'Route' | 'Sequence';

export interface ObjectIdReference {
    type: AliasTargetType;
    id: number;
    label: string;
}

export interface ObjectIdCollections {
    roster: Roster[];
    turnouts: Turnout[];
    sensors?: SensorEntry[];
    routes?: RouteEntry[];
    sequences?: SequenceEntry[];
}

const VALID_ALIAS_TYPES = new Set<AliasTargetType>(['Roster', 'Turnout', 'Sensor', 'Route', 'Sequence']);

export function parseAliasTypeComment(comment: string | undefined): AliasTargetType | undefined {
    if (!comment) return undefined;
    const match = comment.match(/\btype:\s*(Roster|Turnout|Sensor|Route|Sequence)\b/i);
    if (!match) return undefined;

    const normalized = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    return VALID_ALIAS_TYPES.has(normalized as AliasTargetType) ? normalized as AliasTargetType : undefined;
}

export function parseAliasNumericValue(value: string): number | null {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

export function getPrimaryAliasForId(aliases: AliasEntry[], id: number): AliasEntry | undefined {
    return aliases.find(alias => parseAliasNumericValue(alias.value) === id);
}

export function collectObjectIdReferences(id: number, data: ObjectIdCollections): ObjectIdReference[] {
    const references: ObjectIdReference[] = [];

    for (const entry of data.roster) {
        if (entry.dccAddress === id) references.push({ type: 'Roster', id, label: entry.name || `Roster ${id}` });
    }
    for (const entry of data.turnouts) {
        if (entry.id === id) references.push({ type: 'Turnout', id, label: entry.description || `Turnout ${id}` });
    }
    for (const entry of data.sensors ?? []) {
        if (entry.id === id) references.push({ type: 'Sensor', id, label: entry.description || `Sensor ${id}` });
    }
    for (const entry of data.routes ?? []) {
        if (entry.id === id) references.push({ type: 'Route', id, label: entry.description || `Route ${id}` });
    }
    for (const entry of data.sequences ?? []) {
        if (entry.id === id) references.push({ type: 'Sequence', id, label: `Sequence ${id}` });
    }

    return references;
}

export function inferAliasTypes(alias: AliasEntry, data: ObjectIdCollections): AliasTargetType[] {
    const numericValue = parseAliasNumericValue(alias.value);
    if (numericValue === null) return [];

    return Array.from(new Set(collectObjectIdReferences(numericValue, data).map(reference => reference.type)));
}

export function parseSensorsFromFile(fileContent: string): SensorEntry[] {
    const uncommented = fileContent
        .split('\n')
        .map(l => (l.trimStart().startsWith('//') ? '' : l))
        .join('\n');
    const sensorRe = /SENSOR\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*\)(?:\s*\/\/\s*(.*))?/g;
    const out: SensorEntry[] = [];
    let m: RegExpExecArray | null;
    while ((m = sensorRe.exec(uncommented)) !== null) {
        out.push({ id: parseInt(m[1], 10), pin: parseInt(m[2], 10), description: m[3] });
    }
    return out;
}

export function serializeSensorsToFile(sensors: SensorEntry[]): string {
    return sensors.map(s => `SENSOR(${s.id}, ${s.pin}, "${s.description}")`).join('\n');
}

export function parseSignalsFromFile(fileContent: string): SignalEntry[] {
    const uncommented = fileContent
        .split('\n')
        .map(l => (l.trimStart().startsWith('//') ? '' : l))
        .join('\n');
    const sigRe = /SIGNAL\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)(?:\s*\/\/\s*(.*))?/g;
    const out: SignalEntry[] = [];
    let m: RegExpExecArray | null;
    while ((m = sigRe.exec(uncommented)) !== null) {
        out.push({ red: parseInt(m[1], 10), amber: parseInt(m[2], 10), green: parseInt(m[3], 10), description: m[4] || '' });
    }
    return out;
}

export function serializeSignalsToFile(signals: SignalEntry[]): string {
    return signals.map(s => `SIGNAL(${s.red}, ${s.amber}, ${s.green})`).join('\n');
}

export function parseRoutesFromFile(fileContent: string): RouteEntry[] {
    const lines = fileContent.split('\n');
    const out: RouteEntry[] = [];
    const routeStart = /^ROUTE\s*\(\s*(\d+)\s*,\s*"([^"]*)"\s*\)\s*$/;
    let i = 0;
    while (i < lines.length) {
        const m = lines[i].match(routeStart);
        if (m) {
            const id = parseInt(m[1], 10);
            const desc = m[2];
            const bodyLines: string[] = [];
            i++;
            while (i < lines.length && !/^DONE\s*$/.test(lines[i])) {
                bodyLines.push(lines[i]);
                i++;
            }
            // skip DONE
            i++;
            out.push({ id, description: desc, body: bodyLines.join('\n') });
            continue;
        }
        i++;
    }
    return out;
}

export function serializeRoutesToFile(routes: RouteEntry[]): string {
    const lines: string[] = [];
    for (const r of routes) {
        lines.push(`ROUTE(${r.id}, "${r.description}")`);
        if (r.body && r.body.trim()) lines.push(r.body);
        lines.push('DONE');
        lines.push('');
    }
    return lines.join('\n').trim();
}

export function parseSequencesFromFile(fileContent: string): SequenceEntry[] {
    const lines = fileContent.split('\n');
    const out: SequenceEntry[] = [];
    const seqStart = /^SEQUENCE\s*\(\s*(\d+)\s*\)\s*$/;
    let i = 0;
    while (i < lines.length) {
        const m = lines[i].match(seqStart);
        if (m) {
            const id = parseInt(m[1], 10);
            const bodyLines: string[] = [];
            i++;
            while (i < lines.length && !/^DONE\s*$/.test(lines[i])) {
                bodyLines.push(lines[i]);
                i++;
            }
            i++; // skip DONE
            out.push({ id, body: bodyLines.join('\n') });
            continue;
        }
        i++;
    }
    return out;
}

export function serializeSequencesToFile(seqs: SequenceEntry[]): string {
    const lines: string[] = [];
    for (const s of seqs) {
        lines.push(`SEQUENCE(${s.id})`);
        if (s.body && s.body.trim()) lines.push(s.body);
        lines.push('DONE');
        lines.push('');
    }
    return lines.join('\n').trim();
}

export function parseAliasesFromFile(fileContent: string): AliasEntry[] {
    const uncommented = fileContent
        .split('\n')
        .map(l => (l.trimStart().startsWith('//') ? '' : l))
        .join('\n');
    const defRe = /^\s*#define\s+(\w+)\s+"?([^\"]*)"?\s*(?:\/\/\s*(.*))?$/gm;
    const out: AliasEntry[] = [];
    let m: RegExpExecArray | null;
    while ((m = defRe.exec(uncommented)) !== null) {
        out.push({ name: m[1], value: m[2], aliasType: parseAliasTypeComment(m[3]) });
    }
    return out;
}

export function serializeAliasesToFile(aliases: AliasEntry[]): string {
    return aliases.map(a => {
        let line = `#define ${a.name} "${a.value}"`;
        if (a.aliasType) line += ` // type: ${a.aliasType}`;
        return line;
    }).join('\n');
}

// ─── Roster parsing ─────────────────────────────────────────────────────────

function parseFunction(str: string): RosterFunction {
    if (str.startsWith('*')) {
        const name = str.slice(1);
        return { name, isMomentary: true, noFunction: name === '' };
    }
    return { name: str, isMomentary: false, noFunction: str === '' };
}

export function serializeFunction(f: RosterFunction): string {
    if (f.noFunction) return f.isMomentary ? '*' : '';
    return f.isMomentary ? `*${f.name}` : f.name;
}

export function sanitizeMacroName(name: string): string {
    return name.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') + '_F';
}

/**
 * Scans raw roster text and comments out any lines that look like ROSTER(...)
 * calls but fail to parse as valid entries. Returns the modified text and the
 * list of original invalid line strings so callers can surface a warning.
 */
export function commentInvalidRosterLines(text: string): { processedText: string; invalidLines: string[] } {
    // Full-match pattern for a valid ROSTER call.
    // Accepts three formats for the function list:
    // 1. A bare identifier: MOTOR_FN
    // 2. A quoted string: "LIGHT/HORN"
    // 3. A macro with appended functions: MACRO_NAME "/suffix"
    const validRegex = /^\s*ROSTER\s*\(\s*\d+\s*,\s*"[^"]*"\s*,\s*(?:[A-Za-z0-9_]+(?:\s+"[^"]*")?|"[^"]*")\s*\)(?:\s*\/\/.*)?$/;
    // Looser pattern: any line that contains a ROSTER( token (catches malformed calls).
    const rosterAttemptRegex = /\bROSTER\s*\(/;

    const invalidLines: string[] = [];
    const processedLines = text.split('\n').map(line => {
        const trimmed = line.trimStart();
        // Already a comment — leave it alone.
        if (trimmed.startsWith('//')) return line;
        if (rosterAttemptRegex.test(line) && !validRegex.test(line)) {
            invalidLines.push(line);
            return `// [INVALID] ${line}`;
        }
        return line;
    });

    return { processedText: processedLines.join('\n'), invalidLines };
}

export function parseRosterFromFile(fileContent: string): Roster[] {
    // Strip comment lines so that // [INVALID] ROSTER(...) entries are ignored.
    const uncommentedContent = fileContent
        .split('\n')
        .map(line => (line.trimStart().startsWith('//') ? '' : line))
        .join('\n');

    // Parse #define macros for function lists (with optional // friendlyName: "...")
    const defineRegex = /^\s*#define\s+(\w+)\s+"([^"]*)"(?:\s*\/\/\s*friendlyName:\s*"([^"]*)")?/gm;
    const macroMap: Record<string, string> = {};
    const friendlyNameMap: Record<string, string> = {};
    let defMatch: RegExpExecArray | null;
    while ((defMatch = defineRegex.exec(uncommentedContent)) !== null) {
        macroMap[defMatch[1]] = defMatch[2];
        if (defMatch[3] !== undefined) friendlyNameMap[defMatch[1]] = defMatch[3];
    }

    const rosterRegex = /ROSTER\s*\(\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*([A-Za-z0-9_]+(?:\s+"[^"]*")?|"[^"]*")\s*\)(?:\s*\/\/\s*(.*))?/g;
    const entries: Roster[] = [];
    let match: RegExpExecArray | null;

    while ((match = rosterRegex.exec(uncommentedContent)) !== null) {
        const dccAddress = parseInt(match[1], 10);
        const name = match[2];
        let functionsArg = match[3];
        const comment = match[4] ? match[4].trim() : '';
        let functionMacro: string | undefined;
        let appendedFunctions: RosterFunction[] | undefined;

        // Check if this is a macro reference (possibly with appended functions)
        if (!functionsArg.startsWith('"')) {
            // Either "MACRO" or "MACRO \"/suffix\""
            const macroMatch = functionsArg.match(/^([A-Za-z0-9_]+)(?:\s+"([^"]*)")?$/);
            if (macroMatch) {
                functionMacro = macroMatch[1];
                const baseFunctions = macroMap[functionMacro] || '';

                // If there's an appended suffix, concatenate it (C preprocessor behavior)
                let allParts: string[] = []
                const baseParts = baseFunctions === '' ? [] : baseFunctions.split('/')
                if (macroMatch[2]) {
                    const suffix = macroMatch[2]
                    // Suffix text typically starts with a leading slash ("/EXTRA").
                    // Remove a single leading slash to avoid producing an initial empty
                    // token, but preserve interior empty tokens ("///").
                    const normalizedSuffix = suffix.startsWith('/') ? suffix.slice(1) : suffix
                    const suffixParts = normalizedSuffix.split('/')
                    allParts = baseParts.concat(suffixParts)

                    // appendedFunctions should reflect only the suffix portion (after
                    // removing the leading slash). Preserve empty tokens within the
                    // suffix so alignment is maintained.
                    appendedFunctions = suffixParts.map(parseFunction)
                } else {
                    allParts = baseParts
                }

                entries.push({
                    dccAddress,
                    name,
                    functions: allParts.map(parseFunction),
                    comment,
                    functionMacro,
                    defineFriendlyName: functionMacro ? friendlyNameMap[functionMacro] : undefined,
                    appendedFunctions,
                });
            }
        } else {
            // Quoted string (inline functions)
            const functionsString = functionsArg.slice(1, -1);
            entries.push({
                dccAddress,
                name,
                // Preserve empty tokens ("//", "///") so function indexes remain
                // aligned with their slash positions.
                functions: functionsString.split('/').map(parseFunction),
                comment,
                functionMacro: undefined,
                defineFriendlyName: undefined,
            });
        }
    }

    return entries;
}

export function serializeRosterToFile(roster: Roster[]): string {
    const lines: string[] = [];

    // ── 1. Collect user-assigned macros (preserve name + friendly name) ──────
    // Map<macroName, { funcString, friendlyName }>
    const userMacros = new Map<string, { funcString: string; friendlyName?: string }>()
    for (const entry of roster) {
        if (entry.functionMacro && !userMacros.has(entry.functionMacro)) {
            // If this entry has appended functions, exclude them from the macro definition
            let baseFunctions = entry.functions
            if (entry.appendedFunctions && entry.appendedFunctions.length > 0) {
                baseFunctions = entry.functions.slice(0, entry.functions.length - entry.appendedFunctions.length)
            }
            userMacros.set(entry.functionMacro, {
                funcString: baseFunctions.map(serializeFunction).join('/'),
                friendlyName: entry.defineFriendlyName,
            })
        }
    }

    // ── 2. Auto-group inline entries with identical function strings (2+) ────
    const inlineGroups = new Map<string, Roster[]>()
    for (const entry of roster) {
        if (!entry.functionMacro) {
            const fs = entry.functions.map(serializeFunction).join('/')
            if (!inlineGroups.has(fs)) inlineGroups.set(fs, [])
            inlineGroups.get(fs)!.push(entry)
        }
    }

    const autoMacros = new Map<string, string>() // funcString -> macroName
    const usedMacros = new Set(userMacros.keys())
    for (const [fs, entries] of inlineGroups) {
        if (entries.length > 1) {
            let base = sanitizeMacroName(entries[0].name)
            let macroName = base
            let counter = 1
            while (usedMacros.has(macroName)) macroName = `${base}_${counter++}`
            usedMacros.add(macroName)
            autoMacros.set(fs, macroName)
            userMacros.set(macroName, { funcString: fs })
        }
    }

    // ── 3. Emit #define lines ────────────────────────────────────────────────
    for (const [macroName, { funcString, friendlyName }] of userMacros) {
        let defineLine = `#define ${macroName} "${funcString}"`
        if (friendlyName) defineLine += ` // friendlyName: "${friendlyName}"`
        lines.push(defineLine)
    }
    if (userMacros.size > 0) lines.push('')

    // ── 4. Emit ROSTER lines ─────────────────────────────────────────────────
    for (const entry of roster) {
        const fs = entry.functions.map(serializeFunction).join('/')

        let funcField: string;
        if (entry.functionMacro && entry.appendedFunctions && entry.appendedFunctions.length > 0) {
            // Has both macro reference and appended functions
            const appendedString = entry.appendedFunctions.map(serializeFunction).join('/')
            funcField = `${entry.functionMacro} "/${appendedString}"`
        } else if (entry.functionMacro) {
            // Macro reference only
            funcField = entry.functionMacro
        } else {
            // Inline functions
            const macroName = autoMacros.get(fs)
            funcField = macroName ? macroName : `"${fs}"`
        }

        let line = `ROSTER(${entry.dccAddress}, "${entry.name}", ${funcField})`
        if (entry.comment) line += ` // ${entry.comment}`
        lines.push(line)
    }

    return lines.join('\n')
}

// ─── Turnout parsing ─────────────────────────────────────────────────────────

const VALID_TURNOUT_PROFILES: readonly TurnoutProfile[] = ['Instant', 'Fast', 'Medium', 'Slow', 'Bounce'];

/**
 * Scans raw turnout text and comments out any lines that look like
 * SERVO_TURNOUT(...) calls but fail to parse as valid entries. Returns the
 * modified text and the list of original invalid line strings.
 */
export function commentInvalidTurnoutLines(text: string): { processedText: string; invalidLines: string[] } {
    // Valid-pattern regexes — a structurally correct line is left alone;
    // the Monaco validator handles individual argument errors via squiggles.
    const validServo = /^\s*SERVO_TURNOUT\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\w+\s*(?:,\s*"[^"]*")?\s*\)(?:\s*\/\/.*)?$/;
    const validDcc = /^\s*TURNOUT\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*"[^"]*")?\s*\)(?:\s*\/\/.*)?$/;
    const validPin = /^\s*PIN_TURNOUT\s*\(\s*\d+\s*,\s*\d+\s*(?:,\s*"[^"]*")?\s*\)(?:\s*\/\/.*)?$/;

    const invalidLines: string[] = [];
    const processedLines = text.split('\n').map(line => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//')) return line;

        if (/\bSERVO_TURNOUT\s*\(/.test(line)) {
            if (!validServo.test(line)) { invalidLines.push(line); return `// [INVALID] ${line}`; }
            return line;
        }
        if (/\bPIN_TURNOUT\s*\(/.test(line)) {
            if (!validPin.test(line)) { invalidLines.push(line); return `// [INVALID] ${line}`; }
            return line;
        }
        // Plain TURNOUT — guard against matching the suffix of SERVO_/PIN_ (handled above)
        if (/(?<![A-Za-z_])TURNOUT\s*\(/.test(line)) {
            if (!validDcc.test(line)) { invalidLines.push(line); return `// [INVALID] ${line}`; }
            return line;
        }
        return line;
    });

    return { processedText: processedLines.join('\n'), invalidLines };
}

export function parseTurnoutFromFile(fileContent: string): Turnout[] {
    // Strip // [INVALID] comment lines so they are not re-parsed.
    const uncommentedContent = fileContent
        .split('\n')
        .map(line => (line.trimStart().startsWith('//') ? '' : line))
        .join('\n');

    const entries: Turnout[] = [];
    let m: RegExpExecArray | null;

    // ── SERVO_TURNOUT(id, pin, activeAngle, inactiveAngle, profile[, "desc"]) ─
    const servoRe = /SERVO_TURNOUT\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\w+)\s*(?:,\s*"([^"]*)")?\s*\)(?:\s*\/\/\s*(.*))?/g;
    while ((m = servoRe.exec(uncommentedContent)) !== null) {
        const profile = m[5] as TurnoutProfile;
        if (!VALID_TURNOUT_PROFILES.includes(profile)) {
            console.warn(`Invalid turnout profile: ${profile}, defaulting to Slow`);
        }
        entries.push({
            type: 'SERVO',
            id: parseInt(m[1], 10),
            pin: parseInt(m[2], 10),
            activeAngle: parseInt(m[3], 10),
            inactiveAngle: parseInt(m[4], 10),
            profile: VALID_TURNOUT_PROFILES.includes(profile) ? profile : 'Slow',
            description: m[6] || '',
            comment: m[7] ? m[7].trim() : '',
            defaultState: 'NORMAL',
        });
    }

    // ── TURNOUT(id, addr, subAddr[, "desc"]) — DCC accessory ─────────────────
    const dccRe = /(?<![A-Za-z_])TURNOUT\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*"([^"]*)")?\s*\)(?:\s*\/\/\s*(.*))?/g;
    while ((m = dccRe.exec(uncommentedContent)) !== null) {
        entries.push({
            type: 'DCC',
            id: parseInt(m[1], 10),
            addr: parseInt(m[2], 10),
            subAddr: parseInt(m[3], 10),
            description: m[4] || '',
            comment: m[5] ? m[5].trim() : '',
            defaultState: 'NORMAL',
        });
    }

    // ── PIN_TURNOUT(id, pin[, "desc"]) — GPIO ─────────────────────────────────
    const pinRe = /PIN_TURNOUT\s*\(\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*"([^"]*)")?\s*\)(?:\s*\/\/\s*(.*))?/g;
    while ((m = pinRe.exec(uncommentedContent)) !== null) {
        entries.push({
            type: 'PIN',
            id: parseInt(m[1], 10),
            pin: parseInt(m[2], 10),
            description: m[3] || '',
            comment: m[4] ? m[4].trim() : '',
            defaultState: 'NORMAL',
        });
    }

    return entries;
}

export function serializeTurnoutToFile(turnouts: Turnout[]): string {
    const lines: string[] = [];
    for (const t of turnouts) {
        let line: string;
        if (t.type === 'DCC') {
            line = `TURNOUT(${t.id}, ${t.addr}, ${t.subAddr}`;
            if (t.description) line += `, "${t.description}"`;
            line += ')';
        } else if (t.type === 'PIN') {
            line = `PIN_TURNOUT(${t.id}, ${t.pin}`;
            if (t.description) line += `, "${t.description}"`;
            line += ')';
        } else {
            // SERVO (default)
            line = `SERVO_TURNOUT(${t.id}, ${t.pin}, ${t.activeAngle}, ${t.inactiveAngle}, ${t.profile}`;
            if (t.description) line += `, "${t.description}"`;
            line += ')';
        }
        if (t.comment) line += ` // ${t.comment}`;
        lines.push(line);
    }
    return lines.join('\n');
}

/**
 * Extracts turnout IDs that are set to thrown at startup via AUTOSTART THROW(id)
 * statements in myAutomation.h.
 */
export function parseDefaultThrownTurnoutIdsFromAutomation(fileContent: string): Set<number> {
    const thrownIds = new Set<number>();
    const autostartRe = /AUTOSTART\s*\n([\s\S]*?)\nDONE/g;
    let blockMatch: RegExpExecArray | null;

    while ((blockMatch = autostartRe.exec(fileContent)) !== null) {
        const block = blockMatch[1] ?? '';
        const throwRe = /THROW\s*\(\s*(\d+)\s*\)/g;
        let throwMatch: RegExpExecArray | null;
        while ((throwMatch = throwRe.exec(block)) !== null) {
            thrownIds.add(parseInt(throwMatch[1], 10));
        }
    }

    return thrownIds;
}

// ─── Combined automation file ────────────────────────────────────────────────

export function parseAutomationFile(fileContent: string): AutomationData {
    const roster = parseRosterFromFile(fileContent);
    const turnouts = parseTurnoutFromFile(fileContent);

    const usedMacros = new Set<string>();
    for (const entry of roster) {
        if (entry.functionMacro) usedMacros.add(entry.functionMacro);
    }

    const lines = fileContent.split('\n');
    const preservedLines: string[] = [];
    const rosterPattern = /^\s*ROSTER\s*\(/;
    const turnoutPattern = /^\s*(?:SERVO_TURNOUT|PIN_TURNOUT|TURNOUT)\s*\(/;

    for (const line of lines) {
        if (rosterPattern.test(line) || turnoutPattern.test(line)) continue;
        const defineMatch = line.match(/^\s*#define\s+(\w+)\s+"[^"]*"/);
        if (defineMatch && usedMacros.has(defineMatch[1])) continue;
        preservedLines.push(line);
    }

    let preservedContent = preservedLines.join('\n');
    preservedContent = preservedContent.replace(/^\n+/, '').replace(/\n+$/, '');

    return { roster, turnouts, preservedContent };
}

export function serializeAutomationFile(data: AutomationData): string {
    const sections: string[] = [];

    if (data.roster.length > 0) {
        sections.push('// Roster entries');
        sections.push(serializeRosterToFile(data.roster));
    }

    if (data.turnouts.length > 0) {
        if (sections.length > 0) sections.push('');
        sections.push('// Turnout definitions');
        sections.push(serializeTurnoutToFile(data.turnouts));
    }

    if (data.preservedContent && data.preservedContent.trim()) {
        if (sections.length > 0) sections.push('');
        sections.push(data.preservedContent);
    }

    return sections.join('\n');
}

// ─── Generator header ────────────────────────────────────────────────────────

/** Marker embedded in the second line of every file generated by EX-Installer */
export const GENERATOR_HEADER_MARKER = '// DCCEX-Installer'

const GENERATOR_HEADER_RE = /^\/\/ DCCEX-Installer v([\d.]+)/m
const HEADER_BAR = '//' + ' ' + '='.repeat(77)

/**
 * Returns true if the text contains a DCCEX-Installer generator header.
 * Used to distinguish files created/managed by this tool from hand-written files.
 */
export function hasGeneratorHeader(text: string): boolean {
    return GENERATOR_HEADER_RE.test(text)
}

/**
 * Extracts the installer version string from the header, or null if no header
 * is present.
 */
export function getGeneratorVersion(text: string): string | null {
    const m = GENERATOR_HEADER_RE.exec(text)
    return m ? m[1] : null
}

/**
 * Builds the multi-line comment block that is prepended to managed files on
 * every save.  The block is entirely composed of `//` comment lines so existing
 * parsers will skip it safely.
 */
export function buildGeneratorHeader(filename: string, appVersion: string): string {
    return [
        HEADER_BAR,
        `// DCCEX-Installer v${appVersion}`,
        `// This file (${filename}) is managed by EX-Installer — manual edits are preserved`,
        '// but may be reformatted on the next save. See https://dcc-ex.com for docs.',
        `// Last saved: ${new Date().toISOString()}`,
        HEADER_BAR,
    ].join('\n')
}

// ─── Demo data ───────────────────────────────────────────────────────────────

export function loadDemoRoster(): Roster[] {
    const content = `ROSTER(1,"Thomas","//Whistle/*Short Whistle/Blowdown////Mute")
ROSTER(6211, "CSX GP40 #6211", "Lights/Bell/Airhorn/Coupler/Dyn Brake/t1/t2/Squeal/Mute")
ROSTER(301, "Amtrak Charger #301", "Headlights/Bell/Horn/*Short Horn/Whoosh/Train Brake")`;
    return parseRosterFromFile(content);
}

export function loadDemoTurnouts(): Turnout[] {
    return [
        { type: 'SERVO', id: 200, pin: 101, activeAngle: 450, inactiveAngle: 110, profile: 'Slow', description: 'Example slow turnout', comment: '', defaultState: 'NORMAL' },
        { type: 'SERVO', id: 201, pin: 102, activeAngle: 400, inactiveAngle: 100, profile: 'Medium', description: 'Yard ladder switch 1', comment: 'Main yard', defaultState: 'NORMAL' },
        { type: 'SERVO', id: 202, pin: 103, activeAngle: 410, inactiveAngle: 90, profile: 'Fast', description: 'Main line crossover', comment: '', defaultState: 'NORMAL' },
    ];
}
