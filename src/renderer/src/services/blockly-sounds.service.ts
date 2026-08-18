import { resolve } from 'aurelia'
import { PreferencesService } from './preferences.service'

/**
 * App-wide toggle for Blockly's built-in click/connect/delete sound effects
 * (not per-device). Persisted via PreferencesService, same pattern as
 * ThemeService. exrail-block-canvas instances don't rebuild their Blockly
 * workspace on a settings change, so live toggling goes through onChange()
 * to mute/unmute each already-injected workspace's WorkspaceAudio directly.
 */
export class BlocklySoundsService {
    private readonly preferences = resolve(PreferencesService)
    private readonly listeners = new Set<(enabled: boolean) => void>()

    enabled = false

    /** Loads the persisted preference. Call once at startup. */
    async init(): Promise<void> {
        this.enabled = (await this.preferences.get<boolean>('blocklySoundsEnabled')) ?? false
    }

    /** Persists a new value and notifies already-mounted canvases — called from the Settings dialog. */
    async setEnabled(enabled: boolean): Promise<void> {
        this.enabled = enabled
        await this.preferences.set('blocklySoundsEnabled', enabled)
        this.listeners.forEach((callback) => callback(enabled))
    }

    /** Registers a callback fired whenever the setting changes. Returns an unsubscribe function. */
    onChange(callback: (enabled: boolean) => void): () => void {
        this.listeners.add(callback)
        return () => this.listeners.delete(callback)
    }
}
