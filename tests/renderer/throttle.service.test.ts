import { describe, it, expect, vi } from 'vitest'
import {
    ThrottleService,
    decodeSpeedByte,
    decodeFunctionMap,
    MAX_FUNCTIONS,
    type ThrottleCabState,
} from '../../src/renderer/src/services/throttle.service'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeService(port: string | null = '/dev/ttyACM1') {
    const service = Object.create(ThrottleService.prototype) as ThrottleService
    const write = vi.fn().mockResolvedValue(undefined)

    Object.assign(service, {
        state: { selectedDevice: port ? { port } : null },
        usb: { write },
        throttles: [] as ThrottleCabState[],
        writeQueue: Promise.resolve(),
    })

    return { service, write }
}

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
    it('powerOn sends <1>', async () => {
        const { service, write } = makeService()
        service.powerOn()
        await flush(service)
        expect(write).toHaveBeenCalledWith('/dev/ttyACM1', '<1>\n')
    })

    it('powerOff sends <0>', async () => {
        const { service, write } = makeService()
        service.powerOff()
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

    it('is a no-op when nothing is acquired', async () => {
        const { service, write } = makeService()
        ;(service as unknown as { _pollAll(): void })._pollAll()
        await flush(service)
        expect(write).not.toHaveBeenCalled()
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

    it('ignores lines that are not <l ...> responses', () => {
        const { service } = makeService()
        service.acquire(3)
        const before = { ...service.throttles[0] }

        ;(service as unknown as { _handleLine(line: string): void })._handleLine('<p1>')

        expect(service.throttles[0]).toEqual(before)
    })
})
