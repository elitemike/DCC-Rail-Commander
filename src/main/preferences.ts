import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

/**
 * Simple JSON-file preferences store.
 * Replaces electron-store (ESM-only v11+) to avoid CJS/ESM incompatibility.
 */
class JsonStore {
    private readonly filePath: string
    private data: Record<string, unknown>

    constructor(name: string) {
        const dir = join(app.getPath('userData'), 'preferences')
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        this.filePath = join(dir, `${name}.json`)
        this.data = {}
        if (existsSync(this.filePath)) {
            try {
                this.data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
            } catch {
                this.data = {}
            }
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
