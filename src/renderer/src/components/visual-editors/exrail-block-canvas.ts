import { bindable, BindingMode, resolve } from 'aurelia'
import * as Blockly from 'blockly/core'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import { canonicalRefValue, parseBody, compileBody } from './exrail-block-compiler'
import type { BlockTypeDef, DefinedObjects, ParsedGraph } from './exrail-block-compiler'
import { registerExrailBlocks, setWorkspaceDefined } from './exrail-blockly-blocks'
import { buildGraphFromWorkspace, buildWorkspaceFromGraph } from './exrail-blockly-bridge'
import { flatToolboxFor } from './exrail-blockly-toolbox'
import { ThemeService } from '../../services/theme.service'

/** Palette tabs shown above the canvas — matches the old EJ2 SymbolPalette's groupings. */
export const PALETTE_TABS: Array<{ shape: BlockTypeDef['shape']; label: string }> = [
    { shape: 'stack', label: 'Actions' },
    { shape: 'branch', label: 'Conditions' },
    { shape: 'cap', label: 'Ends' },
]

/** Workspace chrome only (background/toolbox/flyout/scrollbar) — block fill colors come straight from each BLOCK_REGISTRY entry's own `color`, set per-block via JSON, not from theme block styles. */
let themesDefined = false
const EXRAIL_LIGHT_THEME_NAME = 'exrail-light'
const EXRAIL_DARK_THEME_NAME = 'exrail-dark'

function defineExrailThemes(): void {
    if (themesDefined) return
    themesDefined = true
    Blockly.Theme.defineTheme(EXRAIL_LIGHT_THEME_NAME, {
        name: EXRAIL_LIGHT_THEME_NAME,
        base: Blockly.Themes.Classic,
        componentStyles: {
            workspaceBackgroundColour: '#f9fafb',
            toolboxBackgroundColour: '#f3f4f6',
            toolboxForegroundColour: '#111827',
            flyoutBackgroundColour: '#ffffff',
            flyoutForegroundColour: '#111827',
            flyoutOpacity: 1,
            scrollbarColour: '#9ca3af',
            insertionMarkerColour: '#3b82f6',
            insertionMarkerOpacity: 0.3,
        },
    })
    Blockly.Theme.defineTheme(EXRAIL_DARK_THEME_NAME, {
        name: EXRAIL_DARK_THEME_NAME,
        base: Blockly.Themes.Classic,
        componentStyles: {
            workspaceBackgroundColour: '#111827',
            toolboxBackgroundColour: '#1f2937',
            toolboxForegroundColour: '#e5e7eb',
            flyoutBackgroundColour: '#1f2937',
            flyoutForegroundColour: '#e5e7eb',
            flyoutOpacity: 1,
            scrollbarColour: '#4b5563',
            insertionMarkerColour: '#3b82f6',
            insertionMarkerOpacity: 0.3,
        },
    })
}

function themeFor(effective: 'light' | 'dark'): Blockly.Theme {
    return Blockly.registry.getObject(Blockly.registry.Type.THEME, effective === 'dark' ? EXRAIL_DARK_THEME_NAME : EXRAIL_LIGHT_THEME_NAME) as Blockly.Theme
}

/** Structural events that actually change the compiled graph — UI-only events (selection, click, viewport) are ignored. */
const STRUCTURAL_EVENT_TYPES = new Set<string>([
    Blockly.Events.BLOCK_MOVE,
    Blockly.Events.BLOCK_CHANGE,
    Blockly.Events.BLOCK_CREATE,
    Blockly.Events.BLOCK_DELETE,
])

/**
 * Drag-and-drop EXRAIL block canvas for a single route/sequence body — wraps
 * Google Blockly (this repo's Monaco/EJ2-style pattern: construct imperatively
 * in attached()/reload(), tear down in detaching()/reload(), rather than a
 * framework wrapper). Blockly's own toolbox flyout drag-and-connect and
 * statement-input nesting replace what used to be hand-rolled drop/snap/
 * layout logic against EJ2 Diagrams — see exrail-blockly-blocks.ts (block
 * definitions), exrail-blockly-toolbox.ts (dynamic palette), and
 * exrail-blockly-bridge.ts (graph<->workspace translation; parseBody()/
 * compileBody() in exrail-block-compiler.ts remain the sole source of truth
 * for EXRAIL text<->graph translation).
 */
export class ExrailBlockCanvasCustomElement {
    private readonly themeService = resolve(ThemeService)

    @bindable kind: 'route' | 'sequence' = 'route'
    @bindable({ mode: BindingMode.oneTime }) initialBody = ''
    @bindable defined: DefinedObjects | null = null
    @bindable onBodyChange: ((body: string) => void) | null = null

    private container!: HTMLElement
    private workspace: Blockly.WorkspaceSvg | null = null
    private _resizeObserver: ResizeObserver | null = null
    private _unsubTheme: (() => void) | null = null
    private _changeListener: ((e: Blockly.Events.Abstract) => void) | null = null
    private _suppressChange = false
    private _detached = false

    parseError: string | null = null
    /** Which palette tab is currently populating the always-visible flyout — defaults to Actions. */
    selectedCategory: BlockTypeDef['shape'] = 'stack'

    get paletteTabs(): typeof PALETTE_TABS {
        return PALETTE_TABS
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    attached(): void {
        this._detached = false
        registerExrailBlocks()
        defineExrailThemes()
        this._build()
    }

    detaching(): void {
        this._detached = true
        this._resizeObserver?.disconnect()
        this._resizeObserver = null
        this._unsubTheme?.()
        this._unsubTheme = null
        if (this.workspace && this._changeListener) this.workspace.removeChangeListener(this._changeListener)
        this._changeListener = null
        try { this.workspace?.dispose() } catch { /* already broken — nothing to clean up */ }
        this.workspace = null
    }

    /**
     * Rebuilds the workspace from a new body without waiting for this element to be torn down and
     * re-attached — sequences-editor/routes-editor's master-detail views reuse this same element
     * across a row/sequence selection change, and `initialBody` is `oneTime` so it never re-reads
     * on its own. Called via `component.ref` whenever the host's selection changes underneath an
     * already-mounted canvas. Clears the workspace's blocks rather than disposing/re-injecting the
     * whole Blockly instance, so the toolbox/flyout chrome isn't rebuilt on every row switch.
     */
    reload(body: string): void {
        this.initialBody = body
        this.parseError = null
        if (this._detached || !this.workspace) return
        this.workspace.clear()
        this._loadInto(this.workspace)
    }

    definedChanged(): void {
        if (!this.workspace) return
        setWorkspaceDefined(this.workspace, this.defined)
        this.workspace.updateToolbox(flatToolboxFor(this.selectedCategory, this.defined) as unknown as Blockly.utils.toolbox.ToolboxDefinition)
        this._normalizeExistingBlocks()
    }

    /** Switches which BLOCK_REGISTRY group populates the always-visible flyout — called by the Actions/Conditions/Ends tab buttons. */
    selectCategory(shape: BlockTypeDef['shape']): void {
        this.selectedCategory = shape
        this.workspace?.updateToolbox(flatToolboxFor(shape, this.defined) as unknown as Blockly.utils.toolbox.ToolboxDefinition)
    }

    private _build(): void {
        if (!this.container) return
        this.workspace = Blockly.inject(this.container, {
            // A flat (non-category) toolbox — Blockly reserves this permanent space next to the
            // workspace rather than the popup-on-click, overlay-and-close behavior a category
            // toolbox's flyout has. selectCategory() swaps its contents via updateToolbox().
            toolbox: flatToolboxFor(this.selectedCategory, this.defined) as unknown as Blockly.utils.toolbox.ToolboxDefinition,
            // Served from src/renderer/public/blockly-media/ (Vite's publicDir, copied verbatim
            // into the build output) — without this, Blockly defaults to fetching its icon/sound
            // sprites from static.blockly.com, which the app's CSP blocks (img-src/connect-src
            // 'self' only) and which would be unwanted network access regardless.
            media: './blockly-media/',
            trashcan: true,
            zoom: { controls: true, wheel: true, startScale: 1 },
            move: { scrollbars: true, drag: true, wheel: false },
            theme: themeFor(this.themeService.effective),
        })
        setWorkspaceDefined(this.workspace, this.defined)
        this._loadInto(this.workspace)

        this._changeListener = (e: Blockly.Events.Abstract) => this._onWorkspaceEvent(e)
        this.workspace.addChangeListener(this._changeListener)

        this._resizeObserver = new ResizeObserver(() => {
            if (this.workspace) Blockly.svgResize(this.workspace)
        })
        this._resizeObserver.observe(this.container)

        this._unsubTheme = this.themeService.onChange((effective) => {
            this.workspace?.setTheme(themeFor(effective))
        })
    }

    private _loadInto(workspace: Blockly.WorkspaceSvg): void {
        const graph = this._loadGraph()
        this._suppressChange = true
        try {
            buildWorkspaceFromGraph(workspace, graph, BLOCK_REGISTRY)
        } finally {
            this._suppressChange = false
        }
    }

    private _loadGraph(): ParsedGraph {
        const emptyRoot = (): ParsedGraph => ({
            nodes: [{ id: 'hat', info: { blockTypeId: this.kind === 'route' ? 'ROUTE' : 'SEQUENCE', paramValues: {} } }],
            connectors: [],
            hatNodeId: 'hat',
        })
        if (this.initialBody.trim() === '') return emptyRoot()
        const result = parseBody(this.initialBody, this.kind, BLOCK_REGISTRY)
        if (!result.ok) {
            this.parseError = result.reason
            return emptyRoot()
        }
        this.parseError = null
        return result.graph
    }

    private _onWorkspaceEvent(e: Blockly.Events.Abstract): void {
        if (this._suppressChange) return
        if (!e.type || !STRUCTURAL_EVENT_TYPES.has(e.type)) return
        this._commitNow()
    }

    private _commitNow(): void {
        if (!this.workspace) return
        const graph = buildGraphFromWorkspace(this.workspace, BLOCK_REGISTRY)
        const text = compileBody(graph, BLOCK_REGISTRY)
        this.onBodyChange?.(text)
    }

    /**
     * A ref param loaded (or dropped) as a raw numeric id gets hidden from its dropdown's
     * options the moment an alias covers that id (see optionsForRefKind()'s dedupe) — left
     * as-is, the field would show "N (not found)" even though the reference is perfectly
     * valid, just no longer the canonical way to write it. Rewrites any such stored value to
     * the alias name so the dropdown selects correctly, and recompiles so the file itself is
     * kept in the same canonical form the dropdown now shows. Runs whenever `defined` changes
     * (an alias can be added after the canvas already loaded a body referencing that object
     * by id).
     */
    private _normalizeExistingBlocks(): void {
        if (!this.workspace || !this.defined) return
        const defined = this.defined
        const byId = new Map(BLOCK_REGISTRY.map((b) => [b.id, b]))
        let changed = false
        this._suppressChange = true
        try {
            for (const block of this.workspace.getAllBlocks(false)) {
                const def = byId.get(block.type)
                if (!def) continue
                for (const p of def.params) {
                    const raw = block.getFieldValue(p.name)
                    if (raw === null || raw === undefined) continue
                    const canonical = canonicalRefValue(p.kind, defined, raw)
                    if (String(canonical) !== String(raw)) {
                        block.setFieldValue(String(canonical), p.name)
                        changed = true
                    }
                }
            }
        } finally {
            this._suppressChange = false
        }
        if (changed) this._commitNow()
    }
}
