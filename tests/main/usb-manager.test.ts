/**
 * Unit tests for main/usb-manager.ts — UsbManager.openPort() retry behavior.
 *
 * Regression: Windows' generic USB-CDC driver (used by boards with a native-USB
 * serial interface, no external CH340/CP210x bridge chip) frequently throws a
 * transient "SetCommState: Unknown error code 31" on the very first open
 * attempt right after the port enumerates, then succeeds on retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('usb', () => ({
    usb: { on: vi.fn() },
    getDeviceList: vi.fn(() => []),
}))

// Queue of results the mocked SerialPort constructor's callback resolves with,
// one per `new SerialPort(...)` call — consumed FIFO, always asynchronously
// (like the real native addon, never synchronously inside the constructor).
const { resultQueue, openAttempts } = vi.hoisted(() => ({
    resultQueue: [] as Array<Error | null>,
    openAttempts: { count: 0 },
}))

vi.mock('serialport', () => ({
    SerialPort: class {
        constructor(_opts: { path: string; baudRate: number }, cb: (err: Error | null) => void) {
            openAttempts.count++
            const result = resultQueue.shift() ?? null
            queueMicrotask(() => cb(result))
        }
        on = vi.fn()
    },
}))

async function loadManager() {
    vi.resetModules()
    const mod = await import('../../src/main/usb-manager')
    return new mod.UsbManager()
}

beforeEach(() => {
    resultQueue.length = 0
    openAttempts.count = 0
    vi.useFakeTimers()
})

describe('UsbManager.openPort retry behavior', () => {
    it('resolves immediately when the first open attempt succeeds', async () => {
        resultQueue.push(null)

        const manager = await loadManager()
        const openPromise = manager.openPort('/dev/ttyACM0')
        await vi.runAllTimersAsync()
        await openPromise

        expect(openAttempts.count).toBe(1)
    })

    it('retries after a transient SetCommState-style failure and succeeds', async () => {
        resultQueue.push(new Error('Open (SetCommState): Unknown error code 31'), null)

        const manager = await loadManager()
        const openPromise = manager.openPort('/dev/ttyACM0')
        await vi.runAllTimersAsync()
        await openPromise

        expect(openAttempts.count).toBe(2)
    })

    it('gives up and throws the last error after exhausting all retry attempts', async () => {
        resultQueue.push(
            new Error('permanent failure 1'),
            new Error('permanent failure 2'),
            new Error('permanent failure 3'),
        )

        const manager = await loadManager()
        const openPromise = manager.openPort('/dev/ttyACM0')
        // Attach the rejection expectation before advancing timers so the
        // rejection is never briefly "unhandled" between the two awaits.
        const assertion = expect(openPromise).rejects.toThrow('permanent failure 3')
        await vi.runAllTimersAsync()
        await assertion

        expect(openAttempts.count).toBe(3)
    })

    it('does not attempt to reopen a port that is already open', async () => {
        resultQueue.push(null)

        const manager = await loadManager()
        const first = manager.openPort('/dev/ttyACM0')
        await vi.runAllTimersAsync()
        await first

        await manager.openPort('/dev/ttyACM0')

        expect(openAttempts.count).toBe(1)
    })
})
