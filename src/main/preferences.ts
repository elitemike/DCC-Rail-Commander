import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

/**
 * Simple JSON-file preferences store.
 * Replaces electron-store (ESM-only v11+) to avoid CJS/ESM incompatibility.
 *
 * NOTE: file path and data are initialised lazily on first access so that
 * `app.setPath('userData', …)` (used by E2E tests) takes effect before we
 * call `app.getPath('userData')`. Module-level construction would cache the
 * wrong path when the store singleton is created before the path override runs.
 */
class JsonStore {
    private readonly name: string
    private _filePath: string | null = null
    private _data: Record<string, unknown> | null = null

    constructor(name: string) {
        this.name = name
    }

    private get filePath(): string {
        if (this._filePath === null) {
            // NOT 'preferences' — Electron/Chromium itself writes a `Preferences` file
            // directly under userData, and on the default case-insensitive filesystems
            // (Windows NTFS, macOS APFS/HFS+) that collides with a `preferences/`
            // subdirectory of ours: existsSync() sees Chromium's file and reports the
            // dir as already existing, so mkdirSync is skipped, and every subsequent
            // write fails with ENOENT because the path descends through a file, not a
            // directory. `app-preferences` doesn't collide with any reserved Chromium
            // userData filename.
            const dir = join(app.getPath('userData'), 'app-preferences')
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            this._filePath = join(dir, `${this.name}.json`)
        }
        return this._filePath
    }

    private get data(): Record<string, unknown> {
        if (this._data === null) {
            this._data = this.readData()
        }
        return this._data
    }

    private readData(): Record<string, unknown> {
        if (!existsSync(this.filePath)) return {}
        try {
            return JSON.parse(readFileSync(this.filePath, 'utf-8'))
        } catch {
            return {}
        }
    }

    get(key: string): unknown {
        return this.data[key]
    }

    set(key: string, value: unknown): void {
        this.data[key] = value
        this.save()
    }

    getAll(): Record<string, unknown> {
        return { ...this.data }
    }

    private save(): void {
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    }
}

const store = new JsonStore('dcc-rail-commander-preferences')

export class PreferencesService {
    get(key: string): unknown {
        return store.get(key)
    }

    set(key: string, value: unknown): void {
        store.set(key, value)
    }

    getAll(): Record<string, unknown> {
        return store.getAll()
    }
}
