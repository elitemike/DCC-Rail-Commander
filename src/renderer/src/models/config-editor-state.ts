import { observable, resolve } from 'aurelia'
import { InstallerState } from './installer-state'
import { hasDeviceHeader, injectDeviceHeader } from '../utils/configHeaderParser'
import { STACKED_MOTOR_DRIVER } from '../config/commandstation'
import {
    serializeRosterToFile,
    serializeTurnoutToFile,
    parseRosterFromFile,
    parseTurnoutFromFile,
    buildGeneratorHeader,
    parseSensorsFromFile,
    serializeSensorsToFile,
    parseSignalsFromFile,
    serializeSignalsToFile,
    parseRoutesFromFile,
    serializeRoutesToFile,
    parseSequencesFromFile,
    serializeSequencesToFile,
    parseEventHandlersFromFile,
    serializeEventHandlersToFile,
    parseAliasesFromFile,
    serializeAliasesToFile,
    parseDefaultThrownTurnoutIdsFromAutomation,
    getPrimaryAliasForId,
    parseAliasNumericValue,
    collectObjectIdReferences,
    listObjectIdsForType,
    inferAliasTypes,
    parseAliasTypeComment,
    validateAliasName,
    validateAliasValue,
    parseAutomationsFromFile,
    validateSequenceIds,
    type Roster,
    type Turnout,
    type RosterFunction,
    type SensorEntry,
    type SignalEntry,
    type RouteEntry,
    type SequenceEntry,
    type EventHandlerEntry,
    type AutomationEntry,
    type AliasEntry,
    type AliasTargetType,
    type SequenceIdEntry,
    type SequenceIdViolation,
} from '../utils/myAutomationParser'
import {
    parseHalDevicesFromAutomation,
    computeVpinAllocations,
    countDistinctVpins,
    findNextFreeVpin,
    findVpinConflicts as findVpinConflictsInAllocations,
    type HalDeviceInstance,
    type VpinAllocation,
} from '../config/hal-devices'

/**
 * Open/close tag that delimits the auto-managed #include block at the top of
 * myAutomation.h.  The same string is used for both the opening and closing
 * line, matching the pattern used by the device header in config.h.
 */
export const MANAGED_INCLUDES_TAG = '// ==== DCC-Rail-Commander Required Includes ===='
export const MANAGED_HAL_DEVICES_TAG = '// ==== DCC-Rail-Commander HAL Devices ===='
export const MANAGED_TRACK_MANAGER_TAG = '// ==== DCC-Rail-Commander TrackManager ===='
export const MANAGED_TURNOUT_DEFAULTS_TAG = '// ==== DCC-Rail-Commander Turnout Defaults ===='

/**
 * Strips the managed-includes block (and any bare myRoster/myTurnouts includes
 * that appear outside it) from myAutomation.h content, returning only the
 * user's custom code.  Called when loading an existing file so that the custom
 * body survives subsequent auto-regeneration.
 */
export function extractAutomationCustomContent(content: string): string {
    // Remove the managed-includes block (open tag … close tag, inclusive)
    let text = content
    const openIdx = text.indexOf(MANAGED_INCLUDES_TAG)
    if (openIdx !== -1) {
        const closeIdx = text.indexOf(MANAGED_INCLUDES_TAG, openIdx + MANAGED_INCLUDES_TAG.length)
        if (closeIdx !== -1) {
            const afterClose = closeIdx + MANAGED_INCLUDES_TAG.length
            text = text.slice(0, openIdx) + text.slice(afterClose)
        }
    }

    // Remove the managed HAL Devices block (open tag … close tag, inclusive)
    const hdOpenIdx = text.indexOf(MANAGED_HAL_DEVICES_TAG)
    if (hdOpenIdx !== -1) {
        const hdCloseIdx = text.indexOf(MANAGED_HAL_DEVICES_TAG, hdOpenIdx + MANAGED_HAL_DEVICES_TAG.length)
        if (hdCloseIdx !== -1) {
            const afterClose = hdCloseIdx + MANAGED_HAL_DEVICES_TAG.length
            text = text.slice(0, hdOpenIdx) + text.slice(afterClose)
        }
    }

    // Remove the managed TrackManager block (open tag … close tag, inclusive)
    const tmOpenIdx = text.indexOf(MANAGED_TRACK_MANAGER_TAG)
    if (tmOpenIdx !== -1) {
        const tmCloseIdx = text.indexOf(MANAGED_TRACK_MANAGER_TAG, tmOpenIdx + MANAGED_TRACK_MANAGER_TAG.length)
        if (tmCloseIdx !== -1) {
            const afterClose = tmCloseIdx + MANAGED_TRACK_MANAGER_TAG.length
            text = text.slice(0, tmOpenIdx) + text.slice(afterClose)
        }
    }

    // Remove the managed turnout-defaults block (open tag … close tag, inclusive)
    const tdOpenIdx = text.indexOf(MANAGED_TURNOUT_DEFAULTS_TAG)
    if (tdOpenIdx !== -1) {
        const tdCloseIdx = text.indexOf(MANAGED_TURNOUT_DEFAULTS_TAG, tdOpenIdx + MANAGED_TURNOUT_DEFAULTS_TAG.length)
        if (tdCloseIdx !== -1) {
            const afterClose = tdCloseIdx + MANAGED_TURNOUT_DEFAULTS_TAG.length
            text = text.slice(0, tdOpenIdx) + text.slice(afterClose)
        }
    }

    // Backward-compat migration: strip legacy generated AUTOSTART blocks that
    // were previously inserted without managed tags.
    // IMPORTANT: only strip if EVERY non-blank, non-comment line is a pure
    // TrackManager command (SET_TRACK / SET_POWER / POWERON).  If the user has
    // mixed any other EXRAIL command into the block (even alongside POWERON or
    // SET_TRACK) the whole block is treated as user content and preserved.
    text = text.replace(/AUTOSTART\s*\n([\s\S]*?)\nDONE\s*/g, (full, body: string) => {
        const bodyLines = body.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.startsWith('//'))
        if (bodyLines.length === 0) return full  // empty block — keep
        const isLegacyTrackManager = bodyLines.every(l =>
            /^SET_TRACK\([A-D],/.test(l) || /^SET_POWER\([A-D],/.test(l) || l === 'POWERON',
        )
        return isLegacyTrackManager ? '' : full
    })

    // Also strip any bare managed #include lines left outside the block
    text = text
        .split('\n')
        .filter(line => {
            const t = line.trim()
            if (t === '#include "myRoster.h"' || t === '#include "myTurnouts.h"') return false
            // Strip legacy generated DC roster aliases from older TrackManager output.
            if (/^ROSTER\(\d+,"DC TRACK [A-D]","\/\* \/"\)$/.test(t)) return false
            return true
        })
        .join('\n')

    return text.replace(/^\n+/, '').replace(/\n+$/, '')
}

/**
 * Recovers a pre-tag legacy TrackManager AUTOSTART block — a bare
 * AUTOSTART...DONE block with no MANAGED_TRACK_MANAGER_TAG wrapper, from
 * before the tag system existed — so genuinely old projects still migrate
 * their track config into myStartup.h instead of losing it. Mirrors the
 * detection predicate in extractAutomationCustomContent()'s legacy-strip
 * regex above: only matches if every non-blank/non-comment line is a pure
 * TrackManager command.
 */
function extractLegacyUntaggedTrackManagerBlock(content: string): string {
    const match = content.match(/AUTOSTART\s*\n([\s\S]*?)\nDONE\s*/)
    if (!match) return ''
    const bodyLines = match[1].split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('//'))
    if (bodyLines.length === 0) return ''
    const isLegacyTrackManager = bodyLines.every(l =>
        /^SET_TRACK\([A-D],/.test(l) || /^SET_POWER\([A-D],/.test(l) || l === 'POWERON',
    )
    return isLegacyTrackManager ? ['AUTOSTART', ...bodyLines, 'DONE'].join('\n') : ''
}

/**
 * Extracts the literal body of a managed block (e.g. the TrackManager
 * AUTOSTART/DONE block) from myAutomation.h content, stripping the two fixed
 * boilerplate comment lines that `automationPreview` re-adds itself. Returns
 * '' if the tag isn't present or is unterminated.
 *
 * Without this, loading a file that already has a managed block (e.g. from
 * an imported folder, or simply re-opening a saved config without visiting
 * the form that owns that block) leaves the corresponding `generated*Content`
 * state empty, and the next regeneration silently drops the block.
 */
function extractManagedBlockBody(content: string, tag: string): string {
    const openIdx = content.indexOf(tag)
    if (openIdx === -1) return ''
    const closeIdx = content.indexOf(tag, openIdx + tag.length)
    if (closeIdx === -1) return ''
    const inner = content.slice(openIdx + tag.length, closeIdx)
    return inner
        .split('\n')
        .filter(line => {
            const t = line.trim()
            return t !== '' && !t.startsWith('// This') && !t.startsWith('// Do not edit inside this block')
        })
        .join('\n')
        .trim()
}

/**
 * ConfigEditorState — singleton that owns the in-memory editing state for all
 * configuration files.  It is the single source of truth for:
 *   • config.h                  (raw text)
 *   • myRoster.h                (structured Roster[] + raw text view)
 *   • myTurnouts.h              (structured Turnout[] + raw text view)
 *   • myAutomation.h            (editable; managed includes pinned at top)
 *
 * It mirrors changes back to InstallerState.configFiles so the existing
 * workspace save flow continues to work without modification.
 */
export class ConfigEditorState {
    private readonly installerState = resolve(InstallerState)

    // ── config.h ─────────────────────────────────────────────────────────────
    configHContent = ''

    /**
     * Whether config.h currently selects the stacked (dual) motor shield — the same
     * MOTOR_SHIELD_TYPE check track-manager-form.ts's own hasStackedMotorShield uses, re-derived
     * here from the raw file content rather than that form's local `opts` state so track
     * availability (see exrail-block-registry.ts's AFTEROVERLOAD block) stays correct even when
     * the Startup editor/TrackManager form isn't mounted. Tracks A/B always exist; C/D only exist
     * when this is true (see commandstation.ts's generateMyAutomation()).
     */
    get hasStackedMotorShield(): boolean {
        const match = this.configHContent.match(/^#define\s+MOTOR_SHIELD_TYPE\s+(\S+)$/m)
        return (match?.[1] ?? '').toUpperCase() === STACKED_MOTOR_DRIVER
    }

    // ── Unsaved-changes tracking ──────────────────────────────────────────────
    hasChanges = false

    /**
     * Persisted app-wide preference (default on) — when true, every alias-eligible entry
     * (Turnout, Roster, Sensor, Route, Sequence) must carry an alias: syncAliasForId()
     * rejects blanking one out, and each editor's own commit path (turnout/roster-editor's
     * commitBuffer(), sensors-editor's updateSensor(), routes/sequences-editor's
     * updateRoute()/updateSequence()) refuses to save *any* field change on an entry that
     * currently lacks an alias, not just alias edits themselves. Loaded/toggled from
     * workspace.ts's Settings dialog wiring — see setStrictAliases() there.
     */
    strictAliases = true

    // ── myRoster.h ───────────────────────────────────────────────────────────
    @observable roster: Roster[] = []

    /**
     * Lines that were detected as invalid ROSTER calls and have been commented
     * out. Preserved here so they survive the round-trip back to raw view.
     */
    rosterPreservedComments = ''

    get rosterRaw(): string {
        const header = buildGeneratorHeader('myRoster.h', this.installerState.appVersion)
        const serialized = serializeRosterToFile(this.roster)
        const body = this.rosterPreservedComments
            ? `${this.rosterPreservedComments}\n${serialized}`
            : serialized
        return `${header}\n${body}`
    }

    setRosterFromRaw(text: string): void {
        try {
            this.roster = parseRosterFromFile(text)
            this.hasChanges = true
        } catch {
            // keep existing roster if parse fails
        }
        this._syncToInstallerState()
    }

    updateRosterEntry(index: number, entry: Roster): void {
        this.roster = this.roster.map((r, i) => (i === index ? { ...entry } : r))
        this.hasChanges = true
        this._syncToInstallerState()
    }

    addRosterEntry(entry: Roster): void {
        this.roster = [...this.roster, entry]
        this.hasChanges = true
        this._syncToInstallerState()
    }

    removeRosterEntry(index: number): void {
        this.roster = this.roster.filter((_, i) => i !== index)
        this.hasChanges = true
        this._syncToInstallerState()
    }

    /** Updates the function list on ALL roster entries that share `macroName`. */
    updateDefineFunctions(macroName: string, functions: RosterFunction[]): void {
        const fns = functions.map(f => ({ ...f }))
        this.roster = this.roster.map(r =>
            r.functionMacro === macroName ? { ...r, functions: fns } : r,
        )
        this.hasChanges = true
        this._syncToInstallerState()
    }

    /** Updates the friendly name on ALL roster entries that share `macroName`. */
    updateDefineFriendlyName(macroName: string, friendlyName: string): void {
        this.roster = this.roster.map(r =>
            r.functionMacro === macroName
                ? { ...r, defineFriendlyName: friendlyName || undefined }
                : r,
        )
        this.hasChanges = true
        this._syncToInstallerState()
    }

    /** Renames a #define macro across all roster entries that reference it. */
    renameMacro(oldName: string, newName: string): void {
        this.roster = this.roster.map(r =>
            r.functionMacro === oldName ? { ...r, functionMacro: newName } : r,
        )
        this.hasChanges = true
        this._syncToInstallerState()
    }

    /** Sets appended functions on a specific roster entry (must have a macro). */
    setAppendedFunctions(index: number, functions: RosterFunction[]): void {
        const entry = this.roster[index]
        if (!entry || !entry.functionMacro) return
        const fns = functions.map(f => ({ ...f }))
        this.roster = this.roster.map((r, i) =>
            i === index ? { ...r, appendedFunctions: fns.length > 0 ? fns : undefined } : r,
        )
        this.hasChanges = true
        this._syncToInstallerState()
    }

    /** Adds an appended function to a roster entry. */
    addAppendedFunction(index: number, fn: RosterFunction): void {
        const entry = this.roster[index]
        if (!entry || !entry.functionMacro) return
        const existing = entry.appendedFunctions ?? []
        this.roster = this.roster.map((r, i) =>
            i === index ? { ...r, appendedFunctions: [...existing, { ...fn }] } : r,
        )
        this.hasChanges = true
        this._syncToInstallerState()
    }

    /** Removes an appended function from a roster entry. */
    removeAppendedFunction(index: number, fnIndex: number): void {
        const entry = this.roster[index]
        if (!entry || !entry.appendedFunctions) return
        const updated = entry.appendedFunctions.filter((_, i) => i !== fnIndex)
        this.roster = this.roster.map((r, i) =>
            i === index ? { ...r, appendedFunctions: updated.length > 0 ? updated : undefined } : r,
        )
        this.hasChanges = true
        this._syncToInstallerState()
    }

    // ── myTurnouts.h ─────────────────────────────────────────────────────────
    @observable turnouts: Turnout[] = []

    /**
     * Lines that were detected as invalid SERVO_TURNOUT calls and have been
     * commented out. Preserved here so they survive the round-trip back to raw.
     */
    turnoutPreservedComments = ''

    get turnoutsRaw(): string {
        const header = buildGeneratorHeader('myTurnouts.h', this.installerState.appVersion)
        const serialized = serializeTurnoutToFile(this.turnouts)
        const body = this.turnoutPreservedComments
            ? `${this.turnoutPreservedComments}\n${serialized}`
            : serialized
        return `${header}\n${body}`
    }

    setTurnoutsFromRaw(text: string): void {
        try {
            // myTurnouts.h's SERVO_TURNOUT()/PIN_TURNOUT()/TURNOUT() syntax has no
            // field for defaultState — it only ever exists as this app's in-memory
            // state (surfaced on disk purely via myAutomation.h's generated AUTOSTART
            // block, see _syncGeneratedTurnoutDefaultsContent). parseTurnoutFromFile
            // always defaults it to CLOSED, so re-parsing on every raw round-trip —
            // even one where the user changed nothing — would otherwise silently
            // reset every turnout's defaultState and drop its AUTOSTART THROW line.
            // Preserve the previous value for any id that still exists.
            const previousDefaultStateById = new Map(this.turnouts.map(t => [t.id, t.defaultState]))
            this.turnouts = parseTurnoutFromFile(text).map(t => {
                const previousDefaultState = previousDefaultStateById.get(t.id)
                return previousDefaultState ? { ...t, defaultState: previousDefaultState } : t
            })
            this._syncGeneratedTurnoutDefaultsContent()
            this.hasChanges = true
        } catch {
            // keep existing turnouts if parse fails
        }
        this._syncToInstallerState()
    }

    updateTurnoutEntry(index: number, entry: Turnout): void {
        this.turnouts = this.turnouts.map((t, i) => (i === index ? { ...entry } : t))
        this._syncGeneratedTurnoutDefaultsContent()
        this.hasChanges = true
        this._syncToInstallerState()
    }

    addTurnoutEntry(entry: Turnout): void {
        this.turnouts = [...this.turnouts, entry]
        this._syncGeneratedTurnoutDefaultsContent()
        this.hasChanges = true
        this._syncToInstallerState()
    }

    removeTurnoutEntry(index: number): void {
        this.turnouts = this.turnouts.filter((_, i) => i !== index)
        this._syncGeneratedTurnoutDefaultsContent()
        this.hasChanges = true
        this._syncToInstallerState()
    }

    // ── mySensors.h ───────────────────────────────────────────────────────
    @observable sensors: SensorEntry[] = []

    get sensorsRaw(): string {
        const header = buildGeneratorHeader('mySensors.h', this.installerState.appVersion)
        const serialized = serializeSensorsToFile(this.sensors)
        return `${header}\n${serialized}`
    }

    setSensorsFromRaw(text: string): void {
        try {
            this.sensors = parseSensorsFromFile(text)
            this.hasChanges = true
        } catch {
            // keep existing sensors if parse fails
        }
        this._syncToInstallerState()
    }

    // ── mySignals.h ───────────────────────────────────────────────────────
    @observable signals: SignalEntry[] = []

    get signalsRaw(): string {
        const header = buildGeneratorHeader('mySignals.h', this.installerState.appVersion)
        const serialized = serializeSignalsToFile(this.signals)
        return `${header}\n${serialized}`
    }

    setSignalsFromRaw(text: string): void {
        try {
            this.signals = parseSignalsFromFile(text)
            this.hasChanges = true
        } catch {
            // keep existing signals if parse fails
        }
        this._syncToInstallerState()
    }

    // ── myRoutes.h ────────────────────────────────────────────────────────
    @observable routes: RouteEntry[] = []

    get routesRaw(): string {
        const header = buildGeneratorHeader('myRoutes.h', this.installerState.appVersion)
        const serialized = serializeRoutesToFile(this.routes)
        return `${header}\n${serialized}`
    }

    setRoutesFromRaw(text: string): void {
        try {
            this.routes = parseRoutesFromFile(text)
            this.hasChanges = true
        } catch {
            // keep existing routes if parse fails
        }
        this._syncToInstallerState()
    }

    // ── mySequences.h ─────────────────────────────────────────────────────
    @observable sequences: SequenceEntry[] = []

    get sequencesRaw(): string {
        const header = buildGeneratorHeader('mySequences.h', this.installerState.appVersion)
        const serialized = serializeSequencesToFile(this.sequences)
        return `${header}\n${serialized}`
    }

    setSequencesFromRaw(text: string): void {
        try {
            this.sequences = parseSequencesFromFile(text)
            this.hasChanges = true
        } catch {
            // keep existing sequences if parse fails
        }
        this._syncToInstallerState()
    }

    // ── myEvents.h ────────────────────────────────────────────────────────
    @observable eventHandlers: EventHandlerEntry[] = []

    get eventHandlersRaw(): string {
        const header = buildGeneratorHeader('myEvents.h', this.installerState.appVersion)
        const serialized = serializeEventHandlersToFile(this.eventHandlers)
        return `${header}\n${serialized}`
    }

    setEventHandlersFromRaw(text: string): void {
        try {
            this.eventHandlers = parseEventHandlersFromFile(text)
            this.hasChanges = true
        } catch {
            // keep existing event handlers if parse fails
        }
        this._syncToInstallerState()
    }

    // ── myAliases.h ───────────────────────────────────────────────────────
    @observable aliases: AliasEntry[] = []

    get aliasesRaw(): string {
        const header = buildGeneratorHeader('myAliases.h', this.installerState.appVersion)
        const serialized = serializeAliasesToFile(this.aliases)
        return `${header}\n${serialized}`
    }

    setAliasesFromRaw(text: string): { ok: true } | { ok: false; reason: string } {
        try {
            const parsed = parseAliasesFromFile(text)
            const normalized = this.normalizeAliases(parsed)
            if (!normalized.ok) return normalized
            this.aliases = normalized.aliases
            this.hasChanges = true
        } catch {
            // keep existing aliases if parse fails
            return { ok: false, reason: 'Unable to parse aliases from raw text.' }
        }
        this._syncToInstallerState()
        return { ok: true }
    }

    getPrimaryAliasNameForId(id: number, type?: AliasTargetType): string {
        return getPrimaryAliasForId(this.aliases, id, type)?.name ?? ''
    }

    // ── Strict aliases: which existing objects need one ──────────────────────
    // Getters (not methods) so templates can bind `state.turnoutIdsNeedingAlias.has(t.id)`
    // directly and have Aurelia's computed-getter tracking pick up changes to
    // strictAliases/aliases/turnouts — a plain method call in a template binding does
    // NOT get that tracking (only the top-level getter/property access does), so this
    // shape matters, not just style. Empty whenever strictAliases is off.

    get turnoutIdsNeedingAlias(): Set<number> {
        if (!this.strictAliases) return new Set()
        return new Set(this.turnouts.filter(t => !getPrimaryAliasForId(this.aliases, t.id, 'Turnout')).map(t => t.id))
    }

    get sensorIdsNeedingAlias(): Set<number> {
        if (!this.strictAliases) return new Set()
        return new Set(this.sensors.filter(s => !getPrimaryAliasForId(this.aliases, s.id, 'Sensor')).map(s => s.id))
    }

    /** Keyed by DCC address (Roster's own id field). */
    get rosterAddressesNeedingAlias(): Set<number> {
        if (!this.strictAliases) return new Set()
        return new Set(this.roster.filter(r => !getPrimaryAliasForId(this.aliases, r.dccAddress, 'Roster')).map(r => r.dccAddress))
    }

    get routeIdsNeedingAlias(): Set<number> {
        if (!this.strictAliases) return new Set()
        return new Set(this.routes.filter(r => !getPrimaryAliasForId(this.aliases, r.id, 'Route')).map(r => r.id))
    }

    get sequenceIdsNeedingAlias(): Set<number> {
        if (!this.strictAliases) return new Set()
        return new Set(this.sequences.filter(s => !getPrimaryAliasForId(this.aliases, s.id, 'Sequence')).map(s => s.id))
    }

    /** Filenames (matching state.configFiles' `name`) of every alias-eligible file with at
     *  least one un-aliased object — drives the file-list warning dot in workspace.html.
     *  Independent of Monaco: correct on load even before that file's editor has ever
     *  been opened, unlike the Monaco-marker-driven error dot (see workspace.ts's
     *  filesWithErrors). */
    get filesNeedingAlias(): Set<string> {
        const files = new Set<string>()
        if (this.turnoutIdsNeedingAlias.size > 0) files.add('myTurnouts.h')
        if (this.sensorIdsNeedingAlias.size > 0) files.add('mySensors.h')
        if (this.rosterAddressesNeedingAlias.size > 0) files.add('myRoster.h')
        if (this.routeIdsNeedingAlias.size > 0) files.add('myRoutes.h')
        if (this.sequenceIdsNeedingAlias.size > 0) files.add('mySequences.h')
        return files
    }

    getObjectIdReferences(id: number) {
        return collectObjectIdReferences(id, {
            roster: this.roster,
            turnouts: this.turnouts,
            sensors: this.sensors,
            routes: this.routes,
            sequences: this.sequences,
        })
    }

    /**
     * IDs of `type` not already claimed by an alias — the "one alias per ID" pool the aliases
     * editor's new-alias ID picker draws from, scoped by type (like the rest of alias handling
     * — see the cross-type-reuse note on validateAliasTargetId) so a Turnout and a Roster loco
     * that happen to share a numeric ID don't block each other's alias. An existing alias's
     * type is its declared `aliasType`, or — for legacy untyped entries — whichever type(s) its
     * value resolves to.
     */
    getAvailableAliasTargetIds(type: AliasTargetType): { id: number; label: string }[] {
        const collections = { roster: this.roster, turnouts: this.turnouts, sensors: this.sensors, routes: this.routes, sequences: this.sequences }
        const used = new Set<number>()
        for (const alias of this.aliases) {
            const numericValue = parseAliasNumericValue(alias.value)
            if (numericValue === null) continue
            const aliasTypes = alias.aliasType ? [alias.aliasType] : inferAliasTypes(alias, collections)
            if (aliasTypes.includes(type)) used.add(numericValue)
        }
        return listObjectIdsForType(type, collections).filter(o => !used.has(o.id))
    }

    validateAliasTargetId(id: number): { ok: true } | { ok: false; reason: string } {
        // Cross-type ID reuse is fine (lookup is context-driven by command/editor target
        // type) — but the id must belong to *some* configured object, or the alias would
        // resolve to nothing.
        if (this.getObjectIdReferences(id).length === 0) {
            return { ok: false, reason: `Alias value ${id} does not match any configured Roster/Turnout/Sensor/Route/Sequence ID.` }
        }
        return { ok: true }
    }

    private normalizeAliasEntry(alias: AliasEntry): { ok: true; alias: AliasEntry } | { ok: false; reason: string } {
        const nameValidation = validateAliasName(alias.name)
        if (!nameValidation.ok) return nameValidation

        const valueValidation = validateAliasValue(alias.value)
        if (!valueValidation.ok) return valueValidation

        const name = alias.name.trim()
        const numericValue = parseAliasNumericValue(alias.value)
        if (numericValue === null) {
            return { ok: true, alias: { ...alias, name, aliasType: alias.aliasType ? parseAliasTypeComment(`type: ${alias.aliasType}`) : alias.aliasType } }
        }

        const validation = this.validateAliasTargetId(numericValue)
        if (!validation.ok) return validation

        const references = this.getObjectIdReferences(numericValue)
        const resolvedType = alias.aliasType ?? (references.length === 1 ? references[0]?.type : undefined)
        return { ok: true, alias: { ...alias, name, aliasType: resolvedType } }
    }

    normalizeAliases(aliases: AliasEntry[]): { ok: true; aliases: AliasEntry[] } | { ok: false; reason: string } {
        const seen = new Set<string>()
        for (const alias of aliases) {
            const name = alias.name.trim()
            if (seen.has(name)) return { ok: false, reason: `Alias name "${name}" is used more than once.` }
            seen.add(name)
        }

        const normalized: AliasEntry[] = []
        for (const alias of aliases) {
            const result = this.normalizeAliasEntry(alias)
            if (!result.ok) return result
            normalized.push(result.alias)
        }
        return { ok: true, aliases: normalized }
    }

    /**
     * Like normalizeAliases, but drops individually-invalid entries instead of rejecting
     * the whole list — used only when loading myAliases.h from disk, where a single stale
     * alias (its target Roster/Turnout/Sensor/Route/Sequence entry deleted since it was
     * created) must not wipe out every other alias in the file. Duplicate names keep the
     * first occurrence and drop the rest, same as normalizeAliases' error would.
     */
    private normalizeAliasesLenient(aliases: AliasEntry[]): AliasEntry[] {
        const seen = new Set<string>()
        const kept: AliasEntry[] = []
        for (const alias of aliases) {
            const name = alias.name.trim()
            if (seen.has(name)) continue
            const result = this.normalizeAliasEntry(alias)
            if (!result.ok) continue
            seen.add(name)
            kept.push(result.alias)
        }
        return kept
    }

    syncAliasForId(
        previousId: number,
        nextId: number,
        aliasName: string,
        aliasType?: AliasTargetType,
        previousAliasName?: string,
    ): { ok: true } | { ok: false; reason: string } {
        const trimmedName = aliasName.trim()
        if (trimmedName === '' && this.strictAliases) {
            return { ok: false, reason: 'An alias is required when Strict aliases is enabled.' }
        }
        const trimmedPreviousName = previousAliasName?.trim() ?? ''
        const aliases = [...this.aliases]

        let aliasIndex = -1
        if (trimmedPreviousName) {
            aliasIndex = aliases.findIndex(alias =>
                parseAliasNumericValue(alias.value) === previousId && alias.name === trimmedPreviousName,
            )
        }
        if (aliasIndex === -1 && aliasType) {
            aliasIndex = aliases.findIndex(alias =>
                parseAliasNumericValue(alias.value) === previousId && alias.aliasType === aliasType,
            )
        }
        // Only fall back to an untyped ID match when the caller didn't tell us what type
        // of object this is — otherwise this can grab another type's alias that merely
        // happens to share the same numeric ID (e.g. editing a roster entry whose DCC
        // address collides with an unrelated turnout ID) and corrupt it in place.
        if (aliasIndex === -1 && !aliasType) {
            aliasIndex = aliases.findIndex(alias => parseAliasNumericValue(alias.value) === previousId)
        }

        if (trimmedName === '') {
            if (aliasIndex !== -1) {
                aliases.splice(aliasIndex, 1)
                this.aliases = aliases
                this.hasChanges = true
                this._syncToInstallerState()
            }
            return { ok: true }
        }

        const nameValidation = validateAliasName(trimmedName)
        if (!nameValidation.ok) return nameValidation

        const validation = this.validateAliasTargetId(nextId)
        if (!validation.ok) {
            return validation
        }

        // The caller (roster/turnout editor) already knows which kind of object this alias
        // is for — trust it over `getObjectIdReferences`, which returns whichever object type
        // happens to match `nextId` first and can pick the wrong type when IDs collide across
        // types (e.g. a turnout ID that numerically matches an unrelated roster address).
        // The caller (roster/turnout editor) already knows which kind of object this alias
        // is for — trust it over `getObjectIdReferences`, which returns whichever object type
        // happens to match `nextId` first and can pick the wrong type when IDs collide across
        // types (e.g. a turnout ID that numerically matches an unrelated roster address).
        const normalizedType = aliasType ?? this.getObjectIdReferences(nextId)[0]?.type
        const aliasByNameIndex = aliases.findIndex(alias => {
            if (alias.name !== trimmedName) return false
            if (!normalizedType || !alias.aliasType) return false
            return alias.aliasType === normalizedType
        })
        const aliasByTargetIndex = aliases.findIndex(alias => {
            if (parseAliasNumericValue(alias.value) !== nextId) return false
            if (!normalizedType) return true
            return alias.aliasType === normalizedType
        })

        const updateIndex = aliasIndex !== -1
            ? aliasIndex
            : (aliasByNameIndex !== -1 ? aliasByNameIndex : aliasByTargetIndex)

        const conflictIndex = aliases.findIndex((alias, i) => alias.name === trimmedName && i !== updateIndex)
        if (conflictIndex !== -1) {
            return { ok: false, reason: `Alias name "${trimmedName}" is already used for a different ID. Choose a unique name.` }
        }

        if (updateIndex !== -1) {
            aliases[updateIndex] = { ...aliases[updateIndex], name: trimmedName, value: String(nextId), aliasType: normalizedType }
        } else {
            aliases.push({ name: trimmedName, value: String(nextId), aliasType: normalizedType })
        }

        this.aliases = aliases
        this.hasChanges = true
        this._syncToInstallerState()
        return { ok: true }
    }

    // ── Preserved content (non-ROSTER/TURNOUT lines from imported myAutomation.h)
    preservedAutomationContent = ''

    /** AUTOMATION(id, "desc") blocks found in myAutomation.h's free-form content — see
     *  AutomationEntry doc comment. There is no visual editor for these; this exists so
     *  automation ids participate in getSequenceIdViolations() below. */
    get automations(): AutomationEntry[] {
        return parseAutomationsFromFile(this.preservedAutomationContent)
    }

    /** Combined ROUTE/AUTOMATION/SEQUENCE id list for validateSequenceIds() — see that
     *  function's doc comment for the range/uniqueness rules being checked. */
    get sequenceIdEntries(): SequenceIdEntry[] {
        return [
            ...this.routes.map((r): SequenceIdEntry => ({ kind: 'Route', id: r.id })),
            ...this.automations.map((a): SequenceIdEntry => ({ kind: 'Automation', id: a.id })),
            ...this.sequences.map((s): SequenceIdEntry => ({ kind: 'Sequence', id: s.id })),
        ]
    }

    /** Every out-of-range id and every cross-type id collision currently present across
     *  myRoutes.h, mySequences.h, and myAutomation.h's AUTOMATION blocks. */
    getSequenceIdViolations(): SequenceIdViolation[] {
        return validateSequenceIds(this.sequenceIdEntries)
    }

    /** Smallest id ≥ 1 not already used by any ROUTE/AUTOMATION/SEQUENCE — used when creating a
     *  new route/sequence, since all three share one id pool (see validateSequenceIds). */
    get nextSequenceId(): number {
        const used = new Set(this.sequenceIdEntries.map((e) => e.id))
        let id = 1
        while (used.has(id)) id++
        return id
    }

    // ── Generated HAL Devices section (accessory boards — see hal-devices.ts) ─
    generatedHalDevicesContent = ''

    /** Structured accessory-board list, derived from the managed block's raw text (see hal-devices.ts's round-trip comments). */
    get halDevices(): HalDeviceInstance[] {
        return parseHalDevicesFromAutomation(this.generatedHalDevicesContent)
    }

    /** Every VPin currently claimed by a turnout, sensor, signal, or HAL device. */
    get vpinAllocations(): VpinAllocation[] {
        return computeVpinAllocations(this.turnouts, this.sensors, this.signals, this.halDevices)
    }

    /** First free VPin at/after 100 (0-99 conventionally reserved for physical MCU pins). */
    get nextFreeVpin(): number {
        return findNextFreeVpin(this.vpinAllocations)
    }

    /**
     * Count of distinct VPins actually claimed by a turnout, sensor, or signal — deliberately
     * excludes `kind: 'device'` allocations, which are a HAL board's whole *reserved* range
     * whether or not each channel has anything wired to it yet (that range is already shown per
     * device row as "Uses VPins X-Y"; counting it again here would report unused board capacity
     * as if it were in use).
     */
    get vpinsInUse(): number {
        return countDistinctVpins(this.vpinAllocations.filter(a => a.kind === 'consumer'))
    }

    /** Allocations overlapping the given range, excluding one by source (e.g. the row being edited). */
    findVpinConflicts(start: number, count: number, excludeSource?: string, onlyKind?: VpinAllocation['kind']): VpinAllocation[] {
        return findVpinConflictsInAllocations(this.vpinAllocations, start, count, excludeSource, onlyKind)
    }

    // ── Generated track manager AUTOSTART section (lives in myStartup.h) ─────
    generatedTrackManagerContent = ''

    // ── Generated turnout defaults AUTOSTART section (lives in myStartup.h) ──
    generatedTurnoutDefaultsContent = ''

    /** Names of the built-in managed files — never auto-included */
    private static readonly BUILTIN = new Set([
        'config.h',
        'myRoster.h',
        'myTurnouts.h',
        'mySignals.h',
        'mySensors.h',
        'myRoutes.h',
        'mySequences.h',
        'myEvents.h',
        'myAliases.h',
        'myAutomation.h',
        'myStartup.h',
    ])

    /** Returns true if this filename was created by the user (not a built-in) */
    isCustomFile(name: string): boolean {
        return !ConfigEditorState.BUILTIN.has(name)
    }

    /** All custom file names currently in the file list */
    get customFileNames(): string[] {
        return this.installerState.configFiles
            .map(f => f.name)
            .filter(n => this.isCustomFile(n))
    }

    // ── Generated myStartup.h preview ────────────────────────────────────────
    /**
     * myStartup.h holds the TrackManager (track power/mode) and Turnout
     * Defaults managed blocks — content that was previously part of
     * myAutomation.h. It has no free-form/preserved section of its own: a
     * direct raw edit to it is only re-absorbed via _syncToInstallerState()'s
     * re-extraction (see the ordering-invariant note on that method), exactly
     * mirroring how myAutomation.h's own preserved content works.
     */
    get startupPreview(): string {
        const sections: string[] = []

        if (this.generatedTrackManagerContent.trim()) {
            sections.push(MANAGED_TRACK_MANAGER_TAG)
            sections.push('// This TrackManager block is managed by DCC-Rail-Commander.')
            sections.push('// Do not edit inside this block manually.')
            sections.push(this.generatedTrackManagerContent.trim())
            sections.push(MANAGED_TRACK_MANAGER_TAG)
        }

        if (this.generatedTurnoutDefaultsContent.trim()) {
            if (sections.length > 0) sections.push('')
            sections.push(MANAGED_TURNOUT_DEFAULTS_TAG)
            sections.push('// This turnout-defaults block is managed by DCC-Rail-Commander.')
            sections.push('// Do not edit inside this block manually.')
            sections.push(this.generatedTurnoutDefaultsContent.trim())
            sections.push(MANAGED_TURNOUT_DEFAULTS_TAG)
        }

        return sections.join('\n')
    }

    // ── Generated myAutomation.h preview ─────────────────────────────────────
    get automationPreview(): string {
        const includes: string[] = []
        if (this.roster.length > 0) includes.push('#include "myRoster.h"')
        if (this.turnouts.length > 0) includes.push('#include "myTurnouts.h"')
        if (this.startupPreview.trim()) includes.push('#include "myStartup.h"')
        // Built-in managed files (besides roster/turnouts) should be included
        // when they contain any non-comment user content.
        const hasUserContent = (name: string): boolean => {
            const f = this.installerState.configFiles.find(cf => cf.name === name)
            if (!f) return false
            return f.content.split('\n').some(l => l.trim() && !l.trim().startsWith('//'))
        }
        for (const name of ['mySignals.h', 'mySensors.h', 'myRoutes.h', 'mySequences.h', 'myEvents.h', 'myAliases.h']) {
            if (hasUserContent(name)) includes.push(`#include "${name}"`)
        }

        for (const name of this.customFileNames) {
            includes.push(`#include "${name}"`)
        }

        const sections: string[] = []

        if (includes.length > 0) {
            sections.push(MANAGED_INCLUDES_TAG)
            sections.push('// These #includes are managed by DCC-Rail-Commander.')
            sections.push('// Do not remove them — they are required for the installer to function correctly.')
            sections.push(...includes)
            sections.push(MANAGED_INCLUDES_TAG)
        }

        if (this.generatedHalDevicesContent.trim()) {
            if (sections.length > 0) sections.push('')
            sections.push(MANAGED_HAL_DEVICES_TAG)
            sections.push('// This HAL Devices block is managed by DCC-Rail-Commander.')
            sections.push('// Do not edit inside this block manually.')
            sections.push(this.generatedHalDevicesContent.trim())
            sections.push(MANAGED_HAL_DEVICES_TAG)
        }

        if (this.preservedAutomationContent.trim()) {
            if (sections.length > 0) sections.push('')
            sections.push(this.preservedAutomationContent.trim())
        }

        return sections.join('\n')
    }

    // ── Custom file management ────────────────────────────────────────────────
    addCustomFile(name: string): void {
        const files = this.installerState.configFiles
        if (files.some(f => f.name === name)) return  // already exists
        // Insert before myAutomation.h if it exists, otherwise push
        const automationIdx = files.findIndex(f => f.name === 'myAutomation.h')
        const newFile = { name, content: `// ${name}\n// Add your custom DCC-EX commands here\n` }
        if (automationIdx !== -1) {
            files.splice(automationIdx, 0, newFile)
        } else {
            files.push(newFile)
        }
        this._syncToInstallerState()
    }

    removeCustomFile(name: string): void {
        if (!this.isCustomFile(name)) return  // refuse to delete built-ins
        const files = this.installerState.configFiles
        const idx = files.findIndex(f => f.name === name)
        if (idx !== -1) files.splice(idx, 1)
        this._syncToInstallerState()
    }

    // ── Initialise from InstallerState.configFiles ────────────────────────────
    loadFromInstallerState(): void {
        const files = this.installerState.configFiles

        // Reset managed state first so reopened sessions never retain stale
        // values from a previously loaded configuration.
        this.configHContent = ''
        this.roster = []
        this.turnouts = []
        this.sensors = []
        this.signals = []
        this.routes = []
        this.sequences = []
        this.eventHandlers = []
        this.aliases = []
        this.preservedAutomationContent = ''
        this.generatedHalDevicesContent = ''
        this.generatedTrackManagerContent = ''
        this.generatedTurnoutDefaultsContent = ''

        let automationContent = ''
        let startupContent = ''
        let aliasesContent: string | null = null
        for (const f of files) {
            if (f.name === 'config.h' || f.name === 'myConfig.h') {
                this.configHContent = f.content
            } else if (f.name === 'myRoster.h') {
                this.roster = parseRosterFromFile(f.content)
            } else if (f.name === 'myTurnouts.h') {
                this.turnouts = parseTurnoutFromFile(f.content)
            } else if (f.name === 'mySensors.h') {
                this.sensors = parseSensorsFromFile(f.content)
            } else if (f.name === 'mySignals.h') {
                this.signals = parseSignalsFromFile(f.content)
            } else if (f.name === 'myRoutes.h') {
                this.routes = parseRoutesFromFile(f.content)
            } else if (f.name === 'mySequences.h') {
                this.sequences = parseSequencesFromFile(f.content)
            } else if (f.name === 'myEvents.h') {
                this.eventHandlers = parseEventHandlersFromFile(f.content)
            } else if (f.name === 'myAliases.h') {
                // Deferred until every other file has been parsed (see below) — alias
                // target validation needs the fully-populated roster/turnouts/etc.
                // collections, and files are not guaranteed to arrive in a fixed order.
                aliasesContent = f.content
            } else if (f.name === 'myAutomation.h') {
                automationContent = f.content
                // Strip managed includes block; preserve the user's custom code
                // so it survives every subsequent auto-regeneration.
                this.preservedAutomationContent = extractAutomationCustomContent(f.content)
                // Rehydrate the HAL Devices managed-block state the same way —
                // otherwise it stays empty until the Accessories row is visited.
                this.generatedHalDevicesContent = extractManagedBlockBody(f.content, MANAGED_HAL_DEVICES_TAG)
            } else if (f.name === 'myStartup.h') {
                startupContent = f.content
                // Rehydrate the TrackManager / Turnout Defaults managed-block
                // state from the file itself — otherwise it stays empty until
                // the Startup row is visited, and the blocks would be dropped
                // on next save.
                this.generatedTrackManagerContent = extractManagedBlockBody(f.content, MANAGED_TRACK_MANAGER_TAG)
                this.generatedTurnoutDefaultsContent = extractManagedBlockBody(f.content, MANAGED_TURNOUT_DEFAULTS_TAG)
            }
        }

        if (aliasesContent !== null) {
            this.aliases = this.normalizeAliasesLenient(parseAliasesFromFile(aliasesContent))
        }

        // ── Legacy migration: myAutomation.h still has TrackManager/Turnout-
        // Defaults managed blocks (pre-myStartup.h format) and no myStartup.h
        // exists yet. Move that content into a new myStartup.h entry so it
        // isn't silently dropped by automationPreview's next regeneration
        // (which no longer emits those blocks into myAutomation.h). Flags
        // hasChanges so the split is visible in the next Save's diff.
        let migrated = false
        if (!files.some(f => f.name === 'myStartup.h') && automationContent) {
            // Tagged form (post-MANAGED_TRACK_MANAGER_TAG, pre-myStartup.h) falls
            // back to the untagged pre-tag legacy form (a bare AUTOSTART block of
            // only SET_TRACK/SET_POWER/POWERON commands — see
            // extractAutomationCustomContent()'s own legacy-strip predicate above,
            // which this mirrors) so genuinely old projects still migrate their
            // track config into myStartup.h instead of losing it silently.
            const legacyTrackManager =
                extractManagedBlockBody(automationContent, MANAGED_TRACK_MANAGER_TAG) ||
                extractLegacyUntaggedTrackManagerBlock(automationContent)
            const legacyTurnoutDefaults = extractManagedBlockBody(automationContent, MANAGED_TURNOUT_DEFAULTS_TAG)
            if (legacyTrackManager || legacyTurnoutDefaults) {
                this.generatedTrackManagerContent = legacyTrackManager
                this.generatedTurnoutDefaultsContent = legacyTurnoutDefaults
                startupContent = this.startupPreview
                files.push({ name: 'myStartup.h', content: startupContent })
                // preservedAutomationContent (set above, from the original
                // automationContent) is already stripped of these blocks, but
                // the myAutomation.h entry's stored content isn't rewritten
                // until the next full sync — without this, the Advanced editor
                // would keep showing the pre-split file (still containing the
                // AUTOSTART blocks verbatim) side by side with the new Startup
                // editor showing the same blocks, until something else (e.g. a
                // Save) triggers _ensureAutomationFile().
                const af = files.find(f => f.name === 'myAutomation.h')
                if (af) af.content = this.automationPreview
                migrated = true
            }
        }

        if (startupContent) {
            const defaultThrownIds = parseDefaultThrownTurnoutIdsFromAutomation(startupContent)
            if (defaultThrownIds.size > 0) {
                this.turnouts = this.turnouts.map(t => ({
                    ...t,
                    defaultState: defaultThrownIds.has(t.id) ? 'THROWN' : 'CLOSED',
                }))
            }
        }

        this._syncGeneratedTurnoutDefaultsContent()
        this.hasChanges = migrated
        // Ensure myRoster.h + myTurnouts.h always appear in the file list
        // so their visual editors are reachable from the sidebar.
        const names = files.map(f => f.name)
        if (!names.includes('myRoster.h')) {
            files.push({ name: 'myRoster.h', content: this.rosterRaw })
        }
        if (!names.includes('myTurnouts.h')) {
            files.push({ name: 'myTurnouts.h', content: this.turnoutsRaw })
        }
        if (!names.includes('mySignals.h')) {
            files.push({ name: 'mySignals.h', content: buildGeneratorHeader('mySignals.h', this.installerState.appVersion) + '\n' })
        }
        if (!names.includes('mySensors.h')) {
            files.push({ name: 'mySensors.h', content: buildGeneratorHeader('mySensors.h', this.installerState.appVersion) + '\n' })
        }
        if (!names.includes('myRoutes.h')) {
            files.push({ name: 'myRoutes.h', content: buildGeneratorHeader('myRoutes.h', this.installerState.appVersion) + '\n' })
        }
        if (!names.includes('mySequences.h')) {
            files.push({ name: 'mySequences.h', content: buildGeneratorHeader('mySequences.h', this.installerState.appVersion) + '\n' })
        }
        if (!names.includes('myEvents.h')) {
            files.push({ name: 'myEvents.h', content: buildGeneratorHeader('myEvents.h', this.installerState.appVersion) + '\n' })
        }
        if (!names.includes('myAliases.h')) {
            files.push({ name: 'myAliases.h', content: buildGeneratorHeader('myAliases.h', this.installerState.appVersion) + '\n' })
        }
        if (!names.includes('myAutomation.h')) {
            files.push({ name: 'myAutomation.h', content: this.automationPreview })
        }
    }

    // ── Write back to InstallerState.configFiles ──────────────────────────────
    private _syncToInstallerState(): void {
        // Rehydrate the HAL Devices / TrackManager blocks from whatever is
        // currently in their raw editors *before* regenerating — this is the
        // only path a direct Monaco edit to those blocks can take to survive
        // a save. Only done here (not in _ensureAutomationFile/
        // _ensureStartupFile) because syncHalDevices()/syncTrackManager() —
        // the two forms' own write paths — call _ensureAutomationFile()/
        // _ensureStartupFile() immediately after setting their field
        // themselves; doing the re-extraction there would clobber that fresh
        // value with the stale pre-update content.
        //
        // generatedTurnoutDefaultsContent is deliberately NOT re-derived here
        // (unlike TrackManager/HAL) — it has no independent write path of its
        // own to protect. It's purely generated from turnouts[].defaultState
        // by _syncGeneratedTurnoutDefaultsContent(), which every turnout
        // mutator (updateTurnoutEntry/addTurnoutEntry/removeTurnoutEntry/
        // setTurnoutsFromRaw) calls immediately before calling this method —
        // re-deriving it here from the *stale* on-disk myStartup.h would
        // clobber that fresh value right back to the pre-mutation content,
        // silently undoing the very change this call is meant to persist.
        const automationFile = this.installerState.configFiles.find(f => f.name === 'myAutomation.h')
        if (automationFile) {
            this.generatedHalDevicesContent = extractManagedBlockBody(automationFile.content, MANAGED_HAL_DEVICES_TAG)
        }
        const startupFile = this.installerState.configFiles.find(f => f.name === 'myStartup.h')
        if (startupFile) {
            this.generatedTrackManagerContent = extractManagedBlockBody(startupFile.content, MANAGED_TRACK_MANAGER_TAG)
        }
        for (const f of this.installerState.configFiles) {
            if (f.name === 'config.h' || f.name === 'myConfig.h') {
                f.content = this._preserveDeviceHeader(this.configHContent, f.content)
            } else if (f.name === 'myRoster.h') {
                f.content = this.rosterRaw
            } else if (f.name === 'myTurnouts.h') {
                f.content = this.turnoutsRaw
            } else if (f.name === 'mySensors.h') {
                f.content = this.sensorsRaw
            } else if (f.name === 'mySignals.h') {
                f.content = this.signalsRaw
            } else if (f.name === 'myRoutes.h') {
                f.content = this.routesRaw
            } else if (f.name === 'mySequences.h') {
                f.content = this.sequencesRaw
            } else if (f.name === 'myEvents.h') {
                f.content = this.eventHandlersRaw
            } else if (f.name === 'myAliases.h') {
                f.content = this.aliasesRaw
            }
            // myAutomation.h / myStartup.h are handled by _ensureAutomationFile /
            // _ensureStartupFile below, which first re-extracts user edits from
            // the current editor content where applicable.
        }
        // Ensure myAutomation.h / myStartup.h exist in configFiles if any
        // managed content is present.
        this._ensureAutomationFile()
        this._ensureStartupFile()
    }

    private _ensureAutomationFile(): void {
        const files = this.installerState.configFiles
        const hasAutomation = files.some(f => f.name === 'myAutomation.h')
        const hasBuiltInContent = (name: string) =>
            this.installerState.configFiles.some(f => f.name === name && f.content.split('\n').some(l => l.trim() && !l.trim().startsWith('//')))
        const needsIt =
            this.roster.length > 0 ||
            this.turnouts.length > 0 ||
            this.customFileNames.length > 0 ||
            this.generatedHalDevicesContent.trim().length > 0 ||
            hasBuiltInContent('mySignals.h') ||
            hasBuiltInContent('mySensors.h') ||
            hasBuiltInContent('myRoutes.h') ||
            hasBuiltInContent('mySequences.h') ||
            hasBuiltInContent('myEvents.h') ||
            hasBuiltInContent('myAliases.h')
        if (!hasAutomation && needsIt) {
            files.push({ name: 'myAutomation.h', content: this.automationPreview })
        } else if (hasAutomation) {
            const af = files.find(f => f.name === 'myAutomation.h')!
            // Re-extract the user's custom code from the current editor content
            // so that direct Monaco edits survive the next auto-regeneration.
            this.preservedAutomationContent = extractAutomationCustomContent(af.content)
            af.content = this.automationPreview
        }
    }

    /**
     * Sibling of _ensureAutomationFile() for myStartup.h. Unlike myAutomation.h,
     * myStartup.h has no free-form/preserved section of its own, so there is no
     * re-extraction step here — a direct raw edit is only re-absorbed via
     * _syncToInstallerState()'s re-derivation (see the ordering-invariant note
     * there), exactly mirroring how _ensureAutomationFile() itself never
     * re-extracts (only _syncToInstallerState() does).
     */
    private _ensureStartupFile(): void {
        const files = this.installerState.configFiles
        const hasStartup = files.some(f => f.name === 'myStartup.h')
        const needsIt =
            this.generatedTrackManagerContent.trim().length > 0 ||
            this.generatedTurnoutDefaultsContent.trim().length > 0
        if (!hasStartup && needsIt) {
            files.push({ name: 'myStartup.h', content: this.startupPreview })
        } else if (hasStartup) {
            const sf = files.find(f => f.name === 'myStartup.h')!
            sf.content = this.startupPreview
        }
    }

    /**
     * Force-creates an empty myStartup.h entry if one doesn't exist yet, so
     * the nav's "Startup" row is reachable/editable even before any
     * TrackManager or Turnout-Defaults content has been generated. Distinct
     * from _ensureStartupFile(), which is purely content-driven and never
     * creates an empty file.
     */
    ensureStartupFileExists(): void {
        const files = this.installerState.configFiles
        if (!files.some(f => f.name === 'myStartup.h')) {
            const automationIdx = files.findIndex(f => f.name === 'myAutomation.h')
            const entry = { name: 'myStartup.h', content: this.startupPreview }
            if (automationIdx !== -1) {
                files.splice(automationIdx, 0, entry)
            } else {
                files.push(entry)
            }
        }
    }

    /**
     * Returns `newContent` with the device-identification header block preserved
     * from `existingContent` when the new content lacks one but the selected
     * device has an FQBN.
     */
    private _preserveDeviceHeader(newContent: string, existingContent: string): string {
        if (!hasDeviceHeader(newContent)) {
            const device = this.installerState.selectedDevice
            if (device?.fqbn) {
                return injectDeviceHeader(newContent, device)
            }
            // Fall back: re-use whatever header was already on disk
            if (hasDeviceHeader(existingContent)) {
                const headerEnd = existingContent.indexOf('// ==== End DCC-Rail-Commander Device Configuration ====')
                if (headerEnd !== -1) {
                    const headerBlock = existingContent.slice(0, headerEnd + '// ==== End DCC-Rail-Commander Device Configuration ===='.length + 1)
                    return headerBlock + newContent
                }
            }
        }
        return newContent
    }

    syncConfigH(): void {
        this.hasChanges = true
        for (const f of this.installerState.configFiles) {
            if (f.name === 'config.h' || f.name === 'myConfig.h') {
                f.content = this._preserveDeviceHeader(this.configHContent, f.content)
            }
        }
    }

    /** Called by hal-devices-form on every edit. Same shape as syncTrackManager(). */
    syncHalDevices(content: string): void {
        this.generatedHalDevicesContent = content.trim()
        this.hasChanges = true
        this._ensureAutomationFile()
    }

    syncTrackManager(trackManagerContent: string): void {
        // Normalize legacy generator output: drop file header line if present.
        const normalized = trackManagerContent
            .replace(/^\/\/\s*myStartup\.h\s*-\s*Generated by DCC-Rail-Commander\s*\n?/m, '')
            .trim()
        this.generatedTrackManagerContent = normalized
        this.hasChanges = true
        this._ensureStartupFile()
    }

    private _syncGeneratedTurnoutDefaultsContent(): void {
        const thrownIds = Array.from(new Set(
            this.turnouts
                .filter(t => t.defaultState === 'THROWN')
                .map(t => t.id),
        )).sort((a, b) => a - b)

        if (thrownIds.length === 0) {
            this.generatedTurnoutDefaultsContent = ''
            return
        }

        this.generatedTurnoutDefaultsContent = [
            'AUTOSTART',
            ...thrownIds.map(id => `  THROW(${id})`),
            'DONE',
        ].join('\n')
    }

    /**
     * Ensures all in-memory parsed state (roster, turnouts, config.h) is
     * written back into InstallerState.configFiles.  Call this before saving
     * so that files added by loadFromInstallerState() (e.g. after loading an
     * external folder) get the generator header and latest serialized content.
     */
    syncAll(): void {
        this.hasChanges = true
        this._syncToInstallerState()
    }

    /** Call after a successful save to disk to clear the dirty flag. */
    clearChanges(): void {
        this.hasChanges = false
    }
}
