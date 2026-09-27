/**
 * Unit tests for main/local-history.ts — LocalHistoryService
 *
 * Mirrors tests/main/preferences.test.ts's structure: electron and fs are mocked before the
 * module under test is imported, since it reads app.getPath('userData') eagerly per call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/mock/userdata') },
}))

// ── Mock fs (sync) ───────────────────────────────────────────────────────────
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

async function loadService() {
    vi.resetModules()
    const mod = await import('../../src/main/local-history')
    return new mod.LocalHistoryService()
}

// In-memory stand-in for the on-disk snapshot file, keyed by path, so record() → list()
// round-trips realistically across calls within a single test.
let store: Record<string, string>

beforeEach(() => {
    vi.clearAllMocks()
    store = {}
    mockMkdirSync.mockReturnValue(undefined)
    mockExistsSync.mockImplementation((p: string) => p in store)
    mockReadFileSync.mockImplementation((p: string) => store[p])
    mockWriteFileSync.mockImplementation((p: string, data: string) => {
        store[p] = data
    })
})

describe('record() / list()', () => {
    it('returns an empty list for a file with no history yet', async () => {
        const svc = await loadService()
        expect(svc.list('/scratch', 'myAutomation.h')).toEqual([])
    })

    it('records a snapshot that list() then returns', async () => {
        const svc = await loadService()
        svc.record('/scratch', 'myAutomation.h', 'ORIGINAL CONTENT')

        const snapshots = svc.list('/scratch', 'myAutomation.h')
        expect(snapshots).toHaveLength(1)
        expect(snapshots[0].content).toBe('ORIGINAL CONTENT')
    })

    it('returns snapshots newest first', async () => {
        const svc = await loadService()
        svc.record('/scratch', 'myAutomation.h', 'FIRST')
        svc.record('/scratch', 'myAutomation.h', 'SECOND')
        svc.record('/scratch', 'myAutomation.h', 'THIRD')

        const snapshots = svc.list('/scratch', 'myAutomation.h')
        expect(snapshots.map((s) => s.content)).toEqual(['THIRD', 'SECOND', 'FIRST'])
    })

    it('keeps separate histories per file within the same project', async () => {
        const svc = await loadService()
        svc.record('/scratch', 'myAutomation.h', 'automation content')
        svc.record('/scratch', 'myTurnouts.h', 'turnouts content')

        expect(svc.list('/scratch', 'myAutomation.h').map((s) => s.content)).toEqual(['automation content'])
        expect(svc.list('/scratch', 'myTurnouts.h').map((s) => s.content)).toEqual(['turnouts content'])
    })

    it('keeps separate histories per project for the same file name', async () => {
        const svc = await loadService()
        svc.record('/scratch/boardA', 'config.h', 'board A config')
        svc.record('/scratch/boardB', 'config.h', 'board B config')

        expect(svc.list('/scratch/boardA', 'config.h').map((s) => s.content)).toEqual(['board A config'])
        expect(svc.list('/scratch/boardB', 'config.h').map((s) => s.content)).toEqual(['board B config'])
    })

    it('caps history at 25 snapshots per file, dropping the oldest', async () => {
        const svc = await loadService()
        for (let i = 0; i < 30; i++) {
            svc.record('/scratch', 'myAutomation.h', `version ${i}`)
        }

        const snapshots = svc.list('/scratch', 'myAutomation.h')
        expect(snapshots).toHaveLength(25)
        // Newest first: the 30th write ("version 29") is first, oldest kept is "version 5".
        expect(snapshots[0].content).toBe('version 29')
        expect(snapshots[snapshots.length - 1].content).toBe('version 5')
    })

    it('falls back to an empty history on corrupt JSON rather than throwing', async () => {
        mockExistsSync.mockReturnValue(true)
        mockReadFileSync.mockReturnValue('NOT VALID JSON {{')

        const svc = await loadService()
        expect(svc.list('/scratch', 'myAutomation.h')).toEqual([])
    })

    it('never writes into a path that looks like the project folder', async () => {
        const svc = await loadService()
        svc.record('/some/project/scratch', 'myAutomation.h', 'content')

        const writtenPath = mockWriteFileSync.mock.calls[0][0] as string
        expect(writtenPath).not.toContain('some')
        expect(writtenPath).not.toContain('project')
        expect(writtenPath.toLowerCase()).toContain('userdata')
    })
})
