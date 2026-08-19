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

const EXRAIL_REF_FIELD_TYPE = 'field_exrail_ref'

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
        // hat node — see exrail-block-compiler.ts's walk()) — it's a display-only label the host
        // editor pushes in via ExrailBlockCanvasCustomElement.headerLabel, purely so the canvas
        // shows which route/sequence this body belongs to.
        json.message0 = `${def.label} %1`
        json.args0 = [{ type: 'field_label', name: 'HEADER_LABEL', text: '' }]
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
    Blockly.defineBlocksWithJsonArray(BLOCK_REGISTRY.map(jsonFor))
}
