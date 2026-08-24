/**
 * Unit tests for main/platformio.ts — PlatformIoService
 *
 * Mocks `electron`, `fs`, `fs/promises` and `child_process` so nothing runs
 * against the real system. Focuses on: the generated platformio.ini, the
 * `pio run` argument and environment contracts, board detection, progress
 * streaming, failure modes, and build serialisation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/mock/home'), isPackaged: false },
}))

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
    mockExistsSync: vi.fn(() => true),
    mockReadFileSync: vi.fn(() => '{}'),
}))

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>()
    return { ...actual, existsSync: mockExistsSync, readFileSync: mockReadFileSync, mkdirSync: vi.fn() }
})

const { mockWriteFile, mockReaddir, mockMkdtemp, mockRm, mockCp, mockMkdir, mockReadFile } = vi.hoisted(() => ({
    mockWriteFile: vi.fn(async () => { }),
    mockReaddir: vi.fn(async () => [] as string[]),
    mockMkdtemp: vi.fn(async () => '/tmp/ex-toolchain-x'),
    mockRm: vi.fn(async () => { }),
    mockCp: vi.fn(async () => { }),
    mockMkdir: vi.fn(async () => { }),
    mockReadFile: vi.fn(async () => ''),
}))

vi.mock('fs/promises', () => ({
    writeFile: mockWriteFile,
    readdir: mockReaddir,
    mkdtemp: mockMkdtemp,
    rm: mockRm,
    cp: mockCp,
    mkdir: mockMkdir,
    readFile: mockReadFile,
}))

const { mockSpawn, mockExecFile } = vi.hoisted(() => ({
    mockSpawn: vi.fn(),
    mockExecFile: vi.fn(),
}))

vi.mock('child_process', () => ({ execFile: mockExecFile, spawn: mockSpawn }))

vi.mock('tar', () => ({ extract: vi.fn(async () => { }) }))

import { PlatformIoService } from '../../src/main/platformio'
import type { UsbManager } from '../../src/main/usb-manager'

const MANIFEST = JSON.stringify({
    python: '3.12.8',
    platformio: '6.1.18',
    platforms: { atmelavr: '5.1.0', espressif32: '6.7.0' },
    stamp: 'stamp-abc123',
})

const MEGA = 'arduino:avr:mega'
const ESP32 = 'esp32:esp32:esp32'
const STM32 = 'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE'

function makeService(serialPorts: Array<Record<string, unknown>> = []) {
    const usb = { listSerialPorts: vi.fn(async () => serialPorts) } as unknown as UsbManager
    return new PlatformIoService(usb)
}

/** A fake child process that emits the given output then exits. */
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

/** Last `platformio.ini` written by the service. */
function lastIni(): string {
    const call = [...mockWriteFile.mock.calls].reverse()
        .find((c) => String(c[0]).endsWith('platformio.ini'))
    return call ? String(call[1]) : ''
}

beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(MANIFEST)
    mockSpawn.mockImplementation(() => makeSpawnChild(0))
    // Default: any execFile call succeeds, so the zip-extraction branch (which
    // shells out to `unzip`/`powershell`) resolves instead of hanging.
    mockExecFile.mockImplementation((..._args: unknown[]) => {
        const cb = _args.at(-1)
        if (typeof cb === 'function') (cb as (e: Error | null, o: string, s: string) => void)(null, '', '')
    })
})

// ── Generated platformio.ini ─────────────────────────────────────────────────

describe('generated platformio.ini', () => {
    it('is written into the sketch directory before building', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        expect(mockWriteFile).toHaveBeenCalledWith(join('/my/sketch', 'platformio.ini'), expect.any(String), 'utf-8')
    })

    it('declares the resolved platform, board and env for the FQBN', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        const ini = lastIni()
        expect(ini).toContain('[env:mega2560]')
        expect(ini).toContain('platform = atmelavr')
        expect(ini).toContain('board = megaatmega2560')
        expect(ini).toContain('framework = arduino')
        expect(ini).toContain('default_envs = mega2560')
    })

    it('pins the ESP32 platform version rather than tracking latest', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', ESP32)
        expect(lastIni()).toContain('platform = espressif32@6.7.0')
    })

    it('treats the sketch root as both source and include dir', async () => {
        // The staged sketch is a flat Arduino tree with headers at the root —
        // the same layout CommandStation-EX uses upstream.
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        expect(lastIni()).toContain('src_dir = .')
        expect(lastIni()).toContain('include_dir = .')
    })

    it('keeps build output inside the sketch dir so two boards never share it', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        expect(lastIni()).toContain('build_dir = .pio/build')
        expect(lastIni()).toContain('libdeps_dir = .pio/libdeps')
    })

    it('declares no lib_deps, so the PlatformIO registry is never contacted', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        expect(lastIni()).not.toContain('lib_deps')
    })

    it('resolves libraries from the bundled library directory instead', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        expect(lastIni()).toMatch(/lib_extra_dirs = .*pio-libs/)
    })

    it('also searches the sketch\'s own libraries/ dir when it has one', async () => {
        const svc = makeService()
        mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('/libraries') || true)
        await svc.compile('/my/sketch', MEGA)
        expect(lastIni()).toContain('/my/sketch/libraries')
    })

    it('omits the sketch libraries/ dir when it has none', async () => {
        const svc = makeService()
        mockExistsSync.mockImplementation((p: unknown) => !String(p).endsWith(join('/my/sketch', 'libraries')))
        await svc.compile('/my/sketch', MEGA)
        expect(lastIni()).not.toContain('/my/sketch/libraries')
    })

    it('applies the target\'s build flags on top of the shared warnings', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', ESP32)
        expect(lastIni()).toContain('build_flags = -Wall -Wextra -std=c++17')
    })

    it('carries a per-board upload speed when the board needs one', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', 'arduino:megaavr:nanoevery')
        expect(lastIni()).toContain('upload_speed = 19200')

        mockWriteFile.mockClear()
        await svc.compile('/my/sketch', MEGA)
        expect(lastIni()).not.toContain('upload_speed')
    })

    it('is regenerated on every build so a stale copy can never be used', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        await svc.compile('/my/sketch', MEGA)
        const iniWrites = mockWriteFile.mock.calls.filter((c) => String(c[0]).endsWith('platformio.ini'))
        expect(iniWrites).toHaveLength(2)
    })

    it('gives each board a distinct env, so two boards get distinct build dirs', async () => {
        const svc = makeService()
        await svc.compile('/sketch-a', MEGA)
        const megaIni = lastIni()
        await svc.compile('/sketch-b', ESP32)
        const esp32Ini = lastIni()
        expect(megaIni).toContain('[env:mega2560]')
        expect(esp32Ini).toContain('[env:ESP32]')
    })
})

// ── compile() ────────────────────────────────────────────────────────────────

describe('compile()', () => {
    it('runs PlatformIO through the bundled interpreter', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        const [exe, args] = mockSpawn.mock.calls[0]
        expect(String(exe)).toMatch(/python3?(\.exe)?$/)
        expect(args.slice(0, 3)).toEqual(['-m', 'platformio', 'run'])
    })

    it('builds the resolved env in the sketch\'s own project dir', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', ESP32)
        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).toContain('-e')
        expect(args).toContain('ESP32')
        expect(args).toContain('--project-dir')
        expect(args).toContain('/my/sketch')
    })

    it('does not pass upload arguments', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).not.toContain('upload')
        expect(args).not.toContain('--upload-port')
    })

    it('runs with the offline environment so a build cannot download anything', async () => {
        const svc = makeService()
        await svc.compile('/my/sketch', MEGA)
        const options = mockSpawn.mock.calls[0][2]
        expect(options.env.HTTPS_PROXY).toBe('http://127.0.0.1:9')
        expect(options.env.PLATFORMIO_CORE_DIR).toContain('dcc-rail-commander')
        expect(options.env.PYTHONPATH).toContain('site-packages')
    })

    it('resolves success=true when the build exits 0', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0, 'SUCCESS'))
        const result = await svc.compile('/sketch', MEGA)
        expect(result.success).toBe(true)
        expect(result.output).toContain('SUCCESS')
        expect(result.error).toBeUndefined()
    })

    it('resolves success=false and surfaces stderr when the build fails', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(1, '', "'WIFI_HOSTNAME' was not declared in this scope"))
        const result = await svc.compile('/sketch', MEGA)
        expect(result.success).toBe(false)
        expect(result.error).toContain('WIFI_HOSTNAME')
        expect(result.error).toContain('was not declared in this scope')
    })

    it('falls back to stdout for the error when stderr is empty', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(1, 'Error: undefined reference to `setup`'))
        const result = await svc.compile('/sketch', MEGA)
        expect(result.error).toContain('undefined reference')
    })

    it('resolves success=false when the process cannot be spawned', async () => {
        const svc = makeService()
        const errorHandlers: ((err: Error) => void)[] = []
        mockSpawn.mockReturnValue({
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((evt: string, h: unknown) => {
                if (evt === 'error') errorHandlers.push(h as (err: Error) => void)
            }),
        })
        setTimeout(() => errorHandlers.forEach((h) => h(new Error('spawn python ENOENT'))), 0)
        const result = await svc.compile('/sketch', MEGA)
        expect(result.success).toBe(false)
        expect(result.error).toContain('ENOENT')
    })
})

// ── upload() ─────────────────────────────────────────────────────────────────

describe('upload()', () => {
    it('runs the upload target against the requested port', async () => {
        const svc = makeService()
        await svc.upload('/my/sketch', ESP32, '/dev/ttyUSB0')
        const args: string[] = mockSpawn.mock.calls[0][1]
        expect(args).toContain('-t')
        expect(args).toContain('upload')
        expect(args).toContain('--upload-port')
        expect(args).toContain('/dev/ttyUSB0')
        expect(args).toContain('ESP32')
    })

    it('resolves success from the exit code', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        await expect(svc.upload('/sketch', MEGA, '/dev/ttyACM0')).resolves.toMatchObject({ success: true })

        mockSpawn.mockReturnValue(makeSpawnChild(1, '', 'could not open port'))
        const failure = await svc.upload('/sketch', MEGA, '/dev/ttyACM0')
        expect(failure.success).toBe(false)
        expect(failure.error).toContain('could not open port')
    })
})

// ── Preflight failures ───────────────────────────────────────────────────────

describe('preflight checks', () => {
    it('refuses to build a board with no PlatformIO target and never spawns', async () => {
        const svc = makeService()
        const result = await svc.compile('/sketch', 'teensy:avr:teensy41')
        expect(result.success).toBe(false)
        expect(result.error).toContain('teensy:avr:teensy41')
        expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('reports an empty FQBN as an unbuildable board rather than guessing', async () => {
        const svc = makeService()
        const result = await svc.compile('/sketch', '')
        expect(result.success).toBe(false)
        expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('explains that the runtime is missing when the app was built without it', async () => {
        const svc = makeService()
        mockExistsSync.mockReturnValue(false)
        const result = await svc.compile('/sketch', MEGA)
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/bundled build runtime is missing/i)
        expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('names the missing toolchain and the board that needs it', async () => {
        const svc = makeService()
        // Runtime present, but the STM32 platform pack was never installed.
        mockExistsSync.mockImplementation((p: unknown) => !String(p).includes('ststm32'))
        const result = await svc.compile('/sketch', STM32)
        expect(result.success).toBe(false)
        expect(result.error).toContain('ststm32')
        expect(result.error).toContain('Nucleo F411RE')
        expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('reports preflight failures through the progress stream too', async () => {
        const svc = makeService()
        const messages: Array<[string, string]> = []
        svc.setProgressCallback((phase, message) => messages.push([phase, message]))
        await svc.compile('/sketch', 'teensy:avr:teensy41')
        expect(messages.some(([phase]) => phase === 'compile')).toBe(true)
    })
})

// ── Progress streaming ───────────────────────────────────────────────────────

describe('progress streaming', () => {
    it('emits one compile event per output line', async () => {
        const svc = makeService()
        const messages: string[] = []
        svc.setProgressCallback((phase, message) => { if (phase === 'compile') messages.push(message) })
        mockSpawn.mockReturnValue(makeSpawnChild(0, 'Compiling .pio/build/mega2560/src/main.cpp.o\nLinking\n'))
        await svc.compile('/sketch', MEGA)
        expect(messages).toContain('Compiling .pio/build/mega2560/src/main.cpp.o')
        expect(messages).toContain('Linking')
    })

    it('streams stderr as well, so compiler diagnostics are visible live', async () => {
        const svc = makeService()
        const messages: string[] = []
        svc.setProgressCallback((_phase, message) => messages.push(message))
        mockSpawn.mockReturnValue(makeSpawnChild(1, '', 'error: no such file'))
        await svc.compile('/sketch', MEGA)
        expect(messages).toContain('error: no such file')
    })

    it('preserves ANSI colour codes PlatformIO emits, so the terminal panel can render them', async () => {
        const svc = makeService()
        const messages: string[] = []
        svc.setProgressCallback((_phase, message) => messages.push(message))
        mockSpawn.mockReturnValue(makeSpawnChild(0, '[32mRAM:[0m 15.2%\n'))
        await svc.compile('/sketch', MEGA)
        expect(messages).toContain('[32mRAM:[0m 15.2%')
    })

    it('skips blank lines', async () => {
        const svc = makeService()
        const messages: string[] = []
        svc.setProgressCallback((_phase, message) => messages.push(message))
        mockSpawn.mockReturnValue(makeSpawnChild(0, 'one\n\n\n   \ntwo\n'))
        await svc.compile('/sketch', MEGA)
        expect(messages.filter((m) => m === 'one' || m === 'two')).toHaveLength(2)
        expect(messages.some((m) => m.trim() === '')).toBe(false)
    })

    it('tags upload output with the upload phase', async () => {
        const svc = makeService()
        const phases: string[] = []
        svc.setProgressCallback((phase) => phases.push(phase))
        mockSpawn.mockReturnValue(makeSpawnChild(0, 'Writing at 0x00010000...\n'))
        await svc.upload('/sketch', ESP32, '/dev/ttyUSB0')
        expect(new Set(phases)).toEqual(new Set(['upload']))
    })
})

// ── Serialisation ────────────────────────────────────────────────────────────

describe('build serialisation', () => {
    it('runs builds one at a time rather than racing over the shared core dir', async () => {
        const svc = makeService()
        let running = 0
        let maxConcurrent = 0
        mockSpawn.mockImplementation(() => {
            running++
            maxConcurrent = Math.max(maxConcurrent, running)
            const closeHandlers: ((code: number) => void)[] = []
            const child = {
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((evt: string, h: (...a: unknown[]) => void) => {
                    if (evt === 'close') closeHandlers.push(h as (code: number) => void)
                }),
            }
            setTimeout(() => { running--; closeHandlers.forEach((h) => h(0)) }, 5)
            return child
        })

        await Promise.all([
            svc.compile('/sketch-a', MEGA),
            svc.compile('/sketch-b', ESP32),
            svc.upload('/sketch-a', MEGA, '/dev/ttyACM0'),
        ])

        expect(maxConcurrent).toBe(1)
        expect(mockSpawn).toHaveBeenCalledTimes(3)
    })

    it('keeps the queue alive after a failed build', async () => {
        const svc = makeService()
        mockSpawn.mockReturnValueOnce(makeSpawnChild(1, '', 'boom'))
        const first = await svc.compile('/sketch', MEGA)
        mockSpawn.mockReturnValue(makeSpawnChild(0))
        const second = await svc.compile('/sketch', MEGA)
        expect(first.success).toBe(false)
        expect(second.success).toBe(true)
    })

    // Two different products/devices queued back-to-back must never bleed
    // into each other's config, even though they share one service instance
    // and one queue. The queue only guarantees they don't run at the same
    // time — these tests guard against a mix-up in *which* args/ini go with
    // which queued call.

    it('gives each queued build its own project-dir and env, never mixing configs', async () => {
        const svc = makeService()
        await Promise.all([svc.compile('/sketch-a', MEGA), svc.compile('/sketch-b', ESP32)])

        const [firstArgs, secondArgs] = mockSpawn.mock.calls.map((c) => c[1] as string[])
        expect(firstArgs).toEqual(expect.arrayContaining(['--project-dir', '/sketch-a', '-e', 'mega2560']))
        expect(secondArgs).toEqual(expect.arrayContaining(['--project-dir', '/sketch-b', '-e', 'ESP32']))
    })

    it('writes each queued build\'s platformio.ini scoped to its own sketch, not the other one', async () => {
        const svc = makeService()
        const iniBySketch: Record<string, string> = {}
        mockWriteFile.mockImplementation(async (path: unknown, content: unknown) => {
            const p = String(path)
            if (p.endsWith('platformio.ini')) iniBySketch[p] = String(content)
        })

        await Promise.all([svc.compile('/sketch-a', MEGA), svc.compile('/sketch-b', ESP32)])

        expect(iniBySketch[join('/sketch-a', 'platformio.ini')]).toContain('[env:mega2560]')
        expect(iniBySketch[join('/sketch-a', 'platformio.ini')]).not.toContain('[env:ESP32]')
        expect(iniBySketch[join('/sketch-b', 'platformio.ini')]).toContain('[env:ESP32]')
        expect(iniBySketch[join('/sketch-b', 'platformio.ini')]).not.toContain('[env:mega2560]')
    })

    it('keeps upload port scoped to its own queued call when interleaved with a compile', async () => {
        const svc = makeService()
        await Promise.all([
            svc.compile('/sketch-a', MEGA),
            svc.upload('/sketch-b', ESP32, '/dev/ttyUSB7'),
        ])

        const [compileArgs, uploadArgs] = mockSpawn.mock.calls.map((c) => c[1] as string[])
        expect(compileArgs).not.toContain('--upload-port')
        expect(uploadArgs).toEqual(expect.arrayContaining(['--upload-port', '/dev/ttyUSB7', '--project-dir', '/sketch-b']))
    })
})

// ── listBoards() ─────────────────────────────────────────────────────────────

describe('listBoards()', () => {
    it('identifies known boards from their VID/PID', async () => {
        const svc = makeService([
            { path: '/dev/ttyUSB0', vendorId: '303a', productId: '1001', serialNumber: 'CSB1-001' },
        ])
        const boards = await svc.listBoards()
        expect(boards).toEqual([
            {
                name: 'EX-CSB1 (DCC-EX CommandStation Board 1)',
                fqbn: 'esp32:esp32:esp32',
                port: '/dev/ttyUSB0',
                protocol: 'serial',
                serialNumber: 'CSB1-001',
            },
        ])
    })

    it('still reports a port it cannot identify, with an empty FQBN', async () => {
        // A board must never silently disappear from the picker just because
        // its VID/PID isn't in the table.
        const svc = makeService([{ path: '/dev/ttyACM9', vendorId: 'dead', productId: 'beef' }])
        const boards = await svc.listBoards()
        expect(boards).toHaveLength(1)
        expect(boards[0]).toMatchObject({ port: '/dev/ttyACM9', fqbn: '', name: 'Unknown device' })
    })

    it('falls back to the manufacturer string when there is one', async () => {
        const svc = makeService([{ path: '/dev/ttyACM9', manufacturer: 'Acme Boards' }])
        expect((await svc.listBoards())[0].name).toBe('Acme Boards')
    })

    it('returns every connected port', async () => {
        const svc = makeService([
            { path: '/dev/ttyACM0', vendorId: '2341', productId: '0042' },
            { path: '/dev/ttyUSB0', vendorId: '303a', productId: '1001' },
            { path: '/dev/ttyS4' },
        ])
        expect(await svc.listBoards()).toHaveLength(3)
    })

    it('needs no external CLI or subprocess to enumerate boards', async () => {
        const svc = makeService([{ path: '/dev/ttyACM0', vendorId: '2341', productId: '0042' }])
        await svc.listBoards()
        expect(mockSpawn).not.toHaveBeenCalled()
        expect(mockExecFile).not.toHaveBeenCalled()
    })
})

// ── Toolchain state ──────────────────────────────────────────────────────────

describe('checkToolchain()', () => {
    it('reports the installed version for a bundled platform', async () => {
        const svc = makeService()
        await expect(svc.checkToolchain(ESP32)).resolves.toEqual({ installed: true, version: '6.7.0' })
    })

    it('reports not-installed for a board whose pack is absent', async () => {
        const svc = makeService()
        mockExistsSync.mockImplementation((p: unknown) => !String(p).includes('ststm32'))
        await expect(svc.checkToolchain(STM32)).resolves.toEqual({ installed: false, version: null })
    })

    it('reports not-installed for a board with no target at all', async () => {
        const svc = makeService()
        await expect(svc.checkToolchain('teensy:avr:teensy41')).resolves.toEqual({
            installed: false,
            version: null,
        })
    })
})

describe('getPlatforms()', () => {
    it('lists the platform packs in the core dir with their pinned versions', async () => {
        const svc = makeService()
        mockReaddir.mockResolvedValue(['atmelavr', 'espressif32'])
        const platforms = await svc.getPlatforms()
        expect(platforms).toEqual([
            { id: 'atmelavr', installed: '5.1.0', latest: '5.1.0', name: 'atmelavr' },
            { id: 'espressif32', installed: '6.7.0', latest: '6.7.0', name: 'espressif32' },
        ])
    })

    it('ignores dotfiles in the platforms dir', async () => {
        const svc = makeService()
        mockReaddir.mockResolvedValue(['.DS_Store', 'atmelavr'])
        expect(await svc.getPlatforms()).toHaveLength(1)
    })

    it('returns an empty list when the core dir does not exist yet', async () => {
        const svc = makeService()
        mockReaddir.mockRejectedValue(new Error('ENOENT'))
        expect(await svc.getPlatforms()).toEqual([])
    })
})

describe('importToolchainPack()', () => {
    it('copies platforms and packages out of the archive into the core dir', async () => {
        const svc = makeService()
        mockReaddir.mockResolvedValue(['platforms', 'packages'])
        const result = await svc.importToolchainPack('/downloads/stm32-pack.tar.gz')
        expect(result.success).toBe(true)
        expect(mockCp).toHaveBeenCalledTimes(2)
    })

    it('rejects an archive that is not a toolchain pack', async () => {
        const svc = makeService()
        mockReaddir.mockResolvedValue(['some-other-thing'])
        mockExistsSync.mockImplementation((p: unknown) => !String(p).replace(/\\/g, '/').includes('/tmp/'))
        const result = await svc.importToolchainPack('/downloads/holiday-photos.zip')
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/toolchain pack/i)
    })

    it('cleans up its temp directory even when extraction fails', async () => {
        const svc = makeService()
        mockReaddir.mockRejectedValue(new Error('corrupt archive'))
        const result = await svc.importToolchainPack('/downloads/broken.tar.gz')
        expect(result.success).toBe(false)
        expect(mockRm).toHaveBeenCalledWith('/tmp/ex-toolchain-x', { recursive: true, force: true })
    })
})

describe('getVersion() / getBundledVersion()', () => {
    it('reports the version from the shipped manifest', () => {
        expect(makeService().getBundledVersion()).toBe('6.1.18')
    })

    it('asks the bundled PlatformIO Core for its own version', async () => {
        const svc = makeService()
        mockExecFile.mockImplementation((_exe, _args, _opts, cb) => cb(null, 'PlatformIO Core, version 6.1.18', ''))
        await expect(svc.getVersion()).resolves.toBe('6.1.18')
        const args = mockExecFile.mock.calls[0][1]
        expect(args).toEqual(['-m', 'platformio', '--version'])
    })

    it('returns null when PlatformIO cannot be run', async () => {
        const svc = makeService()
        mockExecFile.mockImplementation((_exe, _args, _opts, cb) => cb(new Error('ENOENT'), '', ''))
        await expect(svc.getVersion()).resolves.toBeNull()
    })

    it('returns null without spawning anything when nothing is bundled', async () => {
        const svc = makeService()
        mockExistsSync.mockReturnValue(false)
        await expect(svc.getVersion()).resolves.toBeNull()
        expect(mockExecFile).not.toHaveBeenCalled()
    })
})
