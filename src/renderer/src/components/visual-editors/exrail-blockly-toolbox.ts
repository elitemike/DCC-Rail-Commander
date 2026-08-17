/**
 * Palette (block list) for the EXRAIL block canvas — three fixed groups,
 * Actions/Conditions/Ends, matching the old EJ2 SymbolPalette's groupings.
 *
 * Deliberately NOT Blockly's category-toolbox (a sidebar of category labels
 * whose flyout pops up and overlays the workspace when clicked, then closes)
 * — that pattern hid the workspace behind the flyout with no way to see both
 * at once. Instead this builds a "simple" toolbox: a flat, always-visible
 * flyout with no categories of its own (Blockly reserves it permanent space
 * next to the workspace rather than overlaying it), and exrail-block-canvas.ts
 * supplies its own Actions/Conditions/Ends tab buttons that swap which
 * BLOCK_REGISTRY group populates it via `workspace.updateToolbox()`.
 */
import type { BlockTypeDef, DefinedObjects } from './exrail-block-compiler'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import { optionsForRefKind, REF_KINDS } from './exrail-block-compiler'

/** First available option per ref-kind param, so a freshly dragged block (e.g. THROW) starts pointing at a real turnout instead of blank — mirrors the old canvas's _defaultParamValues()/_firstAvailableId(). */
function defaultFieldsFor(def: BlockTypeDef, defined: DefinedObjects): Record<string, string> {
    const fields: Record<string, string> = {}
    for (const p of def.params) {
        if (!REF_KINDS.has(p.kind)) continue
        const opts = optionsForRefKind(p.kind, defined, undefined)
        if (opts.length > 0) fields[p.name] = String(opts[0].value)
    }
    return fields
}

/** Simple (non-category) toolbox JSON showing every available block of `shape` — the currently selected tab's contents. */
export function flatToolboxFor(shape: BlockTypeDef['shape'], defined: DefinedObjects | null): Record<string, unknown> {
    if (!defined) return { contents: [] }
    const contents = BLOCK_REGISTRY
        .filter((b) => b.shape === shape && b.isAvailable(defined))
        .map((def) => ({ kind: 'block', type: def.id, fields: defaultFieldsFor(def, defined) }))
    return { contents }
}
