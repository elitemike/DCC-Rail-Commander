import { resolve } from 'aurelia'
import { PreferencesService } from './preferences.service'

export type EditorViewMode = 'visual' | 'raw'

/**
 * App-wide default for which tab (Visual or Raw) a config file editor opens
 * on. Persisted via PreferencesService, same pattern as BlocklySoundsService.
 * Editors read `.value` once at construction, so this only governs the
 * default for editors opened after the setting changes — it doesn't retab
 * an editor that's already mounted.
 */
export class EditorDefaultViewService {
    private readonly preferences = resolve(PreferencesService)

    value: EditorViewMode = 'visual'

    /** Loads the persisted preference. Call once at startup. */
    async init(): Promise<void> {
        this.value = (await this.preferences.get<EditorViewMode>('defaultEditorView')) ?? 'visual'
    }

    /** Persists a new value — called from the Settings dialog. */
    async setValue(mode: EditorViewMode): Promise<void> {
        this.value = mode
        await this.preferences.set('defaultEditorView', mode)
    }
}
