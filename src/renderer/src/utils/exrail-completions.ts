import type {
    AliasEntry,
    AliasTargetType,
    ObjectIdCollections,
} from './myAutomationParser'
import {
    inferAliasTypes,
    parseAliasNumericValue,
} from './myAutomationParser'

export interface ExrailCompletionData extends ObjectIdCollections {
    aliases: AliasEntry[]
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

const EXRAIL_FILENAMES = new Set(['myAutomation.h', 'myRoutes.h', 'mySequences.h'])

function getArgumentIndex(argumentText: string): number {
    const trimmed = argumentText.trim()
    if (trimmed === '') return 0
    return argumentText.split(',').length - 1
}

function getTargetTypes(command: string, argumentIndex: number): AliasTargetType[] {
    switch (command) {
        case 'AT':
        case 'AFTER':
        case 'IFOCCUPIED':
        case 'IF':
        case 'ONBUTTON':
        case 'ONSENSOR':
            return argumentIndex === 0 ? ['Sensor'] : []
        case 'THROW':
        case 'CLOSE':
        case 'ONTHROW':
        case 'ONCLOSE':
            return argumentIndex === 0 ? ['Turnout'] : []
        case 'ROUTE_ACTIVE':
        case 'ROUTE_INACTIVE':
        case 'ROUTE_HIDDEN':
        case 'ROUTE_DISABLED':
        case 'IFROUTE_ACTIVE':
        case 'IFROUTE_INACTIVE':
        case 'IFROUTE_HIDDEN':
        case 'IFROUTE_DISABLED':
            return argumentIndex === 0 ? ['Route'] : []
        case 'SETLOCO':
            return argumentIndex === 0 ? ['Roster'] : []
        case 'START':
        case 'FOLLOW':
            return argumentIndex === 0 ? ['Route', 'Sequence'] : []
        case 'SENDLOCO':
            if (argumentIndex === 0) return ['Roster']
            if (argumentIndex === 1) return ['Route', 'Sequence']
            return []
        default:
            return []
    }
}

function getObjectSuggestionsForType(type: AliasTargetType, data: ExrailCompletionData): ExrailSymbolSuggestion[] {
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
                detail: `Sequence ID - Sequence ${entry.id}`,
                documentation: `Use sequence ID ${entry.id}.`,
                kind: 'id',
                sortText: `1-${String(entry.id).padStart(6, '0')}`,
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

export function isExrailCompletionFile(filename: string): boolean {
    return EXRAIL_FILENAMES.has(filename)
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

    const suggestions = [
        ...getAliasSuggestions(targetTypes, data),
        ...targetTypes.flatMap(type => getObjectSuggestionsForType(type, data)),
    ]

    const deduped = new Map<string, ExrailSymbolSuggestion>()
    for (const suggestion of suggestions) {
        deduped.set(`${suggestion.kind}:${suggestion.label}:${suggestion.detail}`, suggestion)
    }
    return Array.from(deduped.values())
}