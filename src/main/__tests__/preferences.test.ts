/**
 * Unit tests for main/preferences.ts — PreferencesService / JsonStore
 *
 * Because JsonStore is instantiated at module level, electron and fs are mocked
 * before any import of the module under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

// ── Mock electron ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/mock/userdata') },
}))

// ── Mock fs (sync) ───────────────────────────────────────────────────────────
// vi.hoisted() ensures these variables are initialized before the hoisted vi.mock factories run.
const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync } = vi.hoisted(() => ({
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockMkdirSync: vi.fn(),
}))

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>()
    return {
        ...actual,
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        writeFileSync: mockWriteFileSync,
        mkdirSync: mockMkdirSync,
    }
})

// ── Lazy import after mocks are in place ─────────────────────────────────────
async function loadService() {
    // Reset module cache so JsonStore constructor runs fresh each test with current mock state
    vi.resetModules()
    const mod = await import('../preferences')
    return new mod.PreferencesService()
}

beforeEach(() => {
    vi.clearAllMocks()
    // Default: dir exists, no prefs file
    mockExistsSync.mockReturnValue(false)
    mockMkdirSync.mockReturnValue(undefined)
    mockWriteFileSync.mockReturnValue(undefined)
})

// ── get / set ─────────────────────────────────────────────────────────────────

describe('get() / set()', () => {
    it('returns undefined for an unknown key', async () => {
        const svc = await loadService()
        expect(svc.get('nonexistent')).toBeUndefined()
    })

    it('returns value that was previously set', async () => {
        const svc = await loadService()
        svc.set('theme', 'dark')
        expect(svc.get('theme')).toBe('dark')
    })

    it('overwrites existing value', async () => {
        const svc = await loadService()
        svc.set('key', 'first')
        svc.set('key', 'second')
        expect(svc.get('key')).toBe('second')
    })

    it('persists multiple distinct keys', async () => {
        const svc = await loadService()
        svc.set('a', 1)
        svc.set('b', 2)
        expect(svc.get('a')).toBe(1)
        expect(svc.get('b')).toBe(2)
    })

    it('stores booleans', async () => {
        const svc = await loadService()
        svc.set('flag', true)
        expect(svc.get('flag')).toBe(true)
    })

    it('stores nested objects', async () => {
        const svc = await loadService()
        svc.set('window', { width: 1920, height: 1080 })
        expect(svc.get('window')).toEqual({ width: 1920, height: 1080 })
    })

    it('calling set writes to disk', async () => {
        const svc = await loadService()
        svc.set('key', 'value')
        expect(mockWriteFileSync).toHaveBeenCalled()
    })

    it('disk write contains JSON with the set value', async () => {
        const svc = await loadService()
        svc.set('arduino-path', '/usr/bin/arduino-cli')
        const written = mockWriteFileSync.mock.calls[0][1] as string
        const parsed = JSON.parse(written)
        expect(parsed['arduino-path']).toBe('/usr/bin/arduino-cli')
    })
})

// ── getAll() ──────────────────────────────────────────────────────────────────

describe('getAll()', () => {
    it('returns empty object when no keys have been set', async () => {
        const svc = await loadService()
        expect(svc.getAll()).toEqual({})
    })

    it('returns all set keys and values', async () => {
        const svc = await loadService()
        svc.set('a', 1)
        svc.set('b', 'hello')
        const all = svc.getAll()
        expect(all).toEqual({ a: 1, b: 'hello' })
    })

    it('returns a copy — mutations do not affect the store', async () => {
        const svc = await loadService()
        svc.set('x', 42)
        const all = svc.getAll() as Record<string, unknown>
        all['x'] = 99
        expect(svc.get('x')).toBe(42)
    })
})

// ── Loading from existing prefs file ─────────────────────────────────────────

describe('loading existing preferences from disk', () => {
    it('reads and parses existing preferences file', async () => {
        // Simulate: prefs file exists
        mockExistsSync.mockImplementation((p: string) => {
            return typeof p === 'string' && p.endsWith('.json')
        })
        mockReadFileSync.mockReturnValue(JSON.stringify({ savedPref: 'value123' }))

        const svc = await loadService()
        expect(svc.get('savedPref')).toBe('value123')
    })

    it('falls back to empty store on invalid JSON', async () => {
        mockExistsSync.mockReturnValue(true)
        mockReadFileSync.mockReturnValue('NOT VALID JSON {{')

        const svc = await loadService()
        expect(svc.getAll()).toEqual({})
    })
})
