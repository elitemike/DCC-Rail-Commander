import { resolve } from 'aurelia'
import { PreferencesService } from './preferences.service'

export type AliasSortOrder = 'name' | 'id'

/**
 * App-wide preference for how aliases are ordered within each type group, both in the
 * aliases editor and in the generated myAliases.h. Persisted via PreferencesService,
 * same pattern as EditorDefaultViewService.
 */
export class AliasSortOrderService {
    private readonly preferences = resolve(PreferencesService)

    value: AliasSortOrder = 'name'

    /** Loads the persisted preference. Call once at startup. */
    async init(): Promise<void> {
        this.value = (await this.preferences.get<AliasSortOrder>('aliasSortOrder')) ?? 'name'
    }

    /** Persists a new value — called from the Settings dialog. */
    async setValue(order: AliasSortOrder): Promise<void> {
        this.value = order
        await this.preferences.set('aliasSortOrder', order)
    }
}
