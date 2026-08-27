/**
 * Palette (block list) for the EXRAIL block canvas — a *custom* nested-category
 * sidebar (rendered by exrail-block-canvas.html/.ts) driving Blockly's
 * flyout-only toolbox (https://docs.blockly.com/guides/configure/toolboxes/flyout/):
 * a single set of blocks displayed at all times, reserving its own permanent
 * space next to the workspace.
 *
 * Deliberately NOT Blockly's own category-toolbox
 * (https://docs.blockly.com/guides/configure/toolboxes/nested/) — that class's
 * flyout is *always* a floating overlay when a category opens (there is no
 * config to make it a reserved, non-overlapping panel the way a flyout-only
 * toolbox is; the two are structurally different toolbox classes), which hides
 * the workspace behind it with no way to see both at once. Building the
 * category tree ourselves keeps the always-visible, non-overlapping flyout
 * while still giving nested categories (Locomotives > Driving/Functions).
 *
 * The tree and each leaf's contents are built entirely from each
 * BLOCK_REGISTRY entry's `category` field (e.g. 'Turnouts' or
 * 'Locomotives/Driving', slash-separated for one level of nesting) so the
 * registry stays the single place a block's palette location is decided.
 */
import type { BlockTypeDef, DefinedObjects } from './exrail-block-compiler'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import { optionsForRefKind, REF_KINDS } from './exrail-block-compiler'

/**
 * First available option per ref-kind param, so a freshly dragged block (e.g. THROW) starts
 * pointing at a real turnout instead of blank — mirrors the old canvas's
 * _defaultParamValues()/_firstAvailableId(). Exported for exrail-block-canvas.ts's `emptyRoot()`,
 * which reuses it to seed a brand-new param-flavored hat's (e.g. ONSENSOR) own fields the same
 * way a toolbox flyout preview block seeds its ref-kind params.
 */
export function defaultFieldsFor(def: BlockTypeDef, defined: DefinedObjects): Record<string, string> {
    const fields: Record<string, string> = {}
    for (const p of def.params) {
        if (!REF_KINDS.has(p.kind)) continue
        const opts = optionsForRefKind(p.kind, defined, undefined)
        if (opts.length > 0) fields[p.name] = String(opts[0].value)
    }
    return fields
}

export interface PaletteCategoryNode {
    /** This node's own label, e.g. 'Driving'. */
    name: string
    /** Full slash-separated path from the root, e.g. 'Locomotives/Driving' — matches BlockTypeDef.category exactly for a leaf. */
    path: string
    colour?: string
    /** Non-empty only for a parent node (e.g. 'Locomotives') — a parent has no blocks of its own, only leaves do. */
    children: PaletteCategoryNode[]
    /**
     * Whether a parent node's children are currently shown. Deliberately a plain property read
     * directly by the template (`node.expanded`), never through a method call like
     * `isExpanded(node.path)` — Aurelia's template compiler can set up a live observer for a
     * direct property-access path, but has no way to know a method's return value depends on
     * component state it never sees, so a method-call binding never re-evaluates after the
     * state it reads changes. See exrail-block-canvas.ts's _rebuildPaletteTree(), which is what
     * keeps this in sync with expandedCategoryPaths across tree rebuilds.
     */
    expanded: boolean
}

/** Builds the nested category tree for every currently-available (non-hat) block, grouped by
 *  `category`. `allowTriggerMarkers` gates the "Also on ..." marker blocks (BlockTypeDef.
 *  triggerMarkerFor) — they only make sense stacked under a param-flavored hat (event handlers),
 *  never a ROUTE/SEQUENCE/AUTOMATION body, where there'd be nothing for them to structurally
 *  connect to (see exrail-blockly-blocks.ts's jsonFor() connection checks) — so they're kept out
 *  of the palette entirely rather than shown but silently undroppable. */
export function buildCategoryTree(defined: DefinedObjects | null, allowTriggerMarkers = false): PaletteCategoryNode[] {
    const root: PaletteCategoryNode = { name: '', path: '', children: [], expanded: false }
    if (!defined) return root.children
    const byPath = new Map<string, PaletteCategoryNode>([['', root]])

    for (const def of BLOCK_REGISTRY) {
        if (def.shape === 'hat') continue
        if (def.triggerMarkerFor !== undefined && !allowTriggerMarkers) continue
        if (!def.isAvailable(defined)) continue
        const parts = def.category.split('/')
        let parentPath = ''
        for (const part of parts) {
            const path = parentPath ? `${parentPath}/${part}` : part
            let node = byPath.get(path)
            if (!node) {
                node = { name: part, path, children: [], expanded: false }
                byPath.get(parentPath)!.children.push(node)
                byPath.set(path, node)
            }
            node.colour = def.color
            parentPath = path
        }
    }

    return root.children
}

/** Flyout-only toolbox JSON for every currently-available block whose `category` is exactly `path`
 *  (a leaf) — see buildCategoryTree()'s `allowTriggerMarkers` for what that flag gates here too. */
export function flatToolboxForPath(path: string, defined: DefinedObjects | null, allowTriggerMarkers = false): Record<string, unknown> {
    if (!defined || path === '') return { contents: [] }
    const contents = BLOCK_REGISTRY
        .filter((b) => b.shape !== 'hat' && (allowTriggerMarkers || b.triggerMarkerFor === undefined) && b.category === path && b.isAvailable(defined))
        .map((def) => ({ kind: 'block', type: def.id, fields: defaultFieldsFor(def, defined) }))
    return { contents }
}

/** First leaf category's path, depth-first — used as the default selection when no leaf is currently selected/valid. */
export function firstLeafPath(nodes: PaletteCategoryNode[]): string {
    for (const node of nodes) {
        if (node.children.length === 0) return node.path
        const nested = firstLeafPath(node.children)
        if (nested !== '') return nested
    }
    return ''
}
