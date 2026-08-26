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
export type TurnoutType = 'SERVO' | 'DCC' | 'DCCL' | 'PIN' | 'VIRTUAL';
export type TurnoutDefaultState = 'CLOSED' | 'THROWN';

interface TurnoutBase { id: number; description: string; comment?: string; defaultState: TurnoutDefaultState; }

/** SERVO_TURNOUT(id, pin, activeAngle, inactiveAngle, profile[, "desc"]) */
export interface ServoTurnout extends TurnoutBase {
    type: 'SERVO';
    pin: number;
    activeAngle: number;
    inactiveAngle: number;
    profile: TurnoutProfile;
}

/** TURNOUT(id, addr, subAddr[, "desc"]) — DCC accessory decoder, legacy addr/subAddr pair */
export interface DccTurnout extends TurnoutBase {
    type: 'DCC';
    addr: number;
    subAddr: number;
}

/** TURNOUTL(id, addr[, "desc"]) — DCC accessory decoder, single linear address */
export interface DccLinearTurnout extends TurnoutBase {
    type: 'DCCL';
    addr: number;
}

/** PIN_TURNOUT(id, pin[, "desc"]) — GPIO pin-driven */
export interface PinTurnout extends TurnoutBase {
    type: 'PIN';
    pin: number;
}

/** VIRTUAL_TURNOUT(id[, "desc"]) — no hardware, driven entirely by ONCLOSE/ONTHROW handlers */
export interface VirtualTurnout extends TurnoutBase {
    type: 'VIRTUAL';
}

export type Turnout = ServoTurnout | DccTurnout | DccLinearTurnout | PinTurnout | VirtualTurnout;

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

/** SIGNAL(redPin, amberPin, greenPin) — three GPIO/HAL pins driving LEDs directly */
export interface PinSignal {
    type: 'PIN';
    red: number;
    amber: number;
    green: number;
    description?: string;
}

/** DCC_SIGNAL(id, addr, subAddr) — DCC accessory decoder-controlled signal */
export interface DccSignal {
    type: 'DCC';
    id: number;
    addr: number;
    subAddr: number;
    description?: string;
}

export type SignalEntry = PinSignal | DccSignal;

export interface RouteEntry {
    id: number;
    description: string;
    /**
     * Raw text between ROUTE(...) and the next ROUTE(...)/EOF. Includes the terminating DONE
     * line when the file has one — DONE is real, user-editable body content (rendered as an
     * ordinary block by the block canvas), not something this parser hides or re-adds on its
     * own. See serializeRoutesToFile()'s matching behavior.
     */
    body: string;
}

export interface SequenceEntry {
    id: number;
    /** Friendly name/description, stored as a trailing `// comment` on the SEQUENCE(id) line — SEQUENCE() itself has no description argument. */
    description?: string;
    /** Raw text between SEQUENCE(...) and the next SEQUENCE(...)/EOF — see RouteEntry.body. */
    body: string;
}

/**
 * AUTOMATION(id, "desc") — structurally identical to ROUTE, but there is no visual editor for
 * it; automation blocks live as free-form text inside myAutomation.h (see
 * `ConfigEditorState.preservedAutomationContent`). This parser exists purely to extract IDs for
 * `validateSequenceIds` — it is not round-tripped/serialized by the app.
 */
export interface AutomationEntry {
    id: number;
    description: string;
    /** Raw text between AUTOMATION(...) and the next ROUTE/AUTOMATION/SEQUENCE(...)/EOF — see RouteEntry.body. */
    body: string;
}

/**
 * ONSENSOR(200)/ONACTIVATE(100, 4)/ONRAILSYNCON/... — an EXRAIL event-handler block: a task entry
 * point like ROUTE/SEQUENCE, but with real typed arguments on its header line instead of an
 * id/description, and no participation in the shared ROUTE/AUTOMATION/SEQUENCE id pool. Unlike
 * RouteEntry/SequenceEntry, `text` is the *entire* on-disk block including the header line — a
 * param-flavored hat has no separate structured home for its header args (they're edited directly
 * on the hat block's own face — see exrail-block-compiler.ts's parseEventHandlerBlock()/
 * compileEventHandlerBlock()), so there's nothing to split header from body for at this layer.
 * `command` is fixed at creation (which BLOCK_REGISTRY hat this is) and is otherwise redundant
 * with `text`'s own first line — kept as its own field purely so the list editor can group/label
 * entries without re-parsing `text` on every render.
 */
export interface EventHandlerEntry {
    command: string;
    text: string;
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

/**
 * EXRAIL/macro command names — see https://dcc-ex.com/exrail/exrail-command-reference.html.
 * An alias name colliding with one of these compiles into a broken redefinition.
 */
// Every command name in exrail-block-registry.ts's BLOCK_REGISTRY, plus the object-definition
// commands that intentionally have no registry entry (TURNOUT/SIGNAL/ROSTER/HAL/ALIAS/AUTOMATION —
// see exrail-block-registry.ts's own doc comment on why those are out of scope for the block
// canvas), plus structural EXRAIL keywords (ELSE/ENDIF) and IFOCCUPIED (a real EXRAIL command with
// no registry entry). This module doesn't import the registry (kept framework/UI-free — see the
// top-of-file doc comment), so the list is transcribed here rather than derived; regenerate it by
// extracting every `id: '...'` from BLOCK_REGISTRY if the registry grows further.
const EXRAIL_RESERVED_WORDS = new Set([
    'ROUTE', 'SEQUENCE', 'THROW', 'CLOSE', 'TOGGLE_TURNOUT', 'IFCLOSED', 'IFTHROWN', 'SETLOCO',
    'FWD', 'REV', 'SPEED', 'STOP', 'ESTOP', 'FON', 'FOFF', 'XFON',
    'XFOFF', 'RED', 'AMBER', 'GREEN', 'IF', 'IFNOT', 'AT', 'AFTER',
    'AFTEROVERLOAD', 'DELAY', 'DELAYMINS', 'DONE', 'FOLLOW', 'ACTIVATE', 'ACTIVATEL', 'DEACTIVATE',
    'DEACTIVATEL', 'ASPECT', 'IFRED', 'IFAMBER', 'IFGREEN', 'WAIT_WHILE_RED', 'ATTIMEOUT', 'ATGTE',
    'ATLT', 'LATCH', 'UNLATCH', 'IF_ALL', 'IF_ANY', 'IFGTE', 'IFLT', 'IFRE',
    'IFRANDOM', 'IFTIMEOUT', 'IFBITMAP_ALL', 'IFBITMAP_ANY', 'IFLOCO', 'IFRESERVE', 'IFROUTE_ACTIVE', 'IFROUTE_INACTIVE',
    'IFROUTE_HIDDEN', 'IFROUTE_DISABLED', 'IFSTASH', 'IFSTASHED_HERE', 'IFTTPOSITION', 'SPEEDUP', 'SLOWDOWN', 'SPEED_REL',
    'ESTOPALL', 'ESTOP_PAUSE', 'ESTOP_RESUME', 'SAVE_SPEED', 'RESTORE_SPEED', 'FORGET', 'INVERT_DIRECTION', 'MOMENTUM',
    'FTOGGLE', 'XFTOGGLE', 'BUILD_CONSIST', 'BREAK_CONSIST', 'XFWD', 'XREV', 'XSAVE_SPEED', 'XRESTORE_SPEED',
    'POM', 'XPOM', 'READ_LOCO', 'CALL', 'RETURN', 'START', 'START_SHARED', 'START_SEND',
    'SENDLOCO', 'RANDOM_CALL', 'RANDOM_FOLLOW', 'AUTOSTART', 'PAUSE', 'RESUME', 'KILLALL', 'ENDTASK',
    'DELAYRANDOM', 'RESERVE', 'FREE', 'FREEALL', 'POWERON', 'POWEROFF', 'SET_TRACK', 'SET_POWER',
    'SETFREQ', 'JOIN', 'UNJOIN', 'ROUTE_ACTIVE', 'ROUTE_INACTIVE', 'ROUTE_HIDDEN', 'ROUTE_DISABLED', 'ROUTE_CAPTION',
    'ROTATE', 'ROTATE_DCC', 'MOVETT', 'WAITFORTT', 'SERVO', 'SERVO2', 'CONFIGURE_SERVO', 'FADE',
    'WAITFOR', 'SET', 'RESET', 'BLINK', 'ANOUT', 'NEOPIXEL', 'BITMAP_AND', 'BITMAP_OR',
    'BITMAP_XOR', 'BITMAP_SET', 'BITMAP_INC', 'BITMAP_DEC', 'STASH', 'PICKUP_STASH', 'CLEAR_STASH', 'CLEAR_ALL_STASH',
    'CLEAR_ANY_STASH', 'MESSAGE', 'BROADCAST', 'PRINT', 'LCD', 'SCREEN', 'SERIAL', 'SERIAL1',
    'SERIAL2', 'SERIAL3', 'SERIAL4', 'SERIAL5', 'SERIAL6', 'PARSE', 'WITHROTTLE', 'PLAY_TRACK',
    'PLAY_REPEAT', 'PLAY_FOLDER', 'PLAY_VOLUME', 'PLAY_EQ', 'PLAY_PAUSE', 'PLAY_RESUME', 'PLAY_STOP', 'PLAY_RESET',
    'LCC', 'LCCX', 'ACON', 'ACOF', 'STEALTH', 'STEALTH_GLOBAL', 'ONSENSOR', 'ONCHANGE',
    'ONBUTTON', 'ONBITMAP', 'ONBLOCKENTER', 'ONBLOCKEXIT', 'ONACTIVATE', 'ONACTIVATEL', 'ONDEACTIVATE', 'ONDEACTIVATEL',
    'ONCLOSE', 'ONTHROW', 'ONRED', 'ONAMBER', 'ONGREEN', 'ONRAILSYNCON', 'ONRAILSYNCOFF', 'ONCLOCKTIME',
    'ONCLOCKMINS', 'ONTIME', 'ONOVERLOAD', 'ONROTATE', 'ONACON', 'ONACOF', 'ONLCC', 'ALIAS',
    'ROSTER', 'SENSOR', 'SIGNAL', 'SERVO_TURNOUT', 'TURNOUT', 'PIN_TURNOUT', 'AUTOMATION', 'ELSE',
    'ENDIF', 'IFOCCUPIED',
]);

const ALIAS_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Per https://dcc-ex.com/exrail/exrail-command-reference.html#aliases — an alias name must
 * start with a letter or underscore, contain only letters/digits/underscores thereafter, and
 * must not collide with an existing EXRAIL command name.
 */
export function validateAliasName(rawName: string): { ok: true } | { ok: false; reason: string } {
    const trimmed = rawName.trim();
    if (trimmed === '') return { ok: false, reason: 'Alias name is required.' };
    if (!ALIAS_NAME_RE.test(trimmed)) {
        return {
            ok: false,
            reason: `Alias name "${trimmed}" must start with a letter or underscore and contain only letters, numbers, and underscores.`,
        };
    }
    if (EXRAIL_RESERVED_WORDS.has(trimmed.toUpperCase())) {
        return { ok: false, reason: `"${trimmed}" is a reserved EXRAIL command name and cannot be used as an alias.` };
    }
    return { ok: true };
}

/**
 * The ALIAS value must be a plain integer matching an existing Roster/Turnout/Sensor/Route/
 * Sequence ID — EX-RAIL itself allows omitting it (auto-assigning one), but this app requires
 * every alias to point at a real object so it's never left dangling.
 * A leading zero on a multi-digit value is flagged because C interprets it as octal —
 * see the "Important Restriction" note on the ALIAS command reference page.
 */
export function validateAliasValue(rawValue: string): { ok: true } | { ok: false; reason: string } {
    const trimmed = rawValue.trim();
    if (trimmed === '') return { ok: false, reason: 'Alias value is required and must match an existing object\'s ID.' };
    if (!/^\d+$/.test(trimmed)) {
        return { ok: false, reason: `Alias value "${trimmed}" must be a whole number, or left blank to auto-assign one.` };
    }
    if (trimmed.length > 1 && trimmed.startsWith('0')) {
        return {
            ok: false,
            reason: `Alias value "${trimmed}" has a leading zero, which C treats as octal — use "${Number(trimmed)}" instead.`,
        };
    }
    return { ok: true };
}

export function getPrimaryAliasForId(aliases: AliasEntry[], id: number, type?: AliasTargetType): AliasEntry | undefined {
    return aliases.find(alias => parseAliasNumericValue(alias.value) === id && (!type || alias.aliasType === type));
}

/** Reverse of getPrimaryAliasForId — resolves an alias name to its numeric target id, scoped to `type` if given (same type-scoping rule, to avoid cross-type ID bleed). */
export function getAliasIdByName(aliases: AliasEntry[], name: string, type?: AliasTargetType): number | undefined {
    const alias = aliases.find(a => a.name === name && (!type || a.aliasType === type));
    return alias ? parseAliasNumericValue(alias.value) ?? undefined : undefined;
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
        if (entry.id === id) references.push({ type: 'Sequence', id, label: entry.description || `Sequence ${id}` });
    }

    return references;
}

export function inferAliasTypes(alias: AliasEntry, data: ObjectIdCollections): AliasTargetType[] {
    const numericValue = parseAliasNumericValue(alias.value);
    if (numericValue === null) return [];

    return Array.from(new Set(collectObjectIdReferences(numericValue, data).map(reference => reference.type)));
}

/**
 * All id+label pairs for one target type — the "every id for this type" counterpart to
 * collectObjectIdReferences' "every type for this id". Used to populate the aliases editor's
 * ID picker once a target type has been chosen. The label always leads with the numeric ID
 * (what ALIAS actually stores) followed by the name/description, since either alone can be
 * ambiguous — several turnouts can share a description, and an ID alone doesn't say what it is.
 */
export function listObjectIdsForType(type: AliasTargetType, data: ObjectIdCollections): { id: number; label: string }[] {
    const idAndDescription = (id: number, description: string) => description ? `${id} - ${description}` : `${id}`;
    switch (type) {
        case 'Roster':
            return data.roster.map(r => ({ id: r.dccAddress, label: idAndDescription(r.dccAddress, r.name) }));
        case 'Turnout':
            return data.turnouts.map(t => ({ id: t.id, label: idAndDescription(t.id, t.description) }));
        case 'Sensor':
            return (data.sensors ?? []).map(s => ({ id: s.id, label: idAndDescription(s.id, s.description) }));
        case 'Route':
            return (data.routes ?? []).map(r => ({ id: r.id, label: idAndDescription(r.id, r.description) }));
        case 'Sequence':
            return (data.sequences ?? []).map(s => ({ id: s.id, label: idAndDescription(s.id, s.description ?? '') }));
    }
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

    // ── JMRI_SENSOR(vpin, count) — bulk-declares `count` sensors starting at `vpin`, each
    // addressable by its own pin number, exactly as if declared individually via
    // SENSOR(pin, pin, ""). Expanded here into individual entries rather than kept as one
    // union variant — the resulting rows are structurally identical to SENSOR-declared ones
    // (id === pin), so every existing consumer (editor, VPin allocation, validators) needs no
    // changes to handle them.
    const jmriRe = /JMRI_SENSOR\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)(?:\s*\/\/\s*(.*))?/g;
    while ((m = jmriRe.exec(uncommented)) !== null) {
        const start = parseInt(m[1], 10);
        const count = parseInt(m[2], 10);
        for (let i = 0; i < count; i++) {
            out.push({ id: start + i, pin: start + i, description: '' });
        }
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
    const sigRe = /(?<![A-Za-z_])SIGNAL\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)(?:\s*\/\/\s*(.*))?/g;
    const out: SignalEntry[] = [];
    let m: RegExpExecArray | null;
    while ((m = sigRe.exec(uncommented)) !== null) {
        out.push({ type: 'PIN', red: parseInt(m[1], 10), amber: parseInt(m[2], 10), green: parseInt(m[3], 10), description: m[4] || '' });
    }

    // ── DCC_SIGNAL(id, addr, subAddr) — DCC accessory decoder ─────────────────
    const dccSigRe = /DCC_SIGNAL\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)(?:\s*\/\/\s*(.*))?/g;
    while ((m = dccSigRe.exec(uncommented)) !== null) {
        out.push({ type: 'DCC', id: parseInt(m[1], 10), addr: parseInt(m[2], 10), subAddr: parseInt(m[3], 10), description: m[4] || '' });
    }

    return out;
}

export function serializeSignalsToFile(signals: SignalEntry[]): string {
    return signals.map(s => (
        s.type === 'DCC' ? `DCC_SIGNAL(${s.id}, ${s.addr}, ${s.subAddr})` : `SIGNAL(${s.red}, ${s.amber}, ${s.green})`
    )).join('\n');
}

/** Matches a bare DONE or RETURN line — the two statements EX-RAIL treats as terminal within a
 *  block body (DONE halts the task; RETURN pops back to the CALL site — see scanBlockBody doc). */
const BLOCK_TERMINATOR = /^(?:DONE|RETURN)\s*$/;

/**
 * Scans forward from `start` collecting a ROUTE/SEQUENCE block's body lines, stopping at
 * whichever comes first: a bare (unindented) DONE or RETURN line, the start of the next block,
 * or EOF. RETURN is EX-RAIL's own way to end a SEQUENCE invoked via CALL (it returns to the
 * caller rather than halting the task outright), so it terminates a body exactly as tightly as
 * DONE does — a SEQUENCE ending in RETURN with no trailing DONE must not bleed into whatever
 * follows. The terminator line found this way is kept as the last body line rather than
 * discarded — it's real, user-editable body content (the block canvas renders it as an ordinary
 * block), not a sentinel this parser hides and silently re-adds. Stopping at the next block's own
 * header (not just at a terminator) means a body legitimately WITHOUT one — because the user
 * removed it — never swallows the following block's content while scanning for a terminator that
 * isn't there.
 */
function scanBlockBody(lines: string[], start: number, blockStart: RegExp): { body: string; next: number } {
    const bodyLines: string[] = [];
    let i = start;
    while (i < lines.length && !BLOCK_TERMINATOR.test(lines[i]) && !blockStart.test(lines[i])) {
        bodyLines.push(lines[i]);
        i++;
    }
    if (i < lines.length && BLOCK_TERMINATOR.test(lines[i])) {
        bodyLines.push(lines[i]);
        i++;
    }
    return { body: bodyLines.join('\n').trim(), next: i };
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
            const { body, next } = scanBlockBody(lines, i + 1, routeStart);
            i = next;
            out.push({ id, description: desc, body });
            continue;
        }
        i++;
    }
    return out;
}

/**
 * Scans for top-level AUTOMATION(id, "desc") blocks anywhere in `fileContent` (unlike
 * ROUTE/SEQUENCE, these aren't confined to a dedicated file — they live inside
 * myAutomation.h's free-form preserved content). See AutomationEntry doc comment.
 */
export function parseAutomationsFromFile(fileContent: string): AutomationEntry[] {
    const lines = fileContent.split('\n');
    const out: AutomationEntry[] = [];
    const automationStart = /^AUTOMATION\s*\(\s*(\d+)\s*,\s*"([^"]*)"\s*\)\s*$/;
    let i = 0;
    while (i < lines.length) {
        const m = lines[i].match(automationStart);
        if (m) {
            const id = parseInt(m[1], 10);
            const desc = m[2];
            const { body, next } = scanBlockBody(lines, i + 1, automationStart);
            i = next;
            out.push({ id, description: desc, body });
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
        const trimmedBody = (r.body ?? '').trim();
        // A brand-new route's body starts empty — DONE is still the sensible on-disk default
        // for that case. Once the body has any real content, write it verbatim: whether it
        // ends in DONE (retained from a previous load, or added via the block canvas) or not
        // (the user removed it) is entirely up to what's actually there, never forced.
        lines.push(trimmedBody || 'DONE');
        lines.push('');
    }
    return lines.join('\n').trim();
}

export function parseSequencesFromFile(fileContent: string): SequenceEntry[] {
    const lines = fileContent.split('\n');
    const out: SequenceEntry[] = [];
    const seqStart = /^SEQUENCE\s*\(\s*(\d+)\s*\)\s*(?:\/\/\s*(.*))?$/;
    let i = 0;
    while (i < lines.length) {
        const m = lines[i].match(seqStart);
        if (m) {
            const id = parseInt(m[1], 10);
            const description = m[2] ? m[2].trim() : '';
            const { body, next } = scanBlockBody(lines, i + 1, seqStart);
            i = next;
            out.push({ id, description, body });
            continue;
        }
        i++;
    }
    return out;
}

export function serializeSequencesToFile(seqs: SequenceEntry[]): string {
    const lines: string[] = [];
    for (const s of seqs) {
        const desc = s.description && s.description.trim() ? ` // ${s.description.trim()}` : '';
        lines.push(`SEQUENCE(${s.id})${desc}`);
        const trimmedBody = (s.body ?? '').trim();
        lines.push(trimmedBody || 'DONE');
        lines.push('');
    }
    return lines.join('\n').trim();
}

/**
 * Scans for top-level EXRAIL event-handler blocks (ONSENSOR(200), ONACTIVATE(100, 4),
 * ONRAILSYNCON, ...) in `fileContent` (designed for myEvents.h, mirroring parseRoutesFromFile's/
 * parseSequencesFromFile's own dedicated-file scope) — matched by the `ON*` naming convention
 * EXRAIL itself uses for every event handler, not by importing BLOCK_REGISTRY, so this module
 * stays framework/UI-free (see its own top-of-file doc comment). `text` captures the header line
 * and everything through the next block/EOF, via the same scanBlockBody() helper routes/sequences
 * use — see EventHandlerEntry's own doc comment for why the header line is part of `text` here,
 * unlike RouteEntry.body/SequenceEntry.body.
 */
export function parseEventHandlersFromFile(fileContent: string): EventHandlerEntry[] {
    const lines = fileContent.split('\n');
    const out: EventHandlerEntry[] = [];
    const handlerStart = /^(ON[A-Z0-9_]*)\s*(?:\([^)]*\))?\s*$/;
    let i = 0;
    while (i < lines.length) {
        const m = lines[i].match(handlerStart);
        if (m) {
            const command = m[1];
            const headerLine = lines[i];
            const { body, next } = scanBlockBody(lines, i + 1, handlerStart);
            i = next;
            const text = body ? `${headerLine}\n${body}` : headerLine;
            out.push({ command, text });
            continue;
        }
        i++;
    }
    return out;
}

export function serializeEventHandlersToFile(handlers: EventHandlerEntry[]): string {
    return handlers.map(h => h.text.trim()).join('\n\n');
}

// ─── ROUTE/AUTOMATION/SEQUENCE ID rules ──────────────────────────────────────

export type SequenceObjectKind = 'Route' | 'Automation' | 'Sequence';

export interface SequenceIdEntry {
    kind: SequenceObjectKind;
    id: number;
}

export interface SequenceIdViolation {
    kind: SequenceObjectKind;
    id: number;
    reason: string;
}

/** Per https://dcc-ex.com/exrail/exrail-command-reference.html — ROUTE/AUTOMATION/SEQUENCE IDs
 *  share one numbering pool (a THROW/FOLLOW-style reference by id is ambiguous otherwise), and
 *  the valid range is 1-32767: id 0 is implicitly assigned to the startup sequence (the code
 *  that runs before the first ROUTE/AUTOMATION/SEQUENCE in the script) and can't be reused. */
export const MIN_SEQUENCE_ID = 1;
export const MAX_SEQUENCE_ID = 32767;
export const RESERVED_STARTUP_SEQUENCE_ID = 0;

/**
 * Validates a combined list of ROUTE/AUTOMATION/SEQUENCE ids: each must fall in
 * [MIN_SEQUENCE_ID, MAX_SEQUENCE_ID] (id 0 is reserved, not just "out of range"), and no id may
 * be reused by more than one entry regardless of which of the three types it belongs to. Returns
 * one violation per offending entry — two entries sharing an id each get their own violation.
 */
export function validateSequenceIds(entries: SequenceIdEntry[]): SequenceIdViolation[] {
    const violations: SequenceIdViolation[] = [];

    for (const entry of entries) {
        if (entry.id === RESERVED_STARTUP_SEQUENCE_ID) {
            violations.push({
                kind: entry.kind,
                id: entry.id,
                reason: 'ID 0 is reserved for the startup sequence (the code before the first ROUTE/AUTOMATION/SEQUENCE) and cannot be assigned explicitly.',
            });
        } else if (entry.id < MIN_SEQUENCE_ID || entry.id > MAX_SEQUENCE_ID) {
            violations.push({
                kind: entry.kind,
                id: entry.id,
                reason: `ID ${entry.id} is out of range — ROUTE/AUTOMATION/SEQUENCE IDs must be between ${MIN_SEQUENCE_ID} and ${MAX_SEQUENCE_ID}.`,
            });
        }
    }

    const owners = new Map<number, SequenceIdEntry[]>();
    for (const entry of entries) {
        const list = owners.get(entry.id);
        if (list) list.push(entry);
        else owners.set(entry.id, [entry]);
    }

    for (const [id, list] of owners) {
        if (list.length < 2) continue;
        const kinds = list.map((e) => e.kind);
        for (const entry of list) {
            violations.push({
                kind: entry.kind,
                id,
                reason: `ID ${id} is used by more than one ROUTE/AUTOMATION/SEQUENCE entry (${kinds.join(', ')}) — IDs must be unique across all three types.`,
            });
        }
    }

    return violations;
}

/** ALIAS(name[, value]) — see https://dcc-ex.com/exrail/exrail-command-reference.html#aliases */
export function parseAliasesFromFile(fileContent: string): AliasEntry[] {
    const uncommented = fileContent
        .split('\n')
        .map(l => (l.trimStart().startsWith('//') ? '' : l))
        .join('\n');
    const aliasRe = /\bALIAS\s*\(\s*([A-Za-z_]\w*)\s*(?:,\s*([^),]*))?\s*\)(?:\s*\/\/\s*(.*))?/g;
    const out: AliasEntry[] = [];
    let m: RegExpExecArray | null;
    while ((m = aliasRe.exec(uncommented)) !== null) {
        out.push({ name: m[1], value: (m[2] ?? '').trim(), aliasType: parseAliasTypeComment(m[3]) });
    }
    return out;
}

export function serializeAliasesToFile(aliases: AliasEntry[]): string {
    return aliases.map(a => {
        let line = a.value.trim() === '' ? `ALIAS(${a.name})` : `ALIAS(${a.name}, ${a.value})`;
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
    const validDccL = /^\s*TURNOUTL\s*\(\s*\d+\s*,\s*\d+\s*(?:,\s*"[^"]*")?\s*\)(?:\s*\/\/.*)?$/;
    const validPin = /^\s*PIN_TURNOUT\s*\(\s*\d+\s*,\s*\d+\s*(?:,\s*"[^"]*")?\s*\)(?:\s*\/\/.*)?$/;
    const validVirtual = /^\s*VIRTUAL_TURNOUT\s*\(\s*\d+\s*(?:,\s*"[^"]*")?\s*\)(?:\s*\/\/.*)?$/;

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
        if (/\bVIRTUAL_TURNOUT\s*\(/.test(line)) {
            if (!validVirtual.test(line)) { invalidLines.push(line); return `// [INVALID] ${line}`; }
            return line;
        }
        if (/\bTURNOUTL\s*\(/.test(line)) {
            if (!validDccL.test(line)) { invalidLines.push(line); return `// [INVALID] ${line}`; }
            return line;
        }
        // Plain TURNOUT — guard against matching the suffix of SERVO_/PIN_/TURNOUTL (handled above;
        // the lookbehind alone is enough since "TURNOUT\s*\(" never matches inside "TURNOUTL(")
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
            defaultState: 'CLOSED',
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
            defaultState: 'CLOSED',
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
            defaultState: 'CLOSED',
        });
    }

    // ── TURNOUTL(id, addr[, "desc"]) — DCC accessory, linear address ──────────
    const dccLRe = /TURNOUTL\s*\(\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*"([^"]*)")?\s*\)(?:\s*\/\/\s*(.*))?/g;
    while ((m = dccLRe.exec(uncommentedContent)) !== null) {
        entries.push({
            type: 'DCCL',
            id: parseInt(m[1], 10),
            addr: parseInt(m[2], 10),
            description: m[3] || '',
            comment: m[4] ? m[4].trim() : '',
            defaultState: 'CLOSED',
        });
    }

    // ── VIRTUAL_TURNOUT(id[, "desc"]) — no hardware ───────────────────────────
    const virtualRe = /VIRTUAL_TURNOUT\s*\(\s*(\d+)\s*(?:,\s*"([^"]*)")?\s*\)(?:\s*\/\/\s*(.*))?/g;
    while ((m = virtualRe.exec(uncommentedContent)) !== null) {
        entries.push({
            type: 'VIRTUAL',
            id: parseInt(m[1], 10),
            description: m[2] || '',
            comment: m[3] ? m[3].trim() : '',
            defaultState: 'CLOSED',
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
        } else if (t.type === 'DCCL') {
            line = `TURNOUTL(${t.id}, ${t.addr}`;
            if (t.description) line += `, "${t.description}"`;
            line += ')';
        } else if (t.type === 'PIN') {
            line = `PIN_TURNOUT(${t.id}, ${t.pin}`;
            if (t.description) line += `, "${t.description}"`;
            line += ')';
        } else if (t.type === 'VIRTUAL') {
            line = `VIRTUAL_TURNOUT(${t.id}`;
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

/** Marker embedded in the second line of every file generated by DCC-Rail-Commander */
export const GENERATOR_HEADER_MARKER = '// DCC-Rail-Commander'

const GENERATOR_HEADER_RE = /^\/\/ DCC-Rail-Commander v([\d.]+)/m
const HEADER_BAR = '//' + ' ' + '='.repeat(77)

/**
 * Returns true if the text contains a DCC-Rail-Commander generator header.
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
        `// DCC-Rail-Commander v${appVersion}`,
        `// This file (${filename}) is managed by DCC-Rail-Commander — manual edits are preserved`,
        '// but may be reformatted on the next save. See https://dcc-ex.com for docs.',
        `// Last saved: ${new Date().toISOString()}`,
        HEADER_BAR,
    ].join('\n')
}

const LAST_SAVED_LINE_RE = /^\/\/ Last saved: .*$/m

/**
 * Replaces the dynamic "Last saved" timestamp line with a static placeholder.
 * The timestamp is rewritten to "now" on every syncAll() regardless of
 * whether the user changed anything, so a raw content comparison (e.g. the
 * Preview Changes diff) would otherwise treat every managed file as changed
 * on every save. Normalizing it out lets comparisons reflect real edits.
 */
export function normalizeGeneratorTimestamp(text: string): string {
    return text.replace(LAST_SAVED_LINE_RE, '// Last saved: (unchanged)')
}

/**
 * Removes the generator header block entirely. Used by the Preview Changes
 * diff so it shows only real content, not installer boilerplate that changes
 * on every save (and sometimes on every version bump).
 */
export function stripGeneratorHeader(text: string): string {
    if (!hasGeneratorHeader(text)) return text
    const firstIdx = text.indexOf(HEADER_BAR)
    if (firstIdx === -1) return text
    const secondIdx = text.indexOf(HEADER_BAR, firstIdx + HEADER_BAR.length)
    if (secondIdx === -1) return text
    let endIdx = secondIdx + HEADER_BAR.length
    if (text.startsWith('\r\n', endIdx)) endIdx += 2
    else if (text[endIdx] === '\n') endIdx += 1
    return text.slice(0, firstIdx) + text.slice(endIdx)
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
        { type: 'SERVO', id: 200, pin: 101, activeAngle: 450, inactiveAngle: 110, profile: 'Slow', description: 'Example slow turnout', comment: '', defaultState: 'CLOSED' },
        { type: 'SERVO', id: 201, pin: 102, activeAngle: 400, inactiveAngle: 100, profile: 'Medium', description: 'Yard ladder switch 1', comment: 'Main yard', defaultState: 'CLOSED' },
        { type: 'SERVO', id: 202, pin: 103, activeAngle: 410, inactiveAngle: 90, profile: 'Fast', description: 'Main line crossover', comment: '', defaultState: 'CLOSED' },
    ];
}
