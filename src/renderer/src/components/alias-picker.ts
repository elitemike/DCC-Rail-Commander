import { IObserverLocator, bindable, queueTask, resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import type { AliasTargetType } from '../utils/myAutomationParser'

/** Shown as the input's `title` tooltip — mirrors validateAliasName() in myAutomationParser.ts. */
export const ALIAS_NAME_HINT = 'Letters, numbers, and underscores only; must start with a letter or underscore. Can\'t be an EXRAIL command name.'

/**
 * alias-picker — myAliases.h alias field for a single (id, type) pair.
 *
 * Freeform text, not a dropdown: an alias is typed, not picked, and EX-RAIL
 * validates the name itself (see ALIAS_NAME_HINT/validateAliasName). Pickers
 * that offer a dropdown of known objects belong where a sequence/route body
 * is being *built* (e.g. exrail-block-canvas's `turnoutRef` <select>), not
 * here where the alias itself is being *defined*.
 *
 * Turnout/roster editors manage their own plain `<input>` inline because only
 * one entry is ever being edited at a time (edit-buffer + detail pane).
 * Editors that show every entry inline in a repeat.for (e.g. sensors) need
 * one alias field *per row*, so that management is pulled out into its own
 * custom element — each row gets its own instance/lifecycle for free instead
 * of the parent hand-rolling an array of inputs.
 *
 * The picker resolves its own current alias name from `targetId`/`aliasType`
 * rather than taking it as a bindable `value`, and only reports the user's
 * choice back via `onChange` (on blur, and only when it actually changed) —
 * callers decide how (and whether) to persist it, e.g. via
 * ConfigEditorState.syncAliasForId.
 */
export class AliasPickerCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly observerLocator = resolve(IObserverLocator)

    // NOT named `id` — that collides with the native HTMLElement `id`
    // attribute/property on the custom element itself, so `id.bind` from a
    // template silently updates the DOM id instead of this bindable.
    @bindable targetId = 0
    @bindable aliasType: AliasTargetType | null = null
    @bindable onChange: ((name: string) => void) | null = null

    readonly hint = ALIAS_NAME_HINT
    inputValue = ''
    private _detached = false

    private readonly _subscriber = {
        handleChange: () => {
            // Deferred: aliases can be mutated synchronously from inside this
            // field's own blur -> commit() -> onChange -> syncAliasForId, and
            // this subscriber fires as part of that same mutation.
            queueTask(() => {
                if (this._detached) return
                this._refresh()
            })
        },
    }

    attached(): void {
        this._detached = false
        this.observerLocator.getObserver(this.state, 'aliases').subscribe(this._subscriber)
        this._refresh()
    }

    detaching(): void {
        this._detached = true
        this.observerLocator.getObserver(this.state, 'aliases').unsubscribe(this._subscriber)
    }

    targetIdChanged(): void {
        this._refresh()
    }

    aliasTypeChanged(): void {
        this._refresh()
    }

    private get currentName(): string {
        return this.state.getPrimaryAliasNameForId(this.targetId, this.aliasType ?? undefined)
    }

    private _refresh(): void {
        if (this._detached) return
        this.inputValue = this.currentName
    }

    /** `blur.trigger` in the template — only reports upward when the text actually changed, so tabbing through without editing doesn't mark the form dirty. */
    commit(): void {
        const trimmed = this.inputValue.trim()
        if (trimmed === this.currentName.trim()) return
        this.onChange?.(trimmed)
    }
}
