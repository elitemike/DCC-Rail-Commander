import { DI } from 'aurelia'

export const IPreferencesService = DI.createInterface<PreferencesService>('IPreferencesService')

/**
 * PreferencesService
 *
 * Wraps window.preferences (contextBridge API) for the renderer.
 */
export class PreferencesService {
    private cache: Record<string, unknown> = {}

    async load(): Promise<void> {
        this.cache = await window.preferences.getAll()
    }

    async get<T = unknown>(key: string): Promise<T> {
        return (await window.preferences.get(key)) as T
    }

    async set(key: string, value: unknown): Promise<void> {
        this.cache[key] = value
        await window.preferences.set(key, value)
    }

    getCached(key: string): unknown {
        return this.cache[key]
    }
}
