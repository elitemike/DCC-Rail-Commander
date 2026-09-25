import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { AvailableUpdate, ReleaseNoteEntry, UpdateState } from '../types/ipc'
import { MOCK_UPDATE_INFO } from './dev-mock'

/**
 * The part of electron-updater the service actually drives, so the state machine below can be
 * unit-tested and run against a fake in `--mock-update` mode.
 */
export interface UpdateBackend {
    /** Resolves with the newer release's info, or null when the running version is already the latest. */
    check(): Promise<UpdateInfo | null>
    /** Resolves once the installer is fully downloaded and verified. `percent` is 0–100. */
    download(onProgress: (percent: number) => void): Promise<void>
    quitAndInstall(): void
}

/**
 * electron-updater hands back release notes as a single HTML string, or — with `fullChangelog` on —
 * one entry per intermediate version. Normalise both into the list form so the UI has one shape.
 */
export function normalizeReleaseNotes(info: Pick<UpdateInfo, 'version' | 'releaseNotes'>): ReleaseNoteEntry[] {
    const notes = info.releaseNotes
    if (notes == null) return []
    if (typeof notes === 'string') return [{ version: info.version, note: notes }]
    return notes.map((entry) => ({ version: entry.version, note: entry.note ?? null }))
}

export function toAvailableUpdate(info: UpdateInfo): AvailableUpdate {
    return {
        version: info.version,
        releaseName: info.releaseName ?? null,
        releaseDate: info.releaseDate || null,
        releaseNotes: normalizeReleaseNotes(info),
    }
}

/** Updates from the GitHub releases configured in package.json's `build.publish`. */
export class ElectronUpdaterBackend implements UpdateBackend {
    constructor() {
        // Downloading is a user decision made after reading the notes, never automatic.
        autoUpdater.autoDownload = false
        // If the user downloads but picks "Later", the update still lands the next time they quit.
        autoUpdater.autoInstallOnAppQuit = true
        // Notes for every release the user skipped over, not just the newest one.
        autoUpdater.fullChangelog = true
    }

    async check(): Promise<UpdateInfo | null> {
        const result = await autoUpdater.checkForUpdates()
        return result?.isUpdateAvailable ? result.updateInfo : null
    }

    async download(onProgress: (percent: number) => void): Promise<void> {
        const listener = (progress: { percent: number }): void => onProgress(progress.percent)
        autoUpdater.on('download-progress', listener)
        try {
            await autoUpdater.downloadUpdate()
        } finally {
            autoUpdater.off('download-progress', listener)
        }
    }

    quitAndInstall(): void {
        // Silent (the user already confirmed in-app) and relaunch once the installer finishes.
        autoUpdater.quitAndInstall(true, true)
    }
}

/** `--mock-update`: always reports MOCK_UPDATE_INFO as available, fakes the download, never installs. */
export class MockUpdateBackend implements UpdateBackend {
    async check(): Promise<UpdateInfo | null> {
        return { ...MOCK_UPDATE_INFO, files: [], path: '', sha512: '' } as UpdateInfo
    }

    async download(onProgress: (percent: number) => void): Promise<void> {
        for (const percent of [25, 50, 75, 100]) {
            await new Promise((r) => setTimeout(r, 100))
            onProgress(percent)
        }
    }

    quitAndInstall(): void {
        console.log('[mock-update] quitAndInstall() called — not installing anything in mock mode')
    }
}

/**
 * Owns the update lifecycle (check → download → install) and broadcasts every state change, so any
 * number of renderer views can reflect it without polling. With no backend (unpackaged dev/e2e
 * builds, which have nothing to update), it stays `unsupported` and every action is a no-op.
 */
export class AppUpdaterService {
    private state: UpdateState
    private readonly listeners = new Set<(state: UpdateState) => void>()
    private inFlightCheck: Promise<UpdateState> | null = null

    /**
     * Set immediately before quitAndInstall(), which closes every window first. The window's close
     * handler checks this to let the app exit without re-asking the renderer about unsaved changes —
     * the renderer already did that before requesting the install.
     */
    installing = false

    constructor(private readonly backend: UpdateBackend | null) {
        this.state = backend ? { status: 'idle' } : { status: 'unsupported' }
    }

    getState(): UpdateState {
        return this.state
    }

    onStateChanged(listener: (state: UpdateState) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    check(): Promise<UpdateState> {
        const backend = this.backend
        if (!backend) return Promise.resolve(this.state)
        // Once a download has started, a fresh check would only throw that progress away.
        if (this.state.status === 'downloading' || this.state.status === 'downloaded') {
            return Promise.resolve(this.state)
        }
        this.inFlightCheck ??= (async () => {
            this.setState({ status: 'checking' })
            try {
                const info = await backend.check()
                this.setState(info ? { status: 'available', update: toAvailableUpdate(info) } : { status: 'not-available' })
            } catch (err) {
                this.setState({ status: 'error', message: errorMessage(err) })
            } finally {
                this.inFlightCheck = null
            }
            return this.state
        })()
        return this.inFlightCheck
    }

    async download(): Promise<void> {
        const backend = this.backend
        const current = this.state
        // A failed download keeps its `update`, so "Try again" can go straight back to downloading.
        const update =
            current.status === 'available' || current.status === 'error' ? current.update : undefined
        if (!backend || !update) return

        this.setState({ status: 'downloading', update, percent: 0 })
        try {
            await backend.download((percent) => {
                if (this.state.status === 'downloading') this.setState({ status: 'downloading', update, percent })
            })
            this.setState({ status: 'downloaded', update })
        } catch (err) {
            this.setState({ status: 'error', message: errorMessage(err), update })
        }
    }

    install(): void {
        if (!this.backend || this.state.status !== 'downloaded') return
        this.installing = true
        this.backend.quitAndInstall()
    }

    private setState(state: UpdateState): void {
        this.state = state
        for (const listener of this.listeners) listener(state)
    }
}

/**
 * electron-updater's errors can embed an entire HTTP response or releases feed after the first
 * line. Log all of it, but only surface the summary line to the UI.
 */
function errorMessage(err: unknown): string {
    console.error('[updater]', err)
    const message = err instanceof Error ? err.message : String(err)
    const firstLine = message.split('\n', 1)[0].trim()
    return firstLine.length > 300 ? `${firstLine.slice(0, 300)}…` : firstLine
}
