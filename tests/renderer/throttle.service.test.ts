import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    ThrottleService,
    decodeSpeedByte,
    decodeFunctionMap,
    MAX_FUNCTIONS,
    type ThrottleCabState,
    type TurnoutStatus,
    type RouteStatusEntry,
} from '../../src/renderer/src/services/throttle.service'
import type { Turnout, RouteEntry } from '../../src/renderer/src/utils/myAutomationParser'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeService(
    port: string | null = '/dev/ttyACM1',
    configOverrides: { turnouts?: Turnout[]; routes?: RouteEntry[] } = {},
) {
    const service = Object.create(ThrottleService.prototype) as ThrottleService
    const write = vi.fn().mockResolvedValue(undefined)

    Object.assign(service, {
        state: { selectedDevice: port ? { port } : null },
        usb: { write },
        configEditorState: {
            turnouts: configOverrides.turnouts ?? [],
            routes: configOverrides.routes ?? [],
        },
        throttles: [] as ThrottleCabState[],
        trackPower: null as boolean | null,
        turnoutStatuses: [] as TurnoutStatus[],
        routeStatuses: [] as RouteStatusEntry[],
        writeQueue: Promise.resolve(),
    })

    return { service, write }
}

function makeTurnout(id: number): Turnout {
    return { id, description: `Turnout ${id}`, defaultState: 'CLOSED', type: 'PIN', pin: 1 }
}

function makeRoute(id: number, body: string): RouteEntry {
    return { id, description: `Route ${id}`, body }
}

// Several tests below use fake timers to drive the UNKNOWN -> CLOSED grace
// period without actually waiting — always restore real timers afterward so
// a failure mid-test can't leak fake-timer state into later test files.
afterEach(() => {
    vi.useRealTimers()
})

/** Awaits the service's internal write queue directly, so assertions don't race pending `_send()` chains (e.g. the one `acquire()` already queued). */
async function flush(service: ThrottleService): Promise<void> {
    await (service as unknown as { writeQueue: Promise<void> }).writeQueue
}

// ── decodeSpeedByte ─────────────────────────────────────────────────────────

describe('decodeSpeedByte', () => {
    it('decodes reverse stop (0) as speed 0, direction 0', () => {
        expect(decodeSpeedByte(0)).toEqual({ speed: 0, direction: 0 })
    })

    it('decodes reverse e-stop (1) as speed 0, direction 0', () => {
        expect(decodeSpeedByte(1)).toEqual({ speed: 0, direction: 0 })
    })

    it('decodes a mid-range reverse speed', () => {
        // byte 52 -> speed 51, reverse
        expect(decodeSpeedByte(52)).toEqual({ speed: 51, direction: 0 })
    })

    it('decodes forward stop (128) as speed 0, direction 1', () => {
        expect(decodeSpeedByte(128)).toEqual({ speed: 0, direction: 1 })
    })

    it('decodes forward e-stop (129) as speed 0, direction 1', () => {
        expect(decodeSpeedByte(129)).toEqual({ speed: 0, direction: 1 })
    })

    it('decodes a mid-range forward speed', () => {
        // byte 180 -> speed 51, forward
        expect(decodeSpeedByte(180)).toEqual({ speed: 51, direction: 1 })
    })

    it('decodes max forward speed (255) as 126', () => {
        expect(decodeSpeedByte(255)).toEqual({ speed: 126, direction: 1 })
    })
})

// ── decodeFunctionMap ───────────────────────────────────────────────────────

describe('decodeFunctionMap', () => {
    it('decodes bit 0 as F0 active', () => {
        const fns = decodeFunctionMap(0b1)
        expect(fns[0]).toBe(true)
        expect(fns[1]).toBe(false)
    })

    it('decodes multiple set bits', () => {
        const fns = decodeFunctionMap(0b1010)
        expect(fns[1]).toBe(true)
        expect(fns[3]).toBe(true)
        expect(fns[0]).toBe(false)
        expect(fns[2]).toBe(false)
    })

    it('returns MAX_FUNCTIONS entries by default', () => {
        expect(decodeFunctionMap(0)).toHaveLength(MAX_FUNCTIONS)
    })
})

// ── acquire / release ──────────────────────────────────────────────────────

describe('ThrottleService.acquire / release', () => {
    it('adds a new cab with defaults and requests its current state', async () => {
        const { service, write } = makeService()

        service.acquire(3, 'Thomas')

        expect(service.throttles).toHaveLength(1)
        expect(service.throttles[0]).toMatchObject({ cab: 3, name: 'Thomas', speed: 0, direction: 1 })
        expect(service.throttles[0].functions).toHaveLength(MAX_FUNCTIONS)

        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<t 3>\n')
    })

    it('falls back to "Cab N" when no name is given', () => {
        const { service } = makeService()
        service.acquire(7)
        expect(service.throttles[0].name).toBe('Cab 7')
    })

    it('is a no-op when the cab is already acquired', () => {
        const { service } = makeService()
        service.acquire(3, 'Thomas')
        service.acquire(3, 'Different Name')
        expect(service.throttles).toHaveLength(1)
        expect(service.throttles[0].name).toBe('Thomas')
    })

    it('release() removes only the matching cab, leaving others untouched', () => {
        const { service } = makeService()
        service.acquire(3)
        service.acquire(5)
        service.release(3)
        expect(service.throttles.map((t) => t.cab)).toEqual([5])
    })

    it('acquire() does nothing to the array identity used by other cabs (mutated in place, not reassigned)', () => {
        const { service } = makeService()
        const before = service.throttles
        service.acquire(3)
        // Same array reference — repeat.for relies on push()/splice() being observed
        // on this exact instance rather than a wholesale re-assignment.
        expect(service.throttles).toBe(before)
    })
})

// ── setSpeed / setFunction ───────────────────────────────────────────────────

describe('ThrottleService.setSpeed', () => {
    it('sends <t cab speed dir> and clamps to 0-126', async () => {
        const { service, write } = makeService()
        service.acquire(3)

        service.setSpeed(3, 200, 1)
        expect(service.throttles[0].speed).toBe(126)
        expect(service.throttles[0].direction).toBe(1)

        await flush(service)
        expect(write).toHaveBeenLastCalledWith('/dev/ttyACM1', '<t 3 126 1>\n')
    })

    it('clamps negative speed to 0', () => {
        const { service } = makeService()
        service.acquire(3)
        service.setSpeed(3, -10, 0)
        expect(service.throttles[0].speed).toBe(0)
    })

    it('is a no-op for a cab that was never acquired', async () => {
        const { service, write } = makeService()
        service.setSpeed(99, 50, 1)
        await flush(service)
        expect(write).not.toHaveBeenCalled()
    })
})

describe('ThrottleService.setFunction', () => {
    it('sends <F cab func state> and updates local state', async () => {
        const { service, write } = makeService()
        service.acquire(3)

        service.setFunction(3, 2, true)
        expect(service.throttles[0].functions[2]).toBe(true)

        await flush(service)
        expect(write).toHaveBeenLastCalledWith('/dev/ttyACM1', '<F 3 2 1>\n')

        service.setFunction(3, 2, false)
        await flush(service)
        expect(write).toHaveBeenLastCalledWith('/dev/ttyACM1', '<F 3 2 0>\n')
    })
})

// ── power / e-stop ───────────────────────────────────────────────────────────

describe('ThrottleService power + e-stop', () => {
    it('powerOn sends <1> and optimistically sets trackPower', async () => {
        const { service, write } = makeService()
        expect(service.trackPower).toBeNull()
        service.powerOn()
        expect(service.trackPower).toBe(true)
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<1>\n')
    })

    it('powerOff sends <0> and optimistically sets trackPower', async () => {
        const { service, write } = makeService()
        service.powerOff()
        expect(service.trackPower).toBe(false)
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<0>\n')
    })

    it('emergencyStopAll sends <!>', async () => {
        const { service, write } = makeService()
        service.emergencyStopAll()
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<!>\n')
    })

    it('does nothing when no device is selected', async () => {
        const { service, write } = makeService(null)
        service.powerOn()
        await flush(service)
        expect(write).not.toHaveBeenCalled()
    })
})

// ── incoming <l> broadcast parsing ───────────────────────────────────────────

// ── polling for changes made by other throttles ──────────────────────────────

describe('ThrottleService._pollAll', () => {
    it('re-requests full state for every acquired cab (catches external <F> changes, which DCC-EX never broadcasts)', async () => {
        const { service, write } = makeService()
        service.acquire(3)
        service.acquire(5)
        write.mockClear()

        ;(service as unknown as { _pollAll(): void })._pollAll()
        await flush(service)

        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<t 3>\n')
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<t 5>\n')
    })

    it('also re-requests track power state (<s>), even with nothing acquired', async () => {
        const { service, write } = makeService()
        ;(service as unknown as { _pollAll(): void })._pollAll()
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<s>\n')
    })

    it('does NOT poll turnout states — that runs on its own, slower timer (see _pollTurnouts)', async () => {
        const { service, write } = makeService()
        ;(service as unknown as { _pollAll(): void })._pollAll()
        await flush(service)
        expect(write).not.toHaveBeenCalledWith('/dev/ttyACM1', '<T>\n')
    })
})

describe('ThrottleService._pollTurnouts', () => {
    it('re-requests turnout states (<T>)', async () => {
        vi.useFakeTimers()
        const { service, write } = makeService()
        ;(service as unknown as { _pollTurnouts(): void })._pollTurnouts()
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<T>\n')
    })
})

// ── UNKNOWN -> CLOSED grace period ──────────────────────────────────────────

describe('ThrottleService — assumes still-UNKNOWN turnouts are CLOSED after a grace period', () => {
    it('flips every UNKNOWN entry to CLOSED once TURNOUT_UNKNOWN_GRACE_MS elapses after a <T> query', () => {
        vi.useFakeTimers()
        const { service } = makeService('/dev/ttyACM1', { turnouts: [makeTurnout(5), makeTurnout(6)] })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()
        ;(service as unknown as { _queryTurnouts(): void })._queryTurnouts()

        expect(service.turnoutStatuses.map((s) => s.state)).toEqual(['UNKNOWN', 'UNKNOWN'])
        vi.advanceTimersByTime(3000)
        expect(service.turnoutStatuses.map((s) => s.state)).toEqual(['CLOSED', 'CLOSED'])
    })

    it('does not override a state already learned from a real <H> broadcast', () => {
        vi.useFakeTimers()
        const { service } = makeService('/dev/ttyACM1', { turnouts: [makeTurnout(5)] })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()
        ;(service as unknown as { _queryTurnouts(): void })._queryTurnouts()
        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<H 5 1>')

        vi.advanceTimersByTime(3000)
        expect(service.turnoutStatuses[0].state).toBe('THROWN')
    })

    it('recomputes route status once turnouts are assumed CLOSED', () => {
        vi.useFakeTimers()
        const { service } = makeService('/dev/ttyACM1', {
            turnouts: [makeTurnout(201)],
            routes: [makeRoute(1, 'CLOSE(201)\nDONE')],
        })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()
        ;(service as unknown as { _queryTurnouts(): void })._queryTurnouts()

        expect(service.routeStatuses[0].status).toBe('UNKNOWN')
        vi.advanceTimersByTime(3000)
        expect(service.routeStatuses[0].status).toBe('MATCHED')
    })
})

// ── turnout status seeding ──────────────────────────────────────────────────

describe('ThrottleService._seedTurnoutAndRouteStatuses', () => {
    it('creates one UNKNOWN entry per configured turnout/route, without duplicating existing entries', () => {
        const { service } = makeService('/dev/ttyACM1', {
            turnouts: [makeTurnout(5), makeTurnout(6)],
            routes: [makeRoute(1, 'THROW(5)\nDONE')],
        })

        const seed = (service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses.bind(service)
        seed()
        expect(service.turnoutStatuses).toEqual([
            { id: 5, state: 'UNKNOWN' },
            { id: 6, state: 'UNKNOWN' },
        ])
        expect(service.routeStatuses).toEqual([{ id: 1, status: 'UNKNOWN' }])

        const before = service.turnoutStatuses[0]
        seed() // idempotent — must not duplicate or replace existing entries
        expect(service.turnoutStatuses).toHaveLength(2)
        expect(service.turnoutStatuses[0]).toBe(before)
    })
})

// ── incoming <H> turnout broadcast parsing + route recompute ───────────────

describe('ThrottleService._handleLine — turnout broadcasts', () => {
    it('updates the matching turnout status from a <H id state> broadcast', () => {
        const { service } = makeService('/dev/ttyACM1', { turnouts: [makeTurnout(200)] })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<H 200 1>')
        expect(service.turnoutStatuses[0]).toMatchObject({ id: 200, state: 'THROWN' })

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<H 200 0>')
        expect(service.turnoutStatuses[0]).toMatchObject({ id: 200, state: 'CLOSED' })
    })

    it('mutates the existing entry in place rather than replacing it', () => {
        const { service } = makeService('/dev/ttyACM1', { turnouts: [makeTurnout(200)] })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()
        const before = service.turnoutStatuses[0]

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<H 200 1>')
        expect(service.turnoutStatuses[0]).toBe(before)
    })

    it('leaves unrelated turnout entries untouched', () => {
        const { service } = makeService('/dev/ttyACM1', { turnouts: [makeTurnout(1), makeTurnout(2)] })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<H 1 1>')
        expect(service.turnoutStatuses.find((s) => s.id === 2)).toMatchObject({ id: 2, state: 'UNKNOWN' })
    })

    it('recomputes route status for routes referencing the changed turnout', () => {
        const { service } = makeService('/dev/ttyACM1', {
            turnouts: [makeTurnout(5)],
            routes: [makeRoute(1, 'THROW(5)\nDONE'), makeRoute(2, 'CLOSE(9)\nDONE')],
        })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()
        const unrelated = service.routeStatuses.find((r) => r.id === 2)

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<H 5 1>')

        expect(service.routeStatuses.find((r) => r.id === 1)).toMatchObject({ id: 1, status: 'MATCHED' })
        expect(service.routeStatuses.find((r) => r.id === 2)).toBe(unrelated)
        expect(service.routeStatuses.find((r) => r.id === 2)).toMatchObject({ status: 'UNKNOWN' })
    })
})

describe('ThrottleService.throwTurnout / closeTurnout', () => {
    it('sends <T id 1> and does not optimistically mutate local state', async () => {
        const { service, write } = makeService('/dev/ttyACM1', { turnouts: [makeTurnout(5)] })
        ;(service as unknown as { _seedTurnoutAndRouteStatuses(): void })._seedTurnoutAndRouteStatuses()

        service.throwTurnout(5)
        expect(service.turnoutStatuses[0].state).toBe('UNKNOWN')
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<T 5 1>\n')
    })

    it('sends <T id 0> for closeTurnout', async () => {
        const { service, write } = makeService('/dev/ttyACM1', { turnouts: [makeTurnout(5)] })
        service.closeTurnout(5)
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<T 5 0>\n')
    })
})

describe('ThrottleService.triggerRoute', () => {
    it('sends </ START id>', async () => {
        const { service, write } = makeService('/dev/ttyACM1', { routes: [makeRoute(1, 'THROW(5)\nDONE')] })
        service.triggerRoute(1)
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '</ START 1>\n')
    })

    it('also replays the route body as explicit <T id state> commands, so the mock (no EXRAIL interpreter) actually updates turnout state', async () => {
        const { service, write } = makeService('/dev/ttyACM1', {
            routes: [makeRoute(1, 'THROW(5)\nCLOSE(6)\nDONE')],
        })
        service.triggerRoute(1)
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<T 5 1>\n')
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<T 6 0>\n')
    })

    it('sends only </ START id> when the route id has no configured turnouts', async () => {
        const { service, write } = makeService('/dev/ttyACM1', { routes: [makeRoute(1, 'DELAY(500)\nDONE')] })
        service.triggerRoute(1)
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '</ START 1>\n')
        expect(write).toHaveBeenCalledTimes(1)
    })

    it('is a no-op beyond </ START id> for an unknown route id', async () => {
        const { service, write } = makeService('/dev/ttyACM1', { routes: [] })
        service.triggerRoute(99)
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '</ START 99>\n')
        expect(write).toHaveBeenCalledTimes(1)
    })
})

describe('ThrottleService._handleLine', () => {
    it('updates the matching cab from a <l cab reg speedByte functmap> broadcast', () => {
        const { service } = makeService()
        service.acquire(3)

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<l 3 0 180 5>')

        expect(service.throttles[0]).toMatchObject({ speed: 51, direction: 1 })
        expect(service.throttles[0].functions[0]).toBe(true) // bit 0
        expect(service.throttles[0].functions[2]).toBe(true) // bit 2
        expect(service.throttles[0].functions[1]).toBe(false)
    })

    it('ignores a broadcast for a cab that is not currently tracked', () => {
        const { service } = makeService()
        service.acquire(3)

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<l 9 0 180 5>')

        expect(service.throttles).toHaveLength(1)
        expect(service.throttles[0].speed).toBe(0)
    })

    it('ignores lines that are not <l ...> responses or power lines', () => {
        const { service } = makeService()
        service.acquire(3)
        const before = { ...service.throttles[0] }

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<i DCCEX ...>')

        expect(service.throttles[0]).toEqual(before)
    })
})

describe('ThrottleService._handleLine — track power', () => {
    it('sets trackPower true on <p1>', () => {
        const { service } = makeService()
        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<p1>')
        expect(service.trackPower).toBe(true)
    })

    it('sets trackPower false on <p0>', () => {
        const { service } = makeService()
        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<p0>')
        expect(service.trackPower).toBe(false)
    })

    it('does not touch acquired cab state when parsing a power line', () => {
        const { service } = makeService()
        service.acquire(3)
        const before = { ...service.throttles[0] }
        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<p1>')
        expect(service.throttles[0]).toEqual(before)
    })
})
