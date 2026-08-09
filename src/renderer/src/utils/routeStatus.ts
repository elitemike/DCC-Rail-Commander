export type RouteStatus = 'MATCHED' | 'MISMATCHED' | 'UNKNOWN'
export type TurnoutLiveState = 'THROWN' | 'CLOSED' | 'UNKNOWN'

export interface RouteTurnoutCommand {
    id: number
    state: 'THROWN' | 'CLOSED'
}

/** Resolves a THROW/CLOSE argument that isn't a plain number (an ALIAS name) to a turnout id. Returns undefined if it can't be resolved. */
export type TurnoutAliasResolver = (name: string) => number | undefined

const TOKEN_RE = /\b(THROW|CLOSE)\s*\(\s*([A-Za-z_]\w*|\d+)\s*\)/g

/**
 * Scans a route's raw EX-RAIL body for THROW(...)/CLOSE(...) calls, in
 * order. Each argument is either a numeric turnout id or an ALIAS name —
 * EX-RAIL routes can freely mix both. Numeric arguments resolve directly;
 * alias arguments are resolved via `resolveAlias` — skipped if it's omitted
 * or can't resolve the name, same as an unconfigured numeric id would be.
 * Shared by deriveRouteStatus (compare against live state) and
 * ThrottleService.triggerRoute (replay as explicit <T id state> commands).
 */
export function parseRouteTurnoutCommands(body: string, resolveAlias?: TurnoutAliasResolver): RouteTurnoutCommand[] {
    const out: RouteTurnoutCommand[] = []
    for (const match of body.matchAll(TOKEN_RE)) {
        const token = match[2]
        const id = /^\d+$/.test(token) ? Number(token) : resolveAlias?.(token)
        if (id === undefined) continue
        out.push({ id, state: match[1] === 'THROW' ? 'THROWN' : 'CLOSED' })
    }
    return out
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
export function deriveRouteStatus(
    body: string,
    liveStates: ReadonlyMap<number, TurnoutLiveState>,
    resolveAlias?: TurnoutAliasResolver,
): RouteStatus {
    let sawUnknown = false
    let sawAny = false

    for (const { id, state: expected } of parseRouteTurnoutCommands(body, resolveAlias)) {
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
