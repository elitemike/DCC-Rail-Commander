import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import type { AvailableUpdate } from '../../../../types/ipc'
import { UpdaterService } from '../../services/updater.service'
import { renderReleaseNotes } from '../../utils/release-notes-html'

const RELEASES_URL = 'https://github.com/elitemike/DCC-Rail-Commander/releases'

/**
 * Shows what's in an available update (release notes for every version since the running one)
 * and drives download → install. All state lives in UpdaterService/the main process, so closing
 * this with "Later" mid-download is safe — the download carries on, and reopening picks it up.
 */
export class UpdateDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    readonly updater = resolve(UpdaterService)

    notesEl!: HTMLElement

    /** Captured on open so the notes stay put even if a later state (e.g. a bare error) carries no update. */
    private update: AvailableUpdate | null = null

    activate(): void {
        const state = this.updater.state
        this.update = 'update' in state && state.update ? state.update : null
    }

    attached(): void {
        this.renderNotes()
    }

    get version(): string {
        return this.update?.version ?? ''
    }

    get releaseDate(): string {
        const date = this.update?.releaseDate
        return date ? new Date(date).toLocaleDateString() : ''
    }

    get releaseUrl(): string {
        return this.version ? `${RELEASES_URL}/tag/v${this.version}` : RELEASES_URL
    }

    get status(): string {
        return this.updater.state.status
    }

    get percent(): number {
        const state = this.updater.state
        return state.status === 'downloading' ? Math.round(state.percent) : 0
    }

    get errorMessage(): string {
        const state = this.updater.state
        return state.status === 'error' ? state.message : ''
    }

    /** Available, or a failed download (which keeps its update) that can be retried. */
    get canDownload(): boolean {
        const state = this.updater.state
        return state.status === 'available' || (state.status === 'error' && !!state.update)
    }

    get title(): string {
        switch (this.status) {
            case 'downloading':
                return 'Downloading update…'
            case 'downloaded':
                return 'Update ready to install'
            default:
                return 'Update available'
        }
    }

    private renderNotes(): void {
        const entries = this.update?.releaseNotes ?? []
        const withNotes = entries.filter((e) => e.note?.trim())
        if (withNotes.length === 0) {
            const empty = document.createElement('p')
            empty.className = 'text-sm text-gray-500'
            empty.textContent = 'No release notes were published for this version.'
            this.notesEl.replaceChildren(empty)
            return
        }
        this.notesEl.replaceChildren(
            ...withNotes.map((entry) => {
                const section = document.createElement('section')
                section.setAttribute('data-testid', 'update-release-notes-entry')
                // Only label each block when there's more than one version to tell apart.
                if (withNotes.length > 1) {
                    const heading = document.createElement('h3')
                    heading.className = 'release-notes-version'
                    heading.textContent = `Version ${entry.version}`
                    section.append(heading)
                }
                const body = document.createElement('div')
                body.className = 'release-notes'
                renderReleaseNotes(entry.note ?? '', body)
                section.append(body)
                return section
            }),
        )
    }

    download(): void {
        void this.updater.download()
    }

    async skip(): Promise<void> {
        if (this.version) await this.updater.skipVersion(this.version)
        void this.$dialog.cancel()
    }

    async install(): Promise<void> {
        const installing = await this.updater.installAndRestart()
        if (installing) void this.$dialog.ok()
    }

    later(): void {
        void this.$dialog.cancel()
    }
}
