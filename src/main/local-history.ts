import { app } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

export interface LocalHistorySnapshot {
    /** Millisecond timestamp string — also the sort/dedupe key. */
    id: string
    savedAt: string
    content: string
}

/** Kept per file. Old enough or over-the-cap entries are pruned on every record(). */
const MAX_SNAPSHOTS_PER_FILE = 25
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * A local-only, per-project version history for config file content — the safety net for
 * workspace.ts's various "the app decided this content was invalid/duplicate and rewrote it"
 * flows (checkForDuplicateExrailBlocks, checkForUnrecognizedExrailCommands, and any future one),
 * where saveFiles() would otherwise overwrite the last-good on-disk content with no way back.
 *
 * Deliberately stored under Electron's userData, not in the project/scratch folder: this is
 * recovery data for *this app*, not part of what the user's project folder or a shared repo
 * should ever contain.
 */
export class LocalHistoryService {
    private dir(projectKey: string): string {
        // projectKey is normally a filesystem path (scratchPath/sourceFolder) — hash it rather
        // than sanitizing, since two different real paths could otherwise collide after sanitizing.
        const hash = createHash('sha1').update(projectKey).digest('hex').slice(0, 20)
        const dir = join(app.getPath('userData'), 'local-history', hash)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        return dir
    }

    private snapshotPath(projectKey: string, fileName: string): string {
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
        return join(this.dir(projectKey), `${safeName}.json`)
    }

    private read(path: string): LocalHistorySnapshot[] {
        if (!existsSync(path)) return []
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf-8'))
            return Array.isArray(parsed) ? parsed : []
        } catch {
            return []
        }
    }

    /** Appends a snapshot of `content` for `fileName`, then prunes by age and count. */
    record(projectKey: string, fileName: string, content: string): void {
        const path = this.snapshotPath(projectKey, fileName)
        const snapshots = this.read(path)
        const now = Date.now()
        snapshots.push({ id: String(now), savedAt: new Date(now).toISOString(), content })

        const pruned = snapshots
            .filter((s) => now - new Date(s.savedAt).getTime() <= MAX_AGE_MS)
            .slice(-MAX_SNAPSHOTS_PER_FILE)

        writeFileSync(path, JSON.stringify(pruned, null, 2), 'utf-8')
    }

    /** Newest first. */
    list(projectKey: string, fileName: string): LocalHistorySnapshot[] {
        return this.read(this.snapshotPath(projectKey, fileName)).slice().reverse()
    }
}
