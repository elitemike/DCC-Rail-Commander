/**
 * Unit tests for main/file-manager.ts — FileService
 *
 * Mocks `electron`, `fs/promises` so no real filesystem operations are performed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/mock/home') },
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: { getFocusedWindow: vi.fn(() => null) },
}))

// ── Mock fs/promises ──────────────────────────────────────────────────────────
// vi.hoisted() ensures these variables are initialized before the hoisted vi.mock factories run.
const { mockReadFile, mockWriteFile, mockReaddir, mockAccess, mockMkdir, mockCp, mockRm } = vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockReaddir: vi.fn(),
    mockAccess: vi.fn(),
    mockMkdir: vi.fn(),
    mockCp: vi.fn(),
    mockRm: vi.fn(),
}))

vi.mock('fs/promises', () => ({
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    readdir: mockReaddir,
    access: mockAccess,
    mkdir: mockMkdir,
    cp: mockCp,
    rm: mockRm,
}))

import { FileService } from '../file-manager'

function makeService() {
    return new FileService()
}

beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
})

// ── baseDir ───────────────────────────────────────────────────────────────────

describe('baseDir', () => {
    it('includes ex-installer segment', () => {
        const svc = makeService()
        expect(svc.baseDir).toContain('ex-installer')
    })

    it('is under the mocked home directory', () => {
        const svc = makeService()
        expect(svc.baseDir).toContain('/mock/home')
    })
})

// ── getInstallDir() ───────────────────────────────────────────────────────────

describe('getInstallDir()', () => {
    it('returns baseDir when no subdir given', async () => {
        const svc = makeService()
        const result = await svc.getInstallDir()
        expect(result).toBe(svc.baseDir)
    })

    it('appends subdir to baseDir', async () => {
        const svc = makeService()
        const result = await svc.getInstallDir('CommandStation-EX')
        expect(result).toContain('CommandStation-EX')
        expect(result).toContain(svc.baseDir)
    })

    it('calls mkdir with recursive:true', async () => {
        const svc = makeService()
        await svc.getInstallDir('SomeProduct')
        expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })
})

// ── readFile() ────────────────────────────────────────────────────────────────

describe('readFile()', () => {
    it('returns file content', async () => {
        mockReadFile.mockResolvedValue('#define MOTOR_SHIELD_TYPE STANDARD_MOTOR_SHIELD\n')
        const svc = makeService()
        const content = await svc.readFile('/some/config.h')
        expect(content).toContain('MOTOR_SHIELD_TYPE')
    })

    it('reads with utf-8 encoding', async () => {
        mockReadFile.mockResolvedValue('')
        const svc = makeService()
        await svc.readFile('/path/to/file.h')
        expect(mockReadFile).toHaveBeenCalledWith('/path/to/file.h', 'utf-8')
    })

    it('propagates read errors', async () => {
        mockReadFile.mockRejectedValue(new Error('ENOENT'))
        const svc = makeService()
        await expect(svc.readFile('/missing')).rejects.toThrow('ENOENT')
    })
})

// ── writeFile() ───────────────────────────────────────────────────────────────

describe('writeFile()', () => {
    it('writes content with utf-8 encoding', async () => {
        mockWriteFile.mockResolvedValue(undefined)
        const svc = makeService()
        await svc.writeFile('/path/config.h', '#define ENABLE_WIFI true\n')
        expect(mockWriteFile).toHaveBeenCalledWith('/path/config.h', '#define ENABLE_WIFI true\n', 'utf-8')
    })

    it('propagates write errors', async () => {
        mockWriteFile.mockRejectedValue(new Error('EACCES'))
        const svc = makeService()
        await expect(svc.writeFile('/protected/file', 'content')).rejects.toThrow('EACCES')
    })
})

// ── listDir() ─────────────────────────────────────────────────────────────────

describe('listDir()', () => {
    it('returns directory entries', async () => {
        mockReaddir.mockResolvedValue(['config.h', 'myAutomation.h'])
        const svc = makeService()
        const entries = await svc.listDir('/some/dir')
        expect(entries).toEqual(['config.h', 'myAutomation.h'])
    })

    it('returns empty array on error (directory not found)', async () => {
        mockReaddir.mockRejectedValue(new Error('ENOENT'))
        const svc = makeService()
        const entries = await svc.listDir('/missing/dir')
        expect(entries).toEqual([])
    })
})

// ── exists() ──────────────────────────────────────────────────────────────────

describe('exists()', () => {
    it('returns true when access succeeds', async () => {
        mockAccess.mockResolvedValue(undefined)
        const svc = makeService()
        expect(await svc.exists('/some/file')).toBe(true)
    })

    it('returns false when access throws', async () => {
        mockAccess.mockRejectedValue(new Error('ENOENT'))
        const svc = makeService()
        expect(await svc.exists('/missing/file')).toBe(false)
    })
})

// ── mkdir() ───────────────────────────────────────────────────────────────────

describe('mkdir()', () => {
    it('calls mkdir with recursive:true', async () => {
        mockMkdir.mockResolvedValue(undefined)
        const svc = makeService()
        await svc.mkdir('/new/dir')
        expect(mockMkdir).toHaveBeenCalledWith('/new/dir', { recursive: true })
    })
})

// ── copyFiles() ───────────────────────────────────────────────────────────────

describe('copyFiles()', () => {
    it('calls cp with recursive:true', async () => {
        mockCp.mockResolvedValue(undefined)
        const svc = makeService()
        await svc.copyFiles('/src', '/dest')
        expect(mockCp).toHaveBeenCalledWith('/src', '/dest', { recursive: true })
    })

    it('propagates cp errors', async () => {
        mockCp.mockRejectedValue(new Error('cp failed'))
        const svc = makeService()
        await expect(svc.copyFiles('/src', '/dest')).rejects.toThrow('cp failed')
    })
})

// ── deleteFiles() ─────────────────────────────────────────────────────────────

describe('deleteFiles()', () => {
    it('calls rm with recursive and force flags', async () => {
        mockRm.mockResolvedValue(undefined)
        const svc = makeService()
        await svc.deleteFiles('/some/dir')
        expect(mockRm).toHaveBeenCalledWith('/some/dir', { recursive: true, force: true })
    })

    it('propagates rm errors', async () => {
        mockRm.mockRejectedValue(new Error('rm failed'))
        const svc = makeService()
        await expect(svc.deleteFiles('/some/dir')).rejects.toThrow('rm failed')
    })
})

// ── selectDirectory() ─────────────────────────────────────────────────────────

describe('selectDirectory()', () => {
    it('returns null when no focused window', async () => {
        const { BrowserWindow } = await import('electron')
        vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(null)
        const svc = makeService()
        const result = await svc.selectDirectory()
        expect(result).toBeNull()
    })
})
