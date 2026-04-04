import { observable, resolve } from 'aurelia'
import { InstallerState } from './installer-state'
import type {
    Roster,
    Turnout,
    RosterFunction,
    SensorEntry,
    SignalEntry,
    RouteEntry,
    SequenceEntry,
    AliasEntry,
} from '../utils/myAutomationParser'
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
    parseAliasesFromFile,
    serializeAliasesToFile,
    parseDefaultThrownTurnoutIdsFromAutomation,
} from '../utils/myAutomationParser'

/**
 * Open/close tag that delimits the auto-managed #include block at the top of
 * myAutomation.h.  The same string is used for both the opening and closing
 * line, matching the pattern used by the device header in config.h.
 */
export const MANAGED_INCLUDES_TAG = '// ==== EX-Installer Required Includes ===='
export const MANAGED_TRACK_MANAGER_TAG = '// ==== EX-Installer TrackManager ===='
export const MANAGED_TURNOUT_DEFAULTS_TAG = '// ==== EX-Installer Turnout Defaults ===='

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

    // Backward-compat migration: strip legacy generated AUTOSTART blocks
    // that were previously inserted without managed tags.
    text = text.replace(/AUTOSTART\s*\n([\s\S]*?)\nDONE\s*/g, (full, body: string) => {
        const isGeneratedTrackManager = /SET_TRACK\([A-D],|SET_POWER\([A-D],|POWERON/.test(body)
        return isGeneratedTrackManager ? '' : full
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

    // ── Unsaved-changes tracking ──────────────────────────────────────────────
    hasChanges = false

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
            this.turnouts = parseTurnoutFromFile(text)
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

    // ── myAliases.h ───────────────────────────────────────────────────────
    @observable aliases: AliasEntry[] = []

    get aliasesRaw(): string {
        const header = buildGeneratorHeader('myAliases.h', this.installerState.appVersion)
        const serialized = serializeAliasesToFile(this.aliases)
        return `${header}\n${serialized}`
    }

    setAliasesFromRaw(text: string): void {
        try {
            this.aliases = parseAliasesFromFile(text)
            this.hasChanges = true
        } catch {
            // keep existing aliases if parse fails
        }
        this._syncToInstallerState()
    }

    // ── Preserved content (non-ROSTER/TURNOUT lines from imported myAutomation.h)
    preservedAutomationContent = ''

    // ── Generated track manager AUTOSTART section ────────────────────────────
    generatedTrackManagerContent = ''

    // ── Generated turnout defaults AUTOSTART section ─────────────────────────
    generatedTurnoutDefaultsContent = ''

    /** Names of the four built-in managed files — never auto-included */
    private static readonly BUILTIN = new Set([
        'config.h',
        'myRoster.h',
        'myTurnouts.h',
        'mySignals.h',
        'mySensors.h',
        'myRoutes.h',
        'mySequences.h',
        'myAliases.h',
        'myAutomation.h',
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

    // ── Generated myAutomation.h preview ─────────────────────────────────────
    get automationPreview(): string {
        const includes: string[] = []
        if (this.roster.length > 0) includes.push('#include "myRoster.h"')
        if (this.turnouts.length > 0) includes.push('#include "myTurnouts.h"')
        // Built-in managed files (besides roster/turnouts) should be included
        // when they contain any non-comment user content.
        const hasUserContent = (name: string): boolean => {
            const f = this.installerState.configFiles.find(cf => cf.name === name)
            if (!f) return false
            return f.content.split('\n').some(l => l.trim() && !l.trim().startsWith('//'))
        }
        for (const name of ['mySignals.h', 'mySensors.h', 'myRoutes.h', 'mySequences.h', 'myAliases.h']) {
            if (hasUserContent(name)) includes.push(`#include "${name}"`)
        }

        for (const name of this.customFileNames) {
            includes.push(`#include "${name}"`)
        }

        const sections: string[] = []

        if (includes.length > 0) {
            sections.push(MANAGED_INCLUDES_TAG)
            sections.push('// These #includes are managed by EX-Installer.')
            sections.push('// Do not remove them — they are required for the installer to function correctly.')
            sections.push(...includes)
            sections.push(MANAGED_INCLUDES_TAG)
        }

        if (this.generatedTrackManagerContent.trim()) {
            if (sections.length > 0) sections.push('')
            sections.push(MANAGED_TRACK_MANAGER_TAG)
            sections.push('// This TrackManager block is managed by EX-Installer.')
            sections.push('// Do not edit inside this block manually.')
            sections.push(this.generatedTrackManagerContent.trim())
            sections.push(MANAGED_TRACK_MANAGER_TAG)
        }

        if (this.generatedTurnoutDefaultsContent.trim()) {
            if (sections.length > 0) sections.push('')
            sections.push(MANAGED_TURNOUT_DEFAULTS_TAG)
            sections.push('// This turnout-defaults block is managed by EX-Installer.')
            sections.push('// Do not edit inside this block manually.')
            sections.push(this.generatedTurnoutDefaultsContent.trim())
            sections.push(MANAGED_TURNOUT_DEFAULTS_TAG)
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
        let automationContent = ''
        for (const f of files) {
            if (f.name === 'config.h' || f.name === 'myConfig.h') {
                this.configHContent = f.content
            } else if (f.name === 'myRoster.h') {
                this.roster = parseRosterFromFile(f.content)
            } else if (f.name === 'myTurnouts.h') {
                this.turnouts = parseTurnoutFromFile(f.content)
            } else if (f.name === 'myAutomation.h') {
                automationContent = f.content
                // Strip managed includes block; preserve the user's custom code
                // so it survives every subsequent auto-regeneration.
                this.preservedAutomationContent = extractAutomationCustomContent(f.content)
            }
        }

        if (automationContent) {
            const defaultThrownIds = parseDefaultThrownTurnoutIdsFromAutomation(automationContent)
            if (defaultThrownIds.size > 0) {
                this.turnouts = this.turnouts.map(t => ({
                    ...t,
                    defaultState: defaultThrownIds.has(t.id) ? 'THROWN' : 'NORMAL',
                }))
            }
        }

        this._syncGeneratedTurnoutDefaultsContent()
        this.hasChanges = false
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
        if (!names.includes('myAliases.h')) {
            files.push({ name: 'myAliases.h', content: buildGeneratorHeader('myAliases.h', this.installerState.appVersion) + '\n' })
        }
        if (!names.includes('myAutomation.h')) {
            files.push({ name: 'myAutomation.h', content: this.automationPreview })
        }
    }

    // ── Write back to InstallerState.configFiles ──────────────────────────────
    private _syncToInstallerState(): void {
        for (const f of this.installerState.configFiles) {
            if (f.name === 'config.h' || f.name === 'myConfig.h') {
                f.content = this.configHContent
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
            } else if (f.name === 'myAliases.h') {
                f.content = this.aliasesRaw
            }
            // myAutomation.h is handled by _ensureAutomationFile below,
            // which first re-extracts user edits from the current editor content.
        }
        // Ensure myAutomation.h exists in configFiles if any managed content present
        this._ensureAutomationFile()
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
            hasBuiltInContent('mySignals.h') ||
            hasBuiltInContent('mySensors.h') ||
            hasBuiltInContent('myRoutes.h') ||
            hasBuiltInContent('mySequences.h') ||
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

    syncConfigH(): void {
        this.hasChanges = true
        for (const f of this.installerState.configFiles) {
            if (f.name === 'config.h' || f.name === 'myConfig.h') {
                f.content = this.configHContent
            }
        }
    }

    syncTrackManager(trackManagerContent: string): void {
        // Normalize legacy generator output: drop file header line if present.
        const normalized = trackManagerContent
            .replace(/^\/\/\s*myAutomation\.h\s*-\s*Generated by EX-Installer\s*\n?/m, '')
            .trim()
        this.generatedTrackManagerContent = normalized
        this.hasChanges = true
        this._ensureAutomationFile()
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
        this._syncToInstallerState()
    }

    /** Call after a successful save to disk to clear the dirty flag. */
    clearChanges(): void {
        this.hasChanges = false
    }
}
