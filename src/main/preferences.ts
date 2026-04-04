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
            const dir = join(app.getPath('userData'), 'preferences')
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            this._filePath = join(dir, `${this.name}.json`)
        }
        return this._filePath
    }

    private get data(): Record<string, unknown> {
        if (this._data === null) {
            this._data = {}
            if (existsSync(this.filePath)) {
                try {
                    this._data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
                } catch {
                    this._data = {}
                }
            }
        }
        return this._data
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

const store = new JsonStore('ex-installer-preferences')

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
