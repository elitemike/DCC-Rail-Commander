export type RouteStatus = 'MATCHED' | 'MISMATCHED' | 'UNKNOWN'
export type TurnoutLiveState = 'THROWN' | 'CLOSED' | 'UNKNOWN'

export interface RouteTurnoutCommand {
    id: number
    state: 'THROWN' | 'CLOSED'
}

const TOKEN_RE = /\b(THROW|CLOSE)\s*\(\s*(\d+)\s*\)/g

/**
 * Scans a route's raw EX-RAIL body for numeric THROW(id)/CLOSE(id) calls, in
 * order. Alias-referenced turnouts (THROW(myAlias)) aren't resolved and are
 * skipped. Shared by deriveRouteStatus (compare against live state) and
 * ThrottleService.triggerRoute (replay as explicit <T id state> commands).
 */
export function parseRouteTurnoutCommands(body: string): RouteTurnoutCommand[] {
    return Array.from(body.matchAll(TOKEN_RE), (match) => ({
        id: Number(match[2]),
        state: match[1] === 'THROW' ? ('THROWN' as const) : ('CLOSED' as const),
    }))
}

/**
 * Derives a route's status by comparing each turnout referenced in its body
 * (see parseRouteTurnoutCommands) to its expected vs. live state.
 *
 * Precedence: any confirmed mismatch wins outright (MISMATCHED); otherwise any
 * referenced turnout whose live state isn't known yet makes the whole route
 * UNKNOWN; only when every referenced turnout is live and matches is the
 * route MATCHED.
 */
export function deriveRouteStatus(body: string, liveStates: ReadonlyMap<number, TurnoutLiveState>): RouteStatus {
    let sawUnknown = false
    let sawAny = false

    for (const { id, state: expected } of parseRouteTurnoutCommands(body)) {
        sawAny = true
        const live = liveStates.get(id) ?? 'UNKNOWN'

        if (live === 'UNKNOWN') {
            sawUnknown = true
        } else if (live !== expected) {
            return 'MISMATCHED'
        }
    }

    if (!sawAny || sawUnknown) return 'UNKNOWN'
    return 'MATCHED'
}
