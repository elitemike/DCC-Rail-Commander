/**
 * Unit tests for main/git-client.ts — GitService
 *
 * Mocks `electron` and `simple-git` so no real git operations are performed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock electron ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/mock/home') },
}))

// ── Mock simple-git ───────────────────────────────────────────────────────────
const mockGitInstance = {
    clone: vi.fn(),
    pull: vi.fn(),
    tags: vi.fn(),
    checkout: vi.fn(),
    status: vi.fn(),
    reset: vi.fn(),
    clean: vi.fn(),
}

vi.mock('simple-git', () => ({
    default: vi.fn(() => mockGitInstance),
}))

import { GitService } from '../git-client'

function makeService() {
    return new GitService()
}

beforeEach(() => {
    vi.clearAllMocks()
})

// ── reposDir ──────────────────────────────────────────────────────────────────

describe('reposDir', () => {
    it('is under ex-installer/repos', () => {
        const svc = makeService()
        expect(svc.reposDir).toContain('ex-installer')
        expect(svc.reposDir).toContain('repos')
    })
})

// ── clone() ───────────────────────────────────────────────────────────────────

describe('clone()', () => {
    it('returns success=true when git clone succeeds', async () => {
        mockGitInstance.clone.mockResolvedValue(undefined)
        const svc = makeService()
        const result = await svc.clone('https://github.com/DCC-EX/CommandStation-EX.git', '/dest')
        expect(result.success).toBe(true)
        expect(result.error).toBeUndefined()
    })

    it('returns success=false with error message on failure', async () => {
        mockGitInstance.clone.mockRejectedValue(new Error('network error'))
        const svc = makeService()
        const result = await svc.clone('https://github.com/DCC-EX/CommandStation-EX.git', '/dest')
        expect(result.success).toBe(false)
        expect(result.error).toContain('network error')
    })

    it('passes branch option when provided', async () => {
        mockGitInstance.clone.mockResolvedValue(undefined)
        const svc = makeService()
        await svc.clone('https://repo.git', '/dest', 'main')
        // clone(url, dest, options) — options is [--branch, branchName] at index 2
        const optionsArg: string[] = mockGitInstance.clone.mock.calls[0][2]
        expect(optionsArg).toContain('main')
    })

    it('passes no branch option when omitted', async () => {
        mockGitInstance.clone.mockResolvedValue(undefined)
        const svc = makeService()
        await svc.clone('https://repo.git', '/dest')
        const optionsArg = mockGitInstance.clone.mock.calls[0][2]
        expect(optionsArg).toEqual([])
    })
})

// ── pull() ────────────────────────────────────────────────────────────────────

describe('pull()', () => {
    it('returns success=true on successful pull', async () => {
        mockGitInstance.pull.mockResolvedValue({})
        const svc = makeService()
        const result = await svc.pull('/my/repo')
        expect(result.success).toBe(true)
    })

    it('returns success=false with error on failure', async () => {
        mockGitInstance.pull.mockRejectedValue(new Error('merge conflict'))
        const svc = makeService()
        const result = await svc.pull('/my/repo')
        expect(result.success).toBe(false)
        expect(result.error).toContain('merge conflict')
    })
})

// ── listTags() ────────────────────────────────────────────────────────────────

describe('listTags()', () => {
    it('returns array of tag names', async () => {
        mockGitInstance.tags.mockResolvedValue({
            all: ['v5.0.0-Prod', 'v4.2.67-Devel', 'v4.2.58-Prod'],
        })
        const svc = makeService()
        const tags = await svc.listTags('/my/repo')
        expect(tags).toEqual(['v5.0.0-Prod', '4.2.67-Devel', 'v4.2.58-Prod'].length > 0 ? ['v5.0.0-Prod', 'v4.2.67-Devel', 'v4.2.58-Prod'] : [])
    })

    it('returns empty array on error', async () => {
        mockGitInstance.tags.mockRejectedValue(new Error('not a repo'))
        const svc = makeService()
        const tags = await svc.listTags('/my/repo')
        expect(tags).toEqual([])
    })
})

// ── checkout() ────────────────────────────────────────────────────────────────

describe('checkout()', () => {
    it('returns success=true on successful checkout', async () => {
        mockGitInstance.checkout.mockResolvedValue(undefined)
        const svc = makeService()
        const result = await svc.checkout('/my/repo', 'v5.0.0-Prod')
        expect(result.success).toBe(true)
    })

    it('returns success=false with error on failure', async () => {
        mockGitInstance.checkout.mockRejectedValue(new Error('ref not found'))
        const svc = makeService()
        const result = await svc.checkout('/my/repo', 'nonexistent-tag')
        expect(result.success).toBe(false)
        expect(result.error).toContain('ref not found')
    })
})

// ── checkLocalChanges() ───────────────────────────────────────────────────────

describe('checkLocalChanges()', () => {
    it('returns hasChanges=false when repo is clean', async () => {
        mockGitInstance.status.mockResolvedValue({
            isClean: () => true,
            modified: [],
            not_added: [],
            deleted: [],
        })
        const svc = makeService()
        const result = await svc.checkLocalChanges('/my/repo')
        expect(result.hasChanges).toBe(false)
        expect(result.files).toEqual([])
    })

    it('returns hasChanges=true when repo has changes', async () => {
        mockGitInstance.status.mockResolvedValue({
            isClean: () => false,
            modified: ['config.h'],
            not_added: ['myAutomation.h'],
            deleted: [],
        })
        const svc = makeService()
        const result = await svc.checkLocalChanges('/my/repo')
        expect(result.hasChanges).toBe(true)
        expect(result.files).toContain('config.h')
        expect(result.files).toContain('myAutomation.h')
    })

    it('returns all changed file categories', async () => {
        mockGitInstance.status.mockResolvedValue({
            isClean: () => false,
            modified: ['a.h'],
            not_added: ['b.h'],
            deleted: ['c.h'],
        })
        const svc = makeService()
        const result = await svc.checkLocalChanges('/my/repo')
        expect(result.files).toHaveLength(3)
    })

    it('returns hasChanges=false on exception', async () => {
        mockGitInstance.status.mockRejectedValue(new Error('not a repo'))
        const svc = makeService()
        const result = await svc.checkLocalChanges('/nonexistent')
        expect(result.hasChanges).toBe(false)
        expect(result.files).toEqual([])
    })
})

// ── hardReset() ───────────────────────────────────────────────────────────────

describe('hardReset()', () => {
    it('returns success=true when reset and clean succeed', async () => {
        mockGitInstance.reset.mockResolvedValue(undefined)
        mockGitInstance.clean.mockResolvedValue(undefined)
        const svc = makeService()
        const result = await svc.hardReset('/my/repo')
        expect(result.success).toBe(true)
    })

    it('returns success=false with error on failure', async () => {
        mockGitInstance.reset.mockRejectedValue(new Error('reset failed'))
        const svc = makeService()
        const result = await svc.hardReset('/my/repo')
        expect(result.success).toBe(false)
        expect(result.error).toContain('reset failed')
    })

    it('calls reset with --hard HEAD', async () => {
        mockGitInstance.reset.mockResolvedValue(undefined)
        mockGitInstance.clean.mockResolvedValue(undefined)
        const svc = makeService()
        await svc.hardReset('/my/repo')
        expect(mockGitInstance.reset).toHaveBeenCalledWith(['--hard', 'HEAD'])
    })
})
