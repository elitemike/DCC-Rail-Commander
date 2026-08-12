/**
 * Unit tests for main/pio-runtime.ts
 *
 * Covers resource resolution (packaged vs development), the one-time seeding of
 * the writable PlatformIO core dir, and the subprocess environment — including
 * the offline fuse that is the whole point of bundling the toolchain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockApp } = vi.hoisted(() => ({
    mockApp: { getPath: vi.fn((_key: string) => '/mock/home'), isPackaged: false },
}))

vi.mock('electron', () => ({ app: mockApp }))

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
    mockExistsSync: vi.fn(() => true),
    mockReadFileSync: vi.fn(() => '{}'),
}))

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>()
    return { ...actual, existsSync: mockExistsSync, readFileSync: mockReadFileSync }
})

const { mockMkdir, mockCp, mockReaddir, mockWriteFile, mockReadFile, mockRename, mockRm } = vi.hoisted(() => ({
    mockMkdir: vi.fn(async () => { }),
    mockCp: vi.fn(async () => { }),
    mockReaddir: vi.fn(async () => [] as string[]),
    mockWriteFile: vi.fn(async () => { }),
    mockReadFile: vi.fn(async () => ''),
    mockRename: vi.fn(async () => { }),
    mockRm: vi.fn(async () => { }),
}))

vi.mock('fs/promises', () => ({
    mkdir: mockMkdir,
    cp: mockCp,
    readdir: mockReaddir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    rename: mockRename,
    rm: mockRm,
}))

import {
    resourcesRoot,
    pythonExe,
    coreDir,
    platformsDir,
    packagesDir,
    hasBundledRuntime,
    readManifest,
    bundledVersion,
    isRuntimeReady,
    seedRuntime,
    isPlatformInstalled,
    pioEnv,
    BUNDLED_PLATFORMIO_VERSION,
} from '../../src/main/pio-runtime'

const MANIFEST = JSON.stringify({
    python: '3.12.8',
    platformio: '6.1.18',
    platforms: { atmelavr: '5.1.0', espressif32: '6.7.0' },
    stamp: 'stamp-abc123',
})

beforeEach(() => {
    vi.clearAllMocks()
    mockApp.isPackaged = false
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(MANIFEST)
    mockReaddir.mockResolvedValue([])
    mockReadFile.mockResolvedValue('')
})

// ── Path resolution ──────────────────────────────────────────────────────────

describe('resource paths', () => {
    it('resolves resources from the repo when running unpackaged', () => {
        mockApp.isPackaged = false
        expect(resourcesRoot()).toMatch(/resources$/)
        expect(resourcesRoot()).not.toContain('undefined')
    })

    it('resolves resources from Electron resourcesPath when packaged', () => {
        mockApp.isPackaged = true
        const original = process.resourcesPath
        Object.defineProperty(process, 'resourcesPath', { value: '/app/Resources', configurable: true })
        try {
            expect(resourcesRoot()).toBe('/app/Resources')
        } finally {
            Object.defineProperty(process, 'resourcesPath', { value: original, configurable: true })
        }
    })

    it('names the interpreter per platform', () => {
        if (process.platform === 'win32') {
            expect(pythonExe()).toMatch(/python\.exe$/)
        } else {
            expect(pythonExe()).toMatch(/bin[/\\]python3$/)
        }
    })

    it('keeps the writable core dir under the ex-installer home directory', () => {
        expect(coreDir()).toContain('/mock/home')
        expect(coreDir()).toContain('ex-installer')
        expect(coreDir()).toContain('platformio')
    })

    it('nests platforms and packages inside the core dir', () => {
        expect(platformsDir().startsWith(coreDir())).toBe(true)
        expect(packagesDir().startsWith(coreDir())).toBe(true)
    })
})

// ── Runtime presence ─────────────────────────────────────────────────────────

describe('hasBundledRuntime()', () => {
    it('is true when the interpreter and site-packages both exist', () => {
        mockExistsSync.mockReturnValue(true)
        expect(hasBundledRuntime()).toBe(true)
    })

    it('is false when nothing is bundled', () => {
        mockExistsSync.mockReturnValue(false)
        expect(hasBundledRuntime()).toBe(false)
    })
})

describe('readManifest() / bundledVersion()', () => {
    it('parses the shipped manifest', () => {
        expect(readManifest()).toMatchObject({ platformio: '6.1.18', stamp: 'stamp-abc123' })
    })

    it('returns null when the manifest is absent', () => {
        mockExistsSync.mockReturnValue(false)
        expect(readManifest()).toBeNull()
    })

    it('returns null rather than throwing on malformed JSON', () => {
        mockReadFileSync.mockReturnValue('{ not json')
        expect(readManifest()).toBeNull()
    })

    it('reports the manifest version, falling back to the pinned constant', () => {
        expect(bundledVersion()).toBe('6.1.18')
        mockExistsSync.mockReturnValue(false)
        expect(bundledVersion()).toBe(BUNDLED_PLATFORMIO_VERSION)
    })
})

// ── Seeding ──────────────────────────────────────────────────────────────────

describe('isRuntimeReady()', () => {
    it('is true only when the on-disk stamp matches this build', async () => {
        mockReadFile.mockResolvedValue('stamp-abc123')
        await expect(isRuntimeReady()).resolves.toBe(true)
    })

    it('is false when the stamp is from a previous build', async () => {
        mockReadFile.mockResolvedValue('stamp-older')
        await expect(isRuntimeReady()).resolves.toBe(false)
    })

    it('is false when nothing has been seeded yet', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'))
        await expect(isRuntimeReady()).resolves.toBe(false)
    })

    it('is false when the runtime is not bundled at all', async () => {
        mockExistsSync.mockReturnValue(false)
        await expect(isRuntimeReady()).resolves.toBe(false)
    })
})

describe('seedRuntime()', () => {
    it('copies each bundled platform and package into the core dir', async () => {
        mockReaddir.mockResolvedValue(['atmelavr', 'espressif32'])
        // Bundled sources exist; nothing is present in the destination yet.
        mockExistsSync.mockImplementation((p: unknown) => !String(p).includes('/ex-installer/platformio/'))

        const result = await seedRuntime()

        expect(result.success).toBe(true)
        // Two entries × two kinds (platforms, packages)
        expect(mockCp).toHaveBeenCalledTimes(4)
        expect(mockCp).toHaveBeenCalledWith(
            expect.stringContaining('atmelavr'),
            expect.stringContaining('atmelavr'),
            { recursive: true },
        )
    })

    it('writes the stamp so the next launch skips seeding', async () => {
        await seedRuntime()
        expect(mockWriteFile).toHaveBeenCalledWith(
            expect.stringContaining('.ex-installer-toolchain'),
            'stamp-abc123',
            'utf-8',
        )
    })

    it('does not re-copy entries that are already installed', async () => {
        mockReaddir.mockResolvedValue(['atmelavr'])
        mockExistsSync.mockReturnValue(true) // destination already populated
        await seedRuntime()
        expect(mockCp).not.toHaveBeenCalled()
    })

    it('reports progress per package so the UI can show what it is doing', async () => {
        mockReaddir.mockResolvedValue(['toolchain-atmelavr'])
        mockExistsSync.mockImplementation((p: unknown) => !String(p).includes('/ex-installer/platformio/'))
        const messages: string[] = []
        await seedRuntime((m) => messages.push(m))
        expect(messages.some((m) => m.includes('toolchain-atmelavr'))).toBe(true)
        expect(messages.at(-1)).toBe('Build toolchain ready')
    })

    it('fails with an actionable message when the runtime is missing', async () => {
        mockExistsSync.mockReturnValue(false)
        const result = await seedRuntime()
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/bundled build runtime is missing/i)
        expect(mockCp).not.toHaveBeenCalled()
    })

    it('surfaces copy failures instead of claiming success', async () => {
        mockReaddir.mockResolvedValue(['atmelavr'])
        mockExistsSync.mockImplementation((p: unknown) => !String(p).includes('/ex-installer/platformio/'))
        mockCp.mockRejectedValueOnce(new Error('EACCES: permission denied'))
        const result = await seedRuntime()
        expect(result.success).toBe(false)
        expect(result.error).toContain('EACCES')
        expect(mockWriteFile).not.toHaveBeenCalled()
    })

    // ── Isolation across concurrent seeding ─────────────────────────────────
    //
    // Unlike compile()/upload(), seedRuntime() is not queued behind a mutex —
    // it can legitimately run twice at once (e.g. two windows, or a retry
    // fired before the first attempt's promise resolves). The rename-into-place
    // dance is what's supposed to make that safe; these tests exercise the race
    // the code comment above seedRuntime() only describes.

    it('tolerates losing the rename race when a concurrent seed already installed the same entry', async () => {
        mockReaddir.mockResolvedValue(['atmelavr'])
        let targetCheckCount = 0
        mockExistsSync.mockImplementation((p: unknown) => {
            const s = String(p)
            if (s.includes('/ex-installer/platformio/') && s.endsWith('atmelavr') && !s.includes('.tmp-')) {
                targetCheckCount++
                // First check (before copying) sees nothing installed yet; the
                // second (after our rename fails) sees the winner's result.
                return targetCheckCount > 1
            }
            return !s.includes('/ex-installer/platformio/')
        })
        mockRename.mockRejectedValueOnce(new Error('ENOTEMPTY: lost the rename race'))

        const result = await seedRuntime()

        expect(result.success).toBe(true)
        expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('.tmp-'), { recursive: true, force: true })
    })

    it('still fails when the rename is lost and no winner actually installed the entry', async () => {
        mockReaddir.mockResolvedValue(['atmelavr'])
        mockExistsSync.mockImplementation((p: unknown) => !String(p).includes('/ex-installer/platformio/'))
        mockRename.mockRejectedValueOnce(new Error('EACCES: permission denied'))

        const result = await seedRuntime()

        expect(result.success).toBe(false)
        expect(result.error).toContain('EACCES')
    })

    it('lets two concurrent seedRuntime() calls both succeed without corrupting the core dir', async () => {
        mockReaddir.mockResolvedValue(['atmelavr'])
        let installed = false
        mockExistsSync.mockImplementation((p: unknown) => {
            const s = String(p)
            if (s.includes('/ex-installer/platformio/') && s.endsWith('atmelavr') && !s.includes('.tmp-')) {
                return installed
            }
            return !s.includes('/ex-installer/platformio/')
        })
        mockRename.mockImplementation(async () => {
            if (installed) throw new Error('ENOTEMPTY: someone else got there first')
            installed = true
        })

        const [a, b] = await Promise.all([seedRuntime(), seedRuntime()])

        expect(a.success).toBe(true)
        expect(b.success).toBe(true)
        // Both copied to their own temp dir; exactly one temp copy is discarded.
        expect(mockCp).toHaveBeenCalledTimes(2)
        expect(mockRm).toHaveBeenCalledTimes(1)
    })
})

describe('isPlatformInstalled()', () => {
    it('looks the platform up inside the core dir', () => {
        mockExistsSync.mockReturnValue(true)
        expect(isPlatformInstalled('espressif32')).toBe(true)
        expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('espressif32'))
    })

    it('is false when the platform pack was never installed', () => {
        mockExistsSync.mockReturnValue(false)
        expect(isPlatformInstalled('ststm32')).toBe(false)
    })
})

// ── Subprocess environment ───────────────────────────────────────────────────

describe('pioEnv()', () => {
    it('points PlatformIO at the bundled Core and the seeded core dir', () => {
        const env = pioEnv()
        expect(env.PYTHONPATH).toContain('site-packages')
        expect(env.PLATFORMIO_CORE_DIR).toBe(coreDir())
        expect(env.PLATFORMIO_PLATFORMS_DIR).toBe(platformsDir())
        expect(env.PLATFORMIO_PACKAGES_DIR).toBe(packagesDir())
    })

    it('isolates the interpreter from user site-packages', () => {
        const env = pioEnv()
        expect(env.PYTHONNOUSERSITE).toBe('1')
        expect(env.PYTHONDONTWRITEBYTECODE).toBe('1')
    })

    it('routes all HTTP through a dead port so a build can never download anything', () => {
        const env = pioEnv()
        // If PlatformIO decides it wants a package, this makes it fail loudly
        // rather than quietly pulling an unpinned toolchain over the wire.
        expect(env.HTTP_PROXY).toBe('http://127.0.0.1:9')
        expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:9')
        expect(env.http_proxy).toBe('http://127.0.0.1:9')
        expect(env.https_proxy).toBe('http://127.0.0.1:9')
        // An inherited NO_PROXY would punch a hole straight through the fuse.
        expect(env.NO_PROXY).toBe('')
        expect(env.no_proxy).toBe('')
    })

    it('disables telemetry and the update checks that would phone home', () => {
        const env = pioEnv()
        expect(env.PLATFORMIO_SETTING_ENABLE_TELEMETRY).toBe('false')
        expect(Number(env.PLATFORMIO_SETTING_CHECK_PLATFORMIO_INTERVAL)).toBeGreaterThan(100000)
        expect(Number(env.PLATFORMIO_SETTING_CHECK_PLATFORMS_INTERVAL)).toBeGreaterThan(100000)
        expect(Number(env.PLATFORMIO_SETTING_CHECK_LIBRARIES_INTERVAL)).toBeGreaterThan(100000)
    })

    it('inherits the rest of the process environment', () => {
        process.env.EX_INSTALLER_TEST_MARKER = 'kept'
        try {
            expect(pioEnv().EX_INSTALLER_TEST_MARKER).toBe('kept')
        } finally {
            delete process.env.EX_INSTALLER_TEST_MARKER
        }
    })
})
