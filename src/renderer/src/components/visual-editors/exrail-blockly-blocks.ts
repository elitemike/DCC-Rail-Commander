/**
 * Blockly block definitions for the EXRAIL block canvas — generated from
 * BLOCK_REGISTRY so the registry stays the single source of truth for block
 * shape/color/params/availability (exrail-block-registry.ts drives both this
 * and the compiler's text<->graph translation).
 *
 * `shape` maps onto Blockly connections as:
 *   hat    — nextStatement only (the fixed, single per-canvas root; never
 *            placed from the toolbox, see exrail-block-canvas.ts)
 *   stack  — previousStatement + nextStatement
 *   cap    — previousStatement only (Blockly structurally forbids connecting
 *            anything below a block with no next connection, which replaces
 *            the old EJ2 canvas's manual "DONE must be inside a branch" check)
 *   branch — previousStatement + nextStatement, plus a fixed THEN statement
 *            input and a fixed ELSE statement input (not a togglable
 *            mutator — EXRAIL only ever needs one condition + optional single
 *            else, never controls_if's arbitrary N-way if/elseif/else)
 */
import * as Blockly from 'blockly/core'
import * as BlocklyEnMsg from 'blockly/msg/en'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import { optionsForRefKind, REF_KINDS } from './exrail-block-compiler'
import type { BlockParamDef, BlockParamKind, BlockTypeDef, DefinedObjects } from './exrail-block-compiler'
import { MAX_SEQUENCE_ID, MIN_SEQUENCE_ID, parseAliasNumericValue, validateAliasName } from '../../utils/myAutomationParser'

// ── Live "defined objects" per workspace ────────────────────────────────────
// Ref-kind dropdown fields need the project's current turnouts/sensors/etc. at
// render time, but Blockly fields have no bindable props of their own — stash
// it per-workspace so every field on that workspace (present and future) reads
// the same live value without needing to be rebuilt when it changes.

const definedByWorkspace = new WeakMap<Blockly.Workspace, DefinedObjects>()

export function setWorkspaceDefined(ws: Blockly.Workspace, defined: DefinedObjects | null): void {
    if (defined) definedByWorkspace.set(ws, defined)
    else definedByWorkspace.delete(ws)
}

export function getWorkspaceDefined(ws: Blockly.Workspace): DefinedObjects | null {
    return definedByWorkspace.get(ws) ?? null
}

// ── Hat block ID/ALIAS edit notifications ───────────────────────────────────
// ExrailIdField/ExrailAliasField (below) report a committed edit to the host
// synchronously, from their own doValueUpdate_ — NOT via the workspace's
// change-listener event (Blockly.Events.BLOCK_CHANGE), which fires
// asynchronously (a later task, confirmed empirically — never in the same
// synchronous turn as the setFieldValue call that triggered it). That gap
// matters here specifically because the host can tear the workspace down
// (ExrailBlockCanvasCustomElement.reload(), on a route/sequence selection
// change) at any time, including in the same synchronous turn right after a
// field commit — e.g. the user presses Enter on the ID field, then
// immediately clicks a different row before the deferred change event has a
// chance to fire. Blockly reuses the literal block id `'hat'` for every
// route/sequence's hat block, so a `getBlockById('hat')` lookup inside a
// stale deferred event resolves to the *new* hat block, not the one that
// actually fired it — the host would silently apply the abandoned edit's
// value to the newly selected row instead. Every other field type (ref
// dropdowns, stack-block number/text fields) is fine going through the
// change-listener since a body edit is always compiled to text and diffed by
// value, not id — the hat's own id/alias directly targets a specific
// RouteEntry/SequenceEntry by reference, where "which entry" ambiguity is the
// entire failure mode above, hence the direct/synchronous path for hat fields
// specifically.
interface HatFieldCallbacks {
    onIdChange?: (id: number) => void
    onAliasChange?: (alias: string) => void
}
const hatCallbacksByWorkspace = new WeakMap<Blockly.Workspace, HatFieldCallbacks>()
const suppressedHatCallbackWorkspaces = new WeakSet<Blockly.Workspace>()

export function setWorkspaceHatCallbacks(ws: Blockly.Workspace, callbacks: HatFieldCallbacks | null): void {
    if (callbacks) hatCallbacksByWorkspace.set(ws, callbacks)
    else hatCallbacksByWorkspace.delete(ws)
}

/** Wraps a synchronous block of programmatic `setFieldValue()` calls (e.g. seeding the hat block
 *  from `headerId`/`headerAlias` on load) so they don't get reported back out as if the user had
 *  edited the field — see ExrailIdField/ExrailAliasField's doValueUpdate_ below. */
export function withHatCallbacksSuppressed<T>(ws: Blockly.Workspace, fn: () => T): T {
    suppressedHatCallbackWorkspaces.add(ws)
    try {
        return fn()
    } finally {
        suppressedHatCallbackWorkspaces.delete(ws)
    }
}

/**
 * Dropdown field for a ref-kind param (turnout/sensor/signal/roster/route-or-
 * sequence). Options are computed live from `getWorkspaceDefined()` every time
 * the dropdown opens (`getOptions()` override) rather than baked in at
 * construction, so one field instance stays correct as the project's objects
 * change without ever needing to be torn down and rebuilt.
 */
class ExrailRefField extends Blockly.FieldDropdown {
    private readonly kind: BlockParamKind

    constructor(kind: BlockParamKind, value?: string) {
        // FieldDropdown's constructor requires a non-empty static menu at
        // construction time — real options come from the getOptions() override
        // below, called fresh every time the dropdown is opened.
        super([['', '']])
        this.kind = kind
        if (value !== undefined) this.setValue(value)
    }

    /**
     * FieldDropdown's default validation rejects any value not already present
     * in getOptions() — but a param can legitimately reference a turnout/sensor/
     * etc. that isn't in `defined` yet (loaded before the project state that
     * would validate it, or referencing something since deleted). Accept the
     * raw value verbatim, exactly like the old plain-`<select>` param panel's
     * `value.bind` did; optionsForRefKind()'s "(not found)" fallback entry is
     * what keeps such a value visibly selectable in the dropdown, not this.
     */
    protected override doClassValidation_(newValue?: string): string | null {
        return newValue ?? null
    }

    override getOptions(_useCache?: boolean): Array<[string, string]> {
        const ws = this.getSourceBlock()?.workspace
        const defined = ws ? getWorkspaceDefined(ws) : null
        if (!defined) return [['(no objects defined)', '']]
        const current = this.getValue() ?? undefined
        const opts = optionsForRefKind(this.kind, defined, current)
        if (opts.length === 0) return [['(none defined)', '']]
        return opts.map((o) => [o.label, String(o.value)])
    }

    // Widened param type (rather than `{ kind: BlockParamKind; value?: string }`) so this
    // still structurally satisfies FieldDropdown's own `fromJson(FieldDropdownFromJsonConfig)`
    // static signature — Blockly's field registry calls this with the block JSON's raw args
    // entry, which for our fields always carries `kind` (see fieldJsonFor() below).
    static fromJson(options: Record<string, unknown>): ExrailRefField {
        return new ExrailRefField(options.kind as BlockParamKind, typeof options.value === 'string' ? options.value : undefined)
    }
}

/**
 * The hat block's ID field — editable directly on the block, per the
 * ROUTE/AUTOMATION/SEQUENCE shared id namespace (myAutomationParser.ts). Range/integer
 * constraints (1-32767, id 0 reserved) are enforced natively by FieldNumber's own
 * min/max/precision — a plain type-mismatch or out-of-range keystroke can't even commit.
 * Cross-entry uniqueness can't be checked that way (it depends on every other route/
 * sequence, not just this field), so it's surfaced as a non-blocking warning icon instead
 * of a hard revert — the authoritative reject-or-accept decision still happens host-side
 * (ExrailBlockCanvasCustomElement's onIdChange -> routes-editor.ts/sequences-editor.ts's
 * updateRoute()/updateSequence(), via ConfigEditorState.getSequenceIdViolations()) via a
 * toast, exactly like every other "edit an id used elsewhere" flow in this app (see
 * sensors-editor.ts). Silently reverting on a collision here would be more surprising than
 * helpful — the user might be mid-way through freeing up the old id from its other holder.
 */
class ExrailIdField extends Blockly.FieldNumber {
    constructor(value?: string | number) {
        super(value ?? MIN_SEQUENCE_ID, MIN_SEQUENCE_ID, MAX_SEQUENCE_ID, 1)
    }

    protected override doValueUpdate_(newValue: number): void {
        super.doValueUpdate_(newValue)
        this._updateWarning()
    }

    /**
     * FieldInput's own hook for "the user is done editing" (fired once from widgetDispose_ when
     * the inline editor closes — Enter or blur) — NOT doValueUpdate_, which fires on every
     * keystroke while the field is still open (each character typed re-validates and updates the
     * field's live value/warning icon). Reporting to the host from doValueUpdate_ instead would
     * call onIdChange once per keystroke, persisting every intermediate half-typed value along the
     * way — briefly correct in the end, but each of those intermediate writes is a real,
     * independently-committed state mutation (and toast, on a collision) that the user never
     * asked for. Programmatic sets (_applyHeaderFields()) never open the inline editor at all, so
     * this never fires for those regardless of the suppression check below.
     */
    override onFinishEditing_(value: number): void {
        const ws = this.getSourceBlock()?.workspace
        if (ws && !suppressedHatCallbackWorkspaces.has(ws)) {
            hatCallbacksByWorkspace.get(ws)?.onIdChange?.(Number(this.getValue() ?? value))
        }
    }

    private _updateWarning(): void {
        const block = this.getSourceBlock()
        if (!block) return
        const ws = block.workspace
        const defined = ws ? getWorkspaceDefined(ws) : null
        if (!defined) { block.setWarningText(null, 'id'); return }
        // ROUTE/AUTOMATION/SEQUENCE share one id namespace (see MIN/MAX_SEQUENCE_ID's own comment
        // in myAutomationParser.ts) — a route's id can collide with a sequence's (or vice versa),
        // not just another entry of its own type, so both collections are checked regardless of
        // which one this hat block itself is.
        const collides = [...(defined.routes ?? []), ...(defined.sequences ?? [])].some((entry) => entry.id === this.getValue())
        block.setWarningText(collides ? `ID ${this.getValue()} is already used by another route, sequence, or automation.` : null, 'id')
    }

    static override fromJson(options: Record<string, unknown>): ExrailIdField {
        return new ExrailIdField(typeof options.value === 'number' ? options.value : undefined)
    }
}

/**
 * The hat block's alias field — editable directly on the block. Blank means "no alias"
 * (valid). A non-blank value is checked live against validateAliasName() (same rule
 * myAliases.h's own alias-picker uses) and against every other alias already in scope, but
 * — same reasoning as ExrailIdField above — only ever as a non-blocking warning icon.
 * The authoritative accept/reject still happens host-side via
 * ConfigEditorState.syncAliasForId(), which is what actually persists (or refuses) the
 * rename to myAliases.h.
 */
class ExrailAliasField extends Blockly.FieldTextInput {
    protected override doValueUpdate_(newValue: string): void {
        super.doValueUpdate_(newValue)
        this._updateWarning()
    }

    /** See ExrailIdField.onFinishEditing_ above — same reasoning applies here. */
    override onFinishEditing_(value: string): void {
        const ws = this.getSourceBlock()?.workspace
        if (ws && !suppressedHatCallbackWorkspaces.has(ws)) {
            hatCallbacksByWorkspace.get(ws)?.onAliasChange?.((this.getValue() ?? value).trim())
        }
    }

    private _updateWarning(): void {
        const block = this.getSourceBlock()
        if (!block) return
        const trimmed = (this.getValue() ?? '').trim()
        if (trimmed === '') { block.setWarningText(null, 'alias'); return }
        const nameCheck = validateAliasName(trimmed)
        if (!nameCheck.ok) { block.setWarningText(nameCheck.reason, 'alias'); return }
        const ws = block.workspace
        const defined = ws ? getWorkspaceDefined(ws) : null
        const idField = block.getField('ID')
        const currentId = idField ? Number(idField.getValue()) : undefined
        const conflict = defined?.aliases.find((a) => a.name === trimmed && parseAliasNumericValue(a.value) !== currentId)
        block.setWarningText(conflict ? `Alias name "${trimmed}" is already used for a different ID.` : null, 'alias')
    }

    static override fromJson(options: Record<string, unknown>): ExrailAliasField {
        return new ExrailAliasField(typeof options.text === 'string' ? options.text : '')
    }
}

const EXRAIL_REF_FIELD_TYPE = 'field_exrail_ref'
const EXRAIL_ID_FIELD_TYPE = 'field_exrail_id'
const EXRAIL_ALIAS_FIELD_TYPE = 'field_exrail_alias'

function fieldJsonFor(param: BlockParamDef): Record<string, unknown> {
    if (REF_KINDS.has(param.kind)) {
        return { type: EXRAIL_REF_FIELD_TYPE, name: param.name, kind: param.kind }
    }
    if (param.kind === 'number') {
        return { type: 'field_number', name: param.name, value: 0 }
    }
    return { type: 'field_input', name: param.name, text: '' }
}

/** Builds the Blockly JSON block definition for one BLOCK_REGISTRY entry. */
function jsonFor(def: BlockTypeDef): Record<string, unknown> {
    const json: Record<string, unknown> = {
        type: def.id,
        colour: def.color,
        tooltip: def.label,
    }
    if (def.helpUrl) json.helpUrl = def.helpUrl

    if (def.shape === 'hat') {
        // The hat block's own id/alias isn't an EXRAIL emit param (compileBody() never emits the
        // hat node — see exrail-block-compiler.ts's walk()) — these two fields are editable
        // directly on the block, but what they edit (RouteEntry.id/myAliases.h) lives in
        // ConfigEditorState, not the compiled body. ExrailBlockCanvasCustomElement seeds them from
        // its headerId/headerAlias bindables and reports edits back out via onIdChange/
        // onAliasChange — see that file's _applyHeaderFields()/_onWorkspaceEvent().
        json.message0 = `${def.label} #%1 alias %2`
        json.args0 = [
            { type: EXRAIL_ID_FIELD_TYPE, name: 'ID', value: MIN_SEQUENCE_ID },
            { type: EXRAIL_ALIAS_FIELD_TYPE, name: 'ALIAS', text: '' },
        ]
    } else {
        const paramPlaceholders = def.params.map((_, i) => `%${i + 1}`).join(' ')
        json.message0 = def.params.length > 0 ? `${def.label} ${paramPlaceholders}` : def.label
        if (def.params.length > 0) {
            json.args0 = def.params.map(fieldJsonFor)
        }
    }

    if (def.shape === 'branch') {
        json.message1 = '%1'
        json.args1 = [{ type: 'input_statement', name: 'THEN' }]
        json.message2 = 'else'
        json.message3 = '%1'
        json.args3 = [{ type: 'input_statement', name: 'ELSE' }]
    }

    if (def.shape !== 'hat') json.previousStatement = null
    if (def.shape !== 'cap') json.nextStatement = null

    return json
}

let registered = false

/**
 * Registers every BLOCK_REGISTRY entry as a Blockly block type, plus the
 * shared ref-dropdown field type they use. Idempotent (registering the same
 * type twice just overwrites the previous definition, which Blockly allows —
 * no HMR-survival guard is needed the way Monaco's provider registration
 * requires, since that API accumulates duplicates on repeat calls and this
 * one doesn't).
 */
export function registerExrailBlocks(): void {
    if (registered) return
    registered = true
    // Blockly.Msg's UI strings (ARIA labels, trash can/zoom tooltips, ...) are never populated
    // without this — left unset, Blockly's own internal code crashes trying to call .replace()
    // on an undefined message string the moment inject() starts building the workspace's ARIA
    // context, aborting inject() before the toolbox or any block is ever created.
    Blockly.setLocale(BlocklyEnMsg as unknown as Record<string, string>)
    Blockly.fieldRegistry.register(EXRAIL_REF_FIELD_TYPE, ExrailRefField)
    Blockly.fieldRegistry.register(EXRAIL_ID_FIELD_TYPE, ExrailIdField)
    Blockly.fieldRegistry.register(EXRAIL_ALIAS_FIELD_TYPE, ExrailAliasField)
    Blockly.defineBlocksWithJsonArray(BLOCK_REGISTRY.map(jsonFor))
}
