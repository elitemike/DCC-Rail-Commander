/**
 * Unit tests for main/app-updater.ts — the update lifecycle state machine and
 * how electron-updater's release notes are normalised for the renderer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../../src/types/ipc'

const { mockAutoUpdater } = vi.hoisted(() => ({
    mockAutoUpdater: {
        autoDownload: true,
        autoInstallOnAppQuit: false,
        fullChangelog: false,
        checkForUpdates: vi.fn(),
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
}))

vi.mock('electron-updater', () => ({ autoUpdater: mockAutoUpdater }))

import {
    AppUpdaterService,
    ElectronUpdaterBackend,
    normalizeReleaseNotes,
    type UpdateBackend,
} from '../../src/main/app-updater'

function updateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
    return {
        version: '0.2.0',
        releaseName: 'v0.2.0',
        releaseDate: '2026-09-01T00:00:00.000Z',
        releaseNotes: [
            { version: '0.2.0', note: '<p>two</p>' },
            { version: '0.1.5', note: null },
        ],
        files: [],
        path: '',
        sha512: '',
        ...overrides,
    } as UpdateInfo
}

function fakeBackend(overrides: Partial<UpdateBackend> = {}): UpdateBackend {
    return {
        check: vi.fn(async () => updateInfo()),
        download: vi.fn(async (onProgress: (percent: number) => void) => {
            onProgress(50)
            onProgress(100)
        }),
        quitAndInstall: vi.fn(),
        ...overrides,
    }
}

describe('normalizeReleaseNotes', () => {
    it('returns no entries when the release has no notes', () => {
        expect(normalizeReleaseNotes({ version: '1.0.0', releaseNotes: null })).toEqual([])
    })

    it('wraps a single HTML string as the new version’s entry', () => {
        expect(normalizeReleaseNotes({ version: '1.0.0', releaseNotes: '<p>hi</p>' })).toEqual([
            { version: '1.0.0', note: '<p>hi</p>' },
        ])
    })

    it('keeps full-changelog entries in order and maps missing notes to null', () => {
        expect(normalizeReleaseNotes(updateInfo())).toEqual([
            { version: '0.2.0', note: '<p>two</p>' },
            { version: '0.1.5', note: null },
        ])
    })
})

describe('AppUpdaterService', () => {
    it('is inert without a backend (unpackaged dev/e2e builds)', async () => {
        const service = new AppUpdaterService(null)
        expect(service.getState()).toEqual({ status: 'unsupported' })
        expect(await service.check()).toEqual({ status: 'unsupported' })
        await service.download()
        service.install()
        expect(service.getState()).toEqual({ status: 'unsupported' })
        expect(service.installing).toBe(false)
    })

    it('reports an available update with its release notes, broadcasting each state', async () => {
        const service = new AppUpdaterService(fakeBackend())
        const seen: UpdateState['status'][] = []
        service.onStateChanged((s) => seen.push(s.status))

        const result = await service.check()

        expect(seen).toEqual(['checking', 'available'])
        expect(result).toEqual({
            status: 'available',
            update: {
                version: '0.2.0',
                releaseName: 'v0.2.0',
                releaseDate: '2026-09-01T00:00:00.000Z',
                releaseNotes: [
                    { version: '0.2.0', note: '<p>two</p>' },
                    { version: '0.1.5', note: null },
                ],
            },
        })
    })

    it('reports not-available when already on the latest version', async () => {
        const service = new AppUpdaterService(fakeBackend({ check: vi.fn(async () => null) }))
        expect(await service.check()).toEqual({ status: 'not-available' })
    })

    it('surfaces only the first line of a failed check', async () => {
        const service = new AppUpdaterService(
            fakeBackend({ check: vi.fn(async () => { throw new Error('HttpError: 404\nHeaders: {...huge...}') }) }),
        )
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await service.check()).toEqual({ status: 'error', message: 'HttpError: 404' })
    })

    it('shares one in-flight check between concurrent callers', async () => {
        const backend = fakeBackend()
        const service = new AppUpdaterService(backend)
        const [a, b] = await Promise.all([service.check(), service.check()])
        expect(backend.check).toHaveBeenCalledTimes(1)
        expect(a).toBe(b)
    })

    it('downloads with progress, then is ready to install', async () => {
        const service = new AppUpdaterService(fakeBackend())
        await service.check()
        const seen: UpdateState[] = []
        service.onStateChanged((s) => seen.push(s))

        await service.download()

        expect(seen.map((s) => (s.status === 'downloading' ? `downloading:${s.percent}` : s.status))).toEqual([
            'downloading:0',
            'downloading:50',
            'downloading:100',
            'downloaded',
        ])
    })

    it('ignores download() before an update has been found', async () => {
        const backend = fakeBackend()
        const service = new AppUpdaterService(backend)
        await service.download()
        expect(backend.download).not.toHaveBeenCalled()
        expect(service.getState()).toEqual({ status: 'idle' })
    })

    it('keeps the update on a failed download so it can be retried', async () => {
        const download = vi
            .fn<UpdateBackend['download']>()
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce(undefined)
        const service = new AppUpdaterService(fakeBackend({ download }))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await service.check()

        await service.download()
        const failed = service.getState()
        expect(failed.status).toBe('error')
        expect(failed.status === 'error' && failed.update?.version).toBe('0.2.0')

        await service.download()
        expect(service.getState().status).toBe('downloaded')
    })

    it('does not throw away a finished download on a later check', async () => {
        const backend = fakeBackend()
        const service = new AppUpdaterService(backend)
        await service.check()
        await service.download()

        expect((await service.check()).status).toBe('downloaded')
        expect(backend.check).toHaveBeenCalledTimes(1)
    })

    it('only installs once downloaded, flagging the install for the window close handler', async () => {
        const backend = fakeBackend()
        const service = new AppUpdaterService(backend)
        await service.check()
        service.install()
        expect(backend.quitAndInstall).not.toHaveBeenCalled()

        await service.download()
        service.install()
        expect(service.installing).toBe(true)
        expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
    })
})

describe('ElectronUpdaterBackend', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('never downloads on its own, and asks for every skipped version’s notes', () => {
        new ElectronUpdaterBackend()
        expect(mockAutoUpdater.autoDownload).toBe(false)
        expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
        expect(mockAutoUpdater.fullChangelog).toBe(true)
    })

    it('returns update info only when electron-updater says the release is newer', async () => {
        const backend = new ElectronUpdaterBackend()
        mockAutoUpdater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false, updateInfo: updateInfo() })
        expect(await backend.check()).toBeNull()

        mockAutoUpdater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: updateInfo() })
        expect((await backend.check())?.version).toBe('0.2.0')

        // electron-updater resolves null when it decides not to check at all (e.g. unpackaged).
        mockAutoUpdater.checkForUpdates.mockResolvedValueOnce(null)
        expect(await backend.check()).toBeNull()
    })

    it('forwards download progress and detaches its listener afterwards', async () => {
        const backend = new ElectronUpdaterBackend()
        mockAutoUpdater.downloadUpdate.mockImplementationOnce(async () => {
            const listener = mockAutoUpdater.on.mock.calls[0][1] as (p: { percent: number }) => void
            listener({ percent: 42 })
            return []
        })
        const onProgress = vi.fn()

        await backend.download(onProgress)

        expect(mockAutoUpdater.on).toHaveBeenCalledWith('download-progress', expect.any(Function))
        expect(onProgress).toHaveBeenCalledWith(42)
        expect(mockAutoUpdater.off).toHaveBeenCalledWith('download-progress', mockAutoUpdater.on.mock.calls[0][1])
    })
})
