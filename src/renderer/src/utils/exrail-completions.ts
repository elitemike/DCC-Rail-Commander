import type {
    AliasEntry,
    AliasTargetType,
    ObjectIdCollections,
    SignalEntry,
} from './myAutomationParser'
import {
    inferAliasTypes,
    parseAliasNumericValue,
} from './myAutomationParser'
import { BLOCK_REGISTRY } from '../components/visual-editors/exrail-block-registry'
import type { BlockParamKind, RefOption } from '../components/visual-editors/exrail-block-compiler'

export interface ExrailCompletionData extends ObjectIdCollections {
    aliases: AliasEntry[]
    /** Only Roster/Turnout/Sensor/Route/Sequence/Automation can be an ALIAS target (see AliasTargetType) — signals and tracks have no alias mechanism, so they're plain live-object lists here, not part of ObjectIdCollections. */
    signals?: SignalEntry[]
    tracks?: RefOption[]
}

export interface ExrailCommandContext {
    command: string
    argumentIndex: number
}

export interface ExrailSymbolSuggestion {
    label: string
    insertText: string
    detail: string
    documentation: string
    kind: 'alias' | 'id'
    sortText: string
}

const EXRAIL_FILENAMES = new Set(['myAutomation.h', 'myStartup.h', 'myRoutes.h', 'mySequences.h', 'myEvents.h'])

/**
 * A command argument can reference a live configured object of one of these kinds. Signal/Track
 * aren't `AliasTargetType`s (no alias mechanism covers them — see ExrailCompletionData above), so
 * this is its own, slightly wider union used only for completion/validation purposes.
 */
export type ExrailRefKind = AliasTargetType | 'Signal' | 'Track'

const REF_PARAM_KIND_TO_REF_KINDS: Partial<Record<BlockParamKind, ExrailRefKind[]>> = {
    turnoutRef: ['Turnout'],
    sensorRef: ['Sensor'],
    rosterRef: ['Roster'],
    routeOrSequenceRef: ['Route', 'Sequence'],
    signalRef: ['Signal'],
    trackRef: ['Track'],
}

/**
 * command -> per-argument-index param kind, derived once from BLOCK_REGISTRY — the block canvas's
 * own single source of truth for every EXRAIL command it supports, including param-flavored hats
 * (ONSENSOR, ONACTIVATE, ...), whose header args are exactly as reference-y as a body statement's.
 * Replaces a hand-maintained per-command switch that had already drifted out of sync with the
 * registry (e.g. TOGGLE_TURNOUT/AFTEROVERLOAD never got completion/validation support even though
 * both take a turnoutRef/trackRef param) — deriving from the registry means a new command can
 * never silently miss this again.
 */
const COMMAND_PARAM_KINDS = new Map<string, BlockParamKind[]>(
    BLOCK_REGISTRY
        .filter(def => def.shape !== 'hat' || def.paramFlavoredHat)
        .map(def => [def.id, def.params.map(p => p.kind)]),
)

/** Every EXRAIL command with at least one argument that references a configured object. */
export const EXRAIL_REFERENCE_COMMANDS = Array.from(COMMAND_PARAM_KINDS.entries())
    .filter(([, kinds]) => kinds.some(k => k in REF_PARAM_KIND_TO_REF_KINDS))
    .map(([id]) => id)

function getArgumentIndex(argumentText: string): number {
    const trimmed = argumentText.trim()
    if (trimmed === '') return 0
    return argumentText.split(',').length - 1
}

export function getTargetTypes(command: string, argumentIndex: number): ExrailRefKind[] {
    const kind = COMMAND_PARAM_KINDS.get(command)?.[argumentIndex]
    if (!kind) return []
    return REF_PARAM_KIND_TO_REF_KINDS[kind] ?? []
}

function getObjectSuggestionsForType(type: ExrailRefKind, data: ExrailCompletionData): ExrailSymbolSuggestion[] {
    switch (type) {
        case 'Roster':
            return data.roster.map(entry => ({
                label: String(entry.dccAddress),
                insertText: String(entry.dccAddress),
                detail: `Roster ID - ${entry.name || `Roster ${entry.dccAddress}`}`,
                documentation: `Use roster address ${entry.dccAddress}${entry.name ? ` (${entry.name})` : ''}.`,
                kind: 'id',
                sortText: `1-${String(entry.dccAddress).padStart(6, '0')}`,
            }))
        case 'Turnout':
            return data.turnouts.map(entry => ({
                label: String(entry.id),
                insertText: String(entry.id),
                detail: `Turnout ID - ${entry.description || `Turnout ${entry.id}`}`,
                documentation: `Use turnout ID ${entry.id}${entry.description ? ` (${entry.description})` : ''}.`,
                kind: 'id',
                sortText: `1-${String(entry.id).padStart(6, '0')}`,
            }))
        case 'Sensor':
            return (data.sensors ?? []).map(entry => ({
                label: String(entry.id),
                insertText: String(entry.id),
                detail: `Sensor ID - ${entry.description || `Sensor ${entry.id}`}`,
                documentation: `Use sensor ID ${entry.id}${entry.description ? ` (${entry.description})` : ''}.`,
                kind: 'id',
                sortText: `1-${String(entry.id).padStart(6, '0')}`,
            }))
        case 'Route':
            return (data.routes ?? []).map(entry => ({
                label: String(entry.id),
                insertText: String(entry.id),
                detail: `Route ID - ${entry.description || `Route ${entry.id}`}`,
                documentation: `Use route ID ${entry.id}${entry.description ? ` (${entry.description})` : ''}.`,
                kind: 'id',
                sortText: `1-${String(entry.id).padStart(6, '0')}`,
            }))
        case 'Sequence':
            return (data.sequences ?? []).map(entry => ({
                label: String(entry.id),
                insertText: String(entry.id),
                detail: `Sequence ID - ${entry.description || `Sequence ${entry.id}`}`,
                documentation: `Use sequence ID ${entry.id}${entry.description ? ` (${entry.description})` : ''}.`,
                kind: 'id',
                sortText: `1-${String(entry.id).padStart(6, '0')}`,
            }))
        case 'Automation':
            return (data.automations ?? []).map(entry => ({
                label: String(entry.id),
                insertText: String(entry.id),
                detail: `Automation ID - ${entry.description || `Automation ${entry.id}`}`,
                documentation: `Use automation ID ${entry.id}${entry.description ? ` (${entry.description})` : ''}.`,
                kind: 'id',
                sortText: `1-${String(entry.id).padStart(6, '0')}`,
            }))
        case 'Signal':
            // A PIN signal has no id of its own — RED(...)/AMBER(...)/GREEN(...) address it by
            // its red pin, matching exrail-block-compiler.ts's optionsForRefKind() convention. A
            // DCC_SIGNAL has a real id, used the same way.
            return (data.signals ?? []).map(entry => {
                const id = entry.type === 'DCC' ? entry.id : entry.red
                return {
                    label: String(id),
                    insertText: String(id),
                    detail: `Signal ID - ${entry.description || `Signal ${id}`}`,
                    documentation: `Use signal ID ${id}${entry.description ? ` (${entry.description})` : ''}.`,
                    kind: 'id' as const,
                    sortText: `1-${String(id).padStart(6, '0')}`,
                }
            })
        case 'Track':
            // Not alias-eligible (no ALIAS mechanism covers tracks) and not a numeric id — a bare
            // letter (A/B/C/D), so it sorts/sanitizes differently from every other ref kind here.
            return (data.tracks ?? []).map(entry => ({
                label: String(entry.value),
                insertText: String(entry.value),
                detail: `Track - ${entry.label}`,
                documentation: `Use track ${entry.value} (${entry.label}).`,
                kind: 'id',
                sortText: `1-${String(entry.value)}`,
            }))
    }
}

function getAliasSuggestions(targetTypes: AliasTargetType[], data: ExrailCompletionData): ExrailSymbolSuggestion[] {
    return data.aliases
        .filter(alias => {
            const aliasTypes = alias.aliasType ? [alias.aliasType] : inferAliasTypes(alias, data)
            return aliasTypes.some(type => targetTypes.includes(type))
        })
        .map(alias => {
            const numericValue = parseAliasNumericValue(alias.value)
            const aliasTypes = alias.aliasType ? [alias.aliasType] : inferAliasTypes(alias, data)
            const typeLabel = aliasTypes.join('/') || 'ID'

            return {
                label: alias.name,
                insertText: alias.name,
                detail: `Alias - ${typeLabel} ${alias.value}`,
                documentation: numericValue === null
                    ? `${alias.name} expands to ${alias.value}.`
                    : `${alias.name} expands to ${numericValue} (${typeLabel}).`,
                kind: 'alias',
                sortText: `0-${alias.name}`,
            }
        })
}

/**
 * Strips a `#<suffix>` off a filename — used for per-row scoped Monaco models
 * (e.g. `mySequences.h#42` for the SEQUENCE(42) row's own editor) so they're
 * still recognized as the underlying real file for completion/hover/diagnostics.
 */
export function baseFilename(filename: string): string {
    const i = filename.indexOf('#')
    return i === -1 ? filename : filename.slice(0, i)
}

export function isExrailCompletionFile(filename: string): boolean {
    return EXRAIL_FILENAMES.has(baseFilename(filename))
}

export function getExrailCommandContext(linePrefix: string): ExrailCommandContext | null {
    const match = linePrefix.match(/([A-Z_]+)\(\s*([^()]*)$/)
    if (!match) return null

    return {
        command: match[1].toUpperCase(),
        argumentIndex: getArgumentIndex(match[2]),
    }
}

export function buildExrailSymbolSuggestions(
    filename: string,
    linePrefix: string,
    data: ExrailCompletionData,
): ExrailSymbolSuggestion[] {
    if (!isExrailCompletionFile(filename)) return []

    const context = getExrailCommandContext(linePrefix)
    if (!context) return []

    const targetTypes = getTargetTypes(context.command, context.argumentIndex)
    if (targetTypes.length === 0) return []

    // Signal/Track have no ALIAS mechanism (see ExrailCompletionData's doc comment) — only the
    // alias-eligible subset goes through getAliasSuggestions().
    const aliasEligibleTypes = targetTypes.filter((t): t is AliasTargetType => t !== 'Signal' && t !== 'Track')

    const suggestions = [
        ...getAliasSuggestions(aliasEligibleTypes, data),
        ...targetTypes.flatMap(type => getObjectSuggestionsForType(type, data)),
    ]

    const deduped = new Map<string, ExrailSymbolSuggestion>()
    for (const suggestion of suggestions) {
        deduped.set(`${suggestion.kind}:${suggestion.label}:${suggestion.detail}`, suggestion)
    }
    return Array.from(deduped.values())
}