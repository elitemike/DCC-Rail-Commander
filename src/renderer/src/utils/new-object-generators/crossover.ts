import type { EventHandlerEntry, VirtualTurnout } from '../myAutomationParser'

export interface CrossoverMember {
    /** Numeric turnout id — used for de-duplication and validation. */
    id: number
    /** What to emit inside THROW()/CLOSE(): the turnout's alias name when it has one, otherwise its id. */
    ref: string | number
}

export interface CrossoverOptions {
    masterId: number
    masterName: string
    /** What to emit inside ONTHROW()/ONCLOSE(): the master's alias name when set, otherwise its id. */
    masterRef: string | number
    members: CrossoverMember[]
}

export interface CrossoverResult {
    turnout: VirtualTurnout
    handlers: EventHandlerEntry[]
}

export const MIN_CROSSOVER_MEMBERS = 2

/** Returns an error message, or null when the options are valid. */
export function validateCrossover(opts: CrossoverOptions, existingTurnoutIds: number[]): string | null {
    if (!Number.isInteger(opts.masterId) || opts.masterId < 0) return 'Turnout ID must be a whole number of 0 or more.'
    if (existingTurnoutIds.includes(opts.masterId)) return `Turnout ID ${opts.masterId} is already in use.`
    if (opts.members.some(m => m.id === opts.masterId)) return 'The combined turnout cannot be one of its own members.'
    const unique = new Set(opts.members.map(m => m.id))
    if (unique.size < MIN_CROSSOVER_MEMBERS) return `Select at least ${MIN_CROSSOVER_MEMBERS} turnouts to combine.`
    if (unique.size !== opts.members.length) return 'A turnout was selected more than once.'
    return null
}

/**
 * Builds the virtual "master" turnout plus the ONTHROW/ONCLOSE handlers that make every member follow it.
 * Pure — callers apply the result through ConfigEditorState so file regeneration stays in one place.
 */
export function buildCrossover(opts: CrossoverOptions): CrossoverResult {
    const name = opts.masterName.trim()
    const turnout: VirtualTurnout = {
        type: 'VIRTUAL',
        id: opts.masterId,
        description: name,
        defaultState: 'CLOSED',
    }
    const handler = (command: 'ONTHROW' | 'ONCLOSE', action: 'THROW' | 'CLOSE'): EventHandlerEntry => ({
        command,
        text: [
            `${command}(${opts.masterRef})`,
            ...opts.members.map(m => `${action}(${m.ref})`),
            'DONE',
        ].join('\n'),
        name: name ? `${name} (${action === 'THROW' ? 'throw' : 'close'} members)` : undefined,
    })
    return { turnout, handlers: [handler('ONTHROW', 'THROW'), handler('ONCLOSE', 'CLOSE')] }
}
