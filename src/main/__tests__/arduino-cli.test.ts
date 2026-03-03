/**
 * Unit tests for main/arduino-cli.ts — ArduinoCliService
 *
 * Mocks `electron`, `fs`, and `child_process` so nothing runs against the real system.
 * Focuses on: path building, JSON response parsing, CLI argument construction,
 * progress callbacks, and compile/upload spawn behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
    app: {
        getPath: vi.fn((_key: string) => '/mock/home'),
    },
}))

// ── Mock fs (sync) ───────────────────────────────────────────────────────────
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>()
    return {
        ...actual,
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        chmodSync: vi.fn(),
        unlinkSync: vi.fn(),
        createWriteStream: vi.fn(),
    }
})

// ── Mock fs/promises ─────────────────────────────────────────────────────────
vi.mock('fs/promises', () => ({
    readdir: vi.fn(async () => []),
    rm: vi.fn(async () => { }),
}))

// ── Mock child_process ───────────────────────────────────────────────────────
// vi.hoisted() ensures these variables are initialized before the hoisted vi.mock factories run.
const { mockSpawn, mockExecFile } = vi.hoisted(() => ({
    mockSpawn: vi.fn(),
    mockExecFile: vi.fn(),
}))

vi.mock('child_process', () => ({
    execFile: mockExecFile,
    spawn: mockSpawn,
}))

// ── Mock tar ─────────────────────────────────────────────────────────────────
vi.mock('tar', () => ({
    extract: vi.fn(async () => { }),
}))

import { ArduinoCliService } from '../arduino-cli'
import { existsSync } from 'fs'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeService() {
    return new ArduinoCliService()
}

/** Spy on the private runCliJson method */
function stubRunCliJson(service: ArduinoCliService, result: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, 'runCliJson').mockResolvedValue(result)
}

// Clear all mock call counts between tests so `calls[0]` always refers to the
// current test's invocation.
beforeEach(() => vi.clearAllMocks())

// ── cliBinaryPath / installDir ────────────────────────────────────────────────

describe('cliBinaryPath', () => {
    it('ends with arduino-cli on non-Windows', () => {
        const svc = makeService()
        const originalPlatform = process.platform
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
        expect(svc.cliBinaryPath).toMatch(/arduino-cli$/)
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('ends with arduino-cli.exe on Windows', () => {
        const svc = makeService()
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
        expect(svc.cliBinaryPath).toMatch(/arduino-cli\.exe$/)
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    })

    it('installDir is under ex-installer/arduino-cli', () => {
        const svc = makeService()
        expect(svc.installDir).toContain('ex-installer')
        expect(svc.installDir).toContain('arduino-cli')
    })
})

// ── isInstalled ───────────────────────────────────────────────────────────────

describe('isInstalled()', () => {
    it('returns true when existsSync returns true', () => {
        vi.mocked(existsSync).mockReturnValue(true)
        const svc = makeService()
        expect(svc.isInstalled()).toBe(true)
    })

    it('returns false when existsSync returns false', () => {
        vi.mocked(existsSync).mockReturnValue(false)
        const svc = makeService()
        expect(svc.isInstalled()).toBe(false)
    })
})

// ── Progress callbacks ────────────────────────────────────────────────────────

describe('setProgressCallback()', () => {
    it('callback is invoked when progress is emitted', async () => {
        const svc = makeService()
        const calls: [string, string][] = []
        svc.setProgressCallback((phase, msg) => calls.push([phase, msg]))

        // Trigger via updateIndex which calls emitProgress
        vi.spyOn(svc as any, 'runCli').mockResolvedValue({ success: true })
        await svc.updateIndex()

        expect(calls.length).toBeGreaterThan(0)
        expect(calls[0][0]).toBe('update')
    })

    it('no error if no callback is set', async () => {
        const svc = makeService()
        vi.spyOn(svc as any, 'runCli').mockResolvedValue({ success: true })
        await expect(svc.updateIndex()).resolves.not.toThrow()
    })
})

// ── installPlatform / installLibrary ──────────────────────────────────────────

describe('installPlatform()', () => {
    it('passes platform@version when version is provided', async () => {
        const svc = makeService()
        const runCli = vi.spyOn(svc as any, 'runCli').mockResolvedValue({ success: true })

        await svc.installPlatform('arduino:avr', '1.8.6')

        const args: string[] = runCli.mock.calls[0][0]
        expect(args).toContain('arduino:avr@1.8.6')
    })

    it('passes platform without version when omitted', async () => {
        const svc = makeService()
        const runCli = vi.spyOn(svc as any, 'runCli').mockResolvedValue({ success: true })

        await svc.installPlatform('arduino:avr')

        const args: string[] = runCli.mock.calls[0][0]
        expect(args).toContain('arduino:avr')
        expect(args.some((a) => a.includes('@'))).toBe(false)
    })

    it('returns success from runCli', async () => {
        const svc = makeService()
        vi.spyOn(svc as any, 'runCli').mockResolvedValue({ success: true })
        const result = await svc.installPlatform('esp32:esp32', '2.0.17')
        expect(result.success).toBe(true)
    })
})

describe('installLibrary()', () => {
    it('passes library@version when provided', async () => {
        const svc = makeService()
        const runCli = vi.spyOn(svc as any, 'runCli').mockResolvedValue({ success: true })

        await svc.installLibrary('Ethernet', '2.0.2')

        const args: string[] = runCli.mock.calls[0][0]
        expect(args).toContain('Ethernet@2.0.2')
    })

    it('passes library without version when omitted', async () => {
        const svc = makeService()
        const runCli = vi.spyOn(svc as any, 'runCli').mockResolvedValue({ success: true })

        await svc.installLibrary('Ethernet')

        const args: string[] = runCli.mock.calls[0][0]
        expect(args).toContain('Ethernet')
        expect(args.some((a) => a.includes('@'))).toBe(false)
    })
})

// ── getPlatforms() JSON parsing ───────────────────────────────────────────────

describe('getPlatforms()', () => {
    it('returns empty array when runCliJson returns null', async () => {
        const svc = makeService()
        stubRunCliJson(svc, null)
        const result = await svc.getPlatforms()
        expect(result).toEqual([])
    })

    it('handles top-level array', async () => {
        const svc = makeService()
        stubRunCliJson(svc, [
            { id: 'arduino:avr', installed: '1.8.6', latest: '1.8.6', name: 'Arduino AVR Boards' },
        ])
        const result = await svc.getPlatforms()
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('arduino:avr')
        expect(result[0].installed).toBe('1.8.6')
        expect(result[0].name).toBe('Arduino AVR Boards')
    })

    it('handles wrapped { platforms: [...] } format', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            platforms: [
                { id: 'esp32:esp32', installed: '2.0.17', latest: '2.0.17', name: 'esp32' },
            ],
        })
        const result = await svc.getPlatforms()
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('esp32:esp32')
    })

    it('handles uppercase ID/Name/Installed/Latest keys', async () => {
        const svc = makeService()
        stubRunCliJson(svc, [
            { ID: 'arduino:avr', Installed: '1.8.6', Latest: '1.8.6', Name: 'Arduino AVR' },
        ])
        const result = await svc.getPlatforms()
        expect(result[0].id).toBe('arduino:avr')
        expect(result[0].name).toBe('Arduino AVR')
    })
})

// ── getLibraries() JSON parsing ───────────────────────────────────────────────

describe('getLibraries()', () => {
    it('returns empty array when runCliJson returns null', async () => {
        const svc = makeService()
        stubRunCliJson(svc, null)
        expect(await svc.getLibraries()).toEqual([])
    })

    it('handles { installed_libraries: [...] } wrapper', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            installed_libraries: [
                { library: { name: 'Ethernet', version: '2.0.2' } },
            ],
        })
        const result = await svc.getLibraries()
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('Ethernet')
        expect(result[0].installedVersion).toBe('2.0.2')
    })

    it('handles flat array format', async () => {
        const svc = makeService()
        stubRunCliJson(svc, [
            { name: 'Ethernet', installed_version: '2.0.2' },
        ])
        const result = await svc.getLibraries()
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('Ethernet')
    })

    it('handles multiple libraries', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            installed_libraries: [
                { library: { name: 'Ethernet', version: '2.0.2' } },
                { library: { name: 'Wire', version: '1.0.0' } },
            ],
        })
        const result = await svc.getLibraries()
        expect(result).toHaveLength(2)
    })
})

// ── listBoards() JSON parsing ─────────────────────────────────────────────────

describe('listBoards()', () => {
    it('returns empty array when runCliJson returns null', async () => {
        const svc = makeService()
        stubRunCliJson(svc, null)
        expect(await svc.listBoards()).toEqual([])
    })

    it('parses board list with matching_boards', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            detected_ports: [
                {
                    port: { address: '/dev/ttyACM0', protocol: 'serial', serial_number: 'ABC123' },
                    matching_boards: [{ name: 'Arduino Mega', fqbn: 'arduino:avr:mega' }],
                },
            ],
        })
        const result = await svc.listBoards()
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('Arduino Mega')
        expect(result[0].fqbn).toBe('arduino:avr:mega')
        expect(result[0].port).toBe('/dev/ttyACM0')
        expect(result[0].protocol).toBe('serial')
        expect(result[0].serialNumber).toBe('ABC123')
    })

    it('returns Unknown board when no matching_boards', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            detected_ports: [
                {
                    port: { address: '/dev/ttyUSB0', protocol: 'serial' },
                    matching_boards: [],
                },
            ],
        })
        const result = await svc.listBoards()
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('Unknown')
        expect(result[0].fqbn).toBe('')
        expect(result[0].port).toBe('/dev/ttyUSB0')
    })

    it('expands multiple matching_boards per port into separate entries', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            detected_ports: [
                {
                    port: { address: '/dev/ttyACM0', protocol: 'serial' },
                    matching_boards: [
                        { name: 'Board A', fqbn: 'a:a:a' },
                        { name: 'Board B', fqbn: 'b:b:b' },
                    ],
                },
            ],
        })
        const result = await svc.listBoards()
        expect(result).toHaveLength(2)
        expect(result[0].fqbn).toBe('a:a:a')
        expect(result[1].fqbn).toBe('b:b:b')
    })

    it('handles top-level array format', async () => {
        const svc = makeService()
        stubRunCliJson(svc, [
            {
                port: { address: 'COM3', protocol: 'serial' },
                matching_boards: [{ name: 'Arduino Uno', fqbn: 'arduino:avr:uno' }],
            },
        ])
        const result = await svc.listBoards()
        expect(result).toHaveLength(1)
        expect(result[0].port).toBe('COM3')
    })

    it('uses port.label when port.address is absent', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            detected_ports: [
                {
                    port: { label: 'USB Serial', protocol: 'serial' },
                    matching_boards: [{ name: 'Unknown', fqbn: '' }],
                },
            ],
        })
        const result = await svc.listBoards()
        expect(result[0].port).toBe('USB Serial')
    })

    it('skips entries with no port address', async () => {
        const svc = makeService()
        stubRunCliJson(svc, {
            detected_ports: [
                {
                    port: {},
                    matching_boards: [],
                },
            ],
        })
        const result = await svc.listBoards()
        expect(result).toHaveLength(0)
    })
})

// ── compile() ─────────────────────────────────────────────────────────────────

describe('compile()', () => {
    function makeSpawnChild(exitCode: number, stdout = '', stderr = '') {
        const stdoutHandlers: ((d: Buffer) => void)[] = []
        const stderrHandlers: ((d: Buffer) => void)[] = []
        const closeHandlers: ((code: number) => void)[] = []
        const errorHandlers: ((err: Error) => void)[] = []

        const child = {
            stdout: { on: vi.fn((evt: string, h: (d: Buffer) => void) => { if (evt === 'data') stdoutHandlers.push(h) }) },
            stderr: { on: vi.fn((evt: string, h: (d: Buffer) => void) => { if (evt === 'data') stderrHandlers.push(h) }) },
            on: vi.fn((evt: string, h: (...args: unknown[]) => void) => {
                if (evt === 'close') closeHandlers.push(h as (code: number) => void)
                if (evt === 'error') errorHandlers.push(h as (err: Error) => void)
            }),
        }

        // Simulate async emission
        setTimeout(() => {
            if (stdout) stdoutHandlers.forEach((h) => h(Buffer.from(stdout)))
            if (stderr) stderrHandlers.forEach((h) => h(Buffer.from(stderr)))
            closeHandlers.forEach((h) => h(exitCode))
        }, 0)

        return child
    }

    it('resolves success=true when exit code is 0', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0, '{"success":true}'))
        const result = await svc.compile('/sketch', 'arduino:avr:mega')
        expect(result.success).toBe(true)
    })

    it('resolves success=false when exit code is non-zero', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(1, '', 'compilation error'))
        const result = await svc.compile('/sketch', 'arduino:avr:mega')
        expect(result.success).toBe(false)
    })

    it('includes error output on failure', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(1, '', 'WIFI_HOSTNAME undeclared'))
        const result = await svc.compile('/sketch', 'arduino:avr:mega')
        expect(result.error).toContain('WIFI_HOSTNAME undeclared')
    })

    it('error is undefined on success', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0, 'ok'))
        const result = await svc.compile('/sketch', 'arduino:avr:mega')
        expect(result.error).toBeUndefined()
    })

    it('passes --fqbn and sketch path as spawn args', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        await svc.compile('/my/sketch', 'esp32:esp32:esp32')
        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).toContain('--fqbn')
        expect(args).toContain('esp32:esp32:esp32')
        expect(args).toContain('/my/sketch')
    })

    it('passes --format json to spawn', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        await svc.compile('/sketch', 'arduino:avr:mega')
        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).toContain('--format')
        expect(args).toContain('json')
    })

    it('resolves success=false on spawn error event', async () => {
        const svc = makeService()
        const errorHandlers: ((err: Error) => void)[] = []
        const child = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((evt: string, h: unknown) => {
                if (evt === 'error') errorHandlers.push(h as (err: Error) => void)
            }),
        }
        setTimeout(() => errorHandlers.forEach((h) => h(new Error('ENOENT'))), 0)
        mockSpawn.mockReturnValue(child)
        const result = await svc.compile('/sketch', 'arduino:avr:mega')
        expect(result.success).toBe(false)
        expect(result.error).toContain('ENOENT')
    })
})

// ── compile() — EX-CSB1 configuration ────────────────────────────────────────
//
// The EX-CSB1 (DCC-EX CommandStation Board 1) is an ESP32-S3 based board with
// VID:PID 303a:1001.  The IPC layer maps that to FQBN 'esp32:esp32:esp32'
// (generic ESP32 target — matches old Python installer; esp32s3 FQBN fails to
// compile against CommandStation-EX Prod due to missing LEDC_HS_SIG_OUT*_IDX).
// A typical CSB1 install uses:
//   motorDriver: 'EXCSB1', display: 'OLED_132x64' (SH1106 onboard),
//   enableWifi: true, wifiMode: 'ap', wifiChannel: 1,
//   disableEeprom: true (all auto-selected for ESP32).
//
// compile() builds: ['compile', '--fqbn', fqbn, sketchPath, '--format', 'json']

describe('compile() — EX-CSB1 configuration', () => {
    // CSB1 specific constants (match arduino-cli-ipc.ts KNOWN_BOARDS entry)
    const CSB1_FQBN = 'esp32:esp32:esp32'
    const CSB1_SKETCH_PATH = '/home/user/ex-installer/CommandStation-EX'

    function makeSpawnChild(exitCode: number, stdout = '', stderr = '') {
        const stdoutHandlers: ((d: Buffer) => void)[] = []
        const stderrHandlers: ((d: Buffer) => void)[] = []
        const closeHandlers: ((code: number) => void)[] = []

        const child = {
            stdout: { on: vi.fn((evt: string, h: (d: Buffer) => void) => { if (evt === 'data') stdoutHandlers.push(h) }) },
            stderr: { on: vi.fn((evt: string, h: (d: Buffer) => void) => { if (evt === 'data') stderrHandlers.push(h) }) },
            on: vi.fn((evt: string, h: (...args: unknown[]) => void) => {
                if (evt === 'close') closeHandlers.push(h as (code: number) => void)
            }),
        }
        setTimeout(() => {
            if (stdout) stdoutHandlers.forEach((h) => h(Buffer.from(stdout)))
            if (stderr) stderrHandlers.forEach((h) => h(Buffer.from(stderr)))
            closeHandlers.forEach((h) => h(exitCode))
        }, 0)
        return child
    }

    it('spawns arduino-cli with the exact CSB1 arg sequence', async () => {
        // Verifies the full ordered arg array:
        // ['compile', '--fqbn', 'esp32:esp32:esp32', <sketchPath>, '--format', 'json']
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        await svc.compile(CSB1_SKETCH_PATH, CSB1_FQBN)

        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).toEqual([
            'compile',
            '--fqbn',
            CSB1_FQBN,
            CSB1_SKETCH_PATH,
            '--format',
            'json',
        ])
    })

    it('resolves success=true when CSB1 compile exits 0', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0, '{"success":true}'))
        const result = await svc.compile(CSB1_SKETCH_PATH, CSB1_FQBN)
        expect(result.success).toBe(true)
        expect(result.error).toBeUndefined()
    })

    it('resolves success=false with ESP32 WiFi error when config.h is missing WIFI_HOSTNAME', async () => {
        // Common failure mode: CSB1 WiFi enabled but generateCommandStationConfig()
        // was not called — WIFI_HOSTNAME not defined in config.h
        const svc = makeService()
        const stderrOutput = [
            "CommandStation-EX.ino:42:3: error: 'WIFI_HOSTNAME' was not declared in this scope",
            'compilation terminated.',
        ].join('\n')
        mockSpawn.mockReturnValue(makeSpawnChild(1, '', stderrOutput))
        const result = await svc.compile(CSB1_SKETCH_PATH, CSB1_FQBN)
        expect(result.success).toBe(false)
        expect(result.error).toContain('WIFI_HOSTNAME')
    })

    it('output collects combined stdout on a successful CSB1 compile', async () => {
        const svc = makeService()
        const compilerOutput = '{"compiler_out":"","compiler_err":"","success":true}'
        mockSpawn.mockReturnValue(makeSpawnChild(0, compilerOutput))
        const result = await svc.compile(CSB1_SKETCH_PATH, CSB1_FQBN)
        expect(result.output).toContain('"success":true')
    })

    it('fails when hand-edited config.h omits WIFI_HOSTNAME (station-mode WiFi with real SSID)', async () => {
        // Reproduces the exact scenario of a user supplying:
        //   #define MOTOR_SHIELD_TYPE EXCSB1
        //   #define ENABLE_WIFI true
        //   #define WIFI_SSID "RTS"
        //   #define WIFI_PASSWORD "SomePassword"
        //   #define WIFI_CHANNEL 1
        //   #define DISABLE_EEPROM
        //
        // Missing required defines: IP_PORT, SCROLLMODE, and WIFI_HOSTNAME.
        // WIFI_HOSTNAME is the compile blocker — CommandStation-EX firmware
        // references it directly.  generateCommandStationConfig() always emits
        // #define WIFI_HOSTNAME "..." immediately before WIFI_SSID whenever
        // enableWifi is true, so the installer never produces this broken config.
        const svc = makeService()
        const stderrOutput = [
            "CommandStation-EX/WifiInterface.cpp:51:37: error: 'WIFI_HOSTNAME' was not declared in this scope",
            'compilation terminated.',
        ].join('\n')
        mockSpawn.mockReturnValue(makeSpawnChild(1, '', stderrOutput))
        const result = await svc.compile(CSB1_SKETCH_PATH, CSB1_FQBN)
        expect(result.success).toBe(false)
        expect(result.error).toContain('WIFI_HOSTNAME')
        expect(result.error).toContain('was not declared in this scope')
    })
})

// ── upload() ──────────────────────────────────────────────────────────────────

describe('upload()', () => {
    function makeSpawnChild(exitCode: number, stderr = '') {
        const closeHandlers: ((code: number) => void)[] = []
        const child = {
            stdout: { on: vi.fn() },
            stderr: {
                on: vi.fn((evt: string, h: (d: Buffer) => void) => {
                    if (evt === 'data' && stderr) setTimeout(() => h(Buffer.from(stderr)), 0)
                }),
            },
            on: vi.fn((evt: string, h: unknown) => {
                if (evt === 'close') closeHandlers.push(h as (code: number) => void)
            }),
        }
        setTimeout(() => closeHandlers.forEach((h) => h(exitCode)), 0)
        return child
    }

    it('resolves success=true on exit code 0', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        const result = await svc.upload('/sketch', 'arduino:avr:mega', '/dev/ttyACM0')
        expect(result.success).toBe(true)
    })

    it('resolves success=false on non-zero exit', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(1, 'upload error'))
        const result = await svc.upload('/sketch', 'arduino:avr:mega', '/dev/ttyACM0')
        expect(result.success).toBe(false)
    })

    it('passes -p port to spawn args', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        await svc.upload('/sketch', 'arduino:avr:mega', '/dev/ttyUSB0')
        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).toContain('-p')
        expect(args).toContain('/dev/ttyUSB0')
    })

    it('passes --fqbn to spawn args', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        await svc.upload('/sketch', 'esp32:esp32:esp32', '/dev/ttyUSB0')
        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).toContain('--fqbn')
        expect(args).toContain('esp32:esp32:esp32')
    })
})
