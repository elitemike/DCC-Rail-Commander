import { bindable, BindingMode, queueTask, resolve } from 'aurelia'
import * as Blockly from 'blockly/core'
import { Splitter } from '@syncfusion/ej2-layouts'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import { canonicalRefValue, parseBody, compileBody } from './exrail-block-compiler'
import type { DefinedObjects, ParsedGraph } from './exrail-block-compiler'
import { registerExrailBlocks, setWorkspaceDefined } from './exrail-blockly-blocks'
import { buildGraphFromWorkspace, buildWorkspaceFromGraph } from './exrail-blockly-bridge'
import { buildCategoryTree, firstLeafPath, flatToolboxForPath } from './exrail-blockly-toolbox'
import type { PaletteCategoryNode } from './exrail-blockly-toolbox'
import { ThemeService } from '../../services/theme.service'
import { BlocklySoundsService } from '../../services/blockly-sounds.service'

/** Workspace chrome only (background/toolbox/flyout/scrollbar) — block fill colors come straight from each BLOCK_REGISTRY entry's own `color`, set per-block via JSON, not from theme block styles. */
let themesDefined = false
const EXRAIL_LIGHT_THEME_NAME = 'exrail-light'
const EXRAIL_DARK_THEME_NAME = 'exrail-dark'

function defineExrailThemes(): void {
    if (themesDefined) return
    themesDefined = true
    // Blockly's default scrollbar (15px) reads as noticeably thicker than this app's own native
    // scrollbars — a static, workspace-independent setting (Blockly.Scrollbar has no per-instance
    // thickness option), so it only needs setting once, here.
    Blockly.Scrollbar.scrollbarThickness = 8
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
    private readonly blocklySounds = resolve(BlocklySoundsService)

    @bindable kind: 'route' | 'sequence' = 'route'
    @bindable({ mode: BindingMode.oneTime }) initialBody = ''
    @bindable defined: DefinedObjects | null = null
    @bindable onBodyChange: ((body: string) => void) | null = null
    /** Display-only id/alias text shown next to "Route"/"Sequence" on the hat block — see the
     *  HEADER_LABEL field comment in exrail-blockly-blocks.ts. Not part of the compiled graph. */
    @bindable headerLabel = ''

    private container!: HTMLElement
    private workspace: Blockly.WorkspaceSvg | null = null
    private _resizeObserver: ResizeObserver | null = null
    private _visibilityObserver: IntersectionObserver | null = null
    private _unsubTheme: (() => void) | null = null
    private _unsubBlocklySounds: (() => void) | null = null
    private _changeListener: ((e: Blockly.Events.Abstract) => void) | null = null
    private _suppressChange = false
    private _detached = false
    private splitterObj: Splitter | null = null

    parseError: string | null = null
    /** Compiled EXRAIL text for the always-visible readonly output pane — kept in sync with the
     *  workspace by _refreshOutput(), called from every point that changes what the workspace would
     *  compile to (initial/reloaded load, structural edits). Deliberately a plain display field, not
     *  round-tripped through onBodyChange — see that bindable's own call sites for why loads don't
     *  push a body back out to the host editor. */
    outputText = ''

    /** Custom nested-category sidebar state — see exrail-blockly-toolbox.ts for why this isn't Blockly's own category toolbox. */
    paletteTree: PaletteCategoryNode[] = []
    selectedLeafPath = ''
    expandedCategoryPaths: string[] = []

    // ── Lifecycle ──────────────────────────────────────────────────────────

    attached(): void {
        this._detached = false
        registerExrailBlocks()
        defineExrailThemes()
        this._build()
        // Deferred (same convention as routes-editor.ts/sequences-editor.ts's own Splitter setup):
        // the palette+canvas row and the output pane below are already rendered as static DOM by the
        // time attached() runs, so appendTo() just wraps them — no need to wait on Blockly itself.
        queueTask(() => {
            if (this._detached || !document.getElementById('exrail-output-splitter')) return
            const savedSize = this._loadOutputPaneWidth()
            this.splitterObj = new Splitter({
                paneSettings: [
                    {},
                    { size: savedSize, min: '160px', max: '480px' },
                ],
                width: '100%',
                height: '100%',
                resizeStop: () => {
                    const pane = document.querySelector('#exrail-output-splitter > div:last-child') as HTMLElement
                    if (pane) this._saveOutputPaneWidth(`${pane.offsetWidth}px`)
                },
            })
            this.splitterObj.appendTo('#exrail-output-splitter')
        })
    }

    detaching(): void {
        this._detached = true
        this._resizeObserver?.disconnect()
        this._resizeObserver = null
        this._visibilityObserver?.disconnect()
        this._visibilityObserver = null
        this._unsubTheme?.()
        this._unsubTheme = null
        this._unsubBlocklySounds?.()
        this._unsubBlocklySounds = null
        if (this.workspace && this._changeListener) this.workspace.removeChangeListener(this._changeListener)
        this._changeListener = null
        try { this.workspace?.dispose() } catch { /* already broken — nothing to clean up */ }
        this.workspace = null
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.splitterObj = null
    }

    private _loadOutputPaneWidth(): string {
        try { return localStorage.getItem('exrail-block-canvas-output-width') ?? '280px' } catch { return '280px' }
    }
    private _saveOutputPaneWidth(size: string): void {
        try { localStorage.setItem('exrail-block-canvas-output-width', size) } catch { /* ignore */ }
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
        // clear()/reload never itself resizes the container, but re-forces Blockly's own cached
        // metrics (scrollbar geometry, zoom-control position) to match it regardless — cheap
        // insurance against the same staleness the visibility observer above guards against, in
        // case a resize happened while this instance sat unobserved-but-unchanged between reloads.
        Blockly.svgResize(this.workspace)
    }

    definedChanged(): void {
        if (!this.workspace) return
        setWorkspaceDefined(this.workspace, this.defined)
        this._rebuildPaletteTree()
        this.workspace.updateToolbox(flatToolboxForPath(this.selectedLeafPath, this.defined) as unknown as Blockly.utils.toolbox.ToolboxDefinition)
        this._normalizeExistingBlocks()
    }

    /**
     * Rebuilds the custom sidebar tree from the current `defined` objects (categories can appear/
     * disappear as the project's turnouts/sensors/roster/etc. change — see BLOCK_REGISTRY's
     * isAvailable()), keeping the current leaf selection if it's still valid or falling back to the
     * first available leaf otherwise. Does not itself push the new leaf's blocks into the toolbox —
     * callers (definedChanged()/_build()) do that afterwards since only they know whether the
     * workspace exists yet.
     */
    private _rebuildPaletteTree(): void {
        this.paletteTree = buildCategoryTree(this.defined)
        const stillValid = this.selectedLeafPath !== '' && BLOCK_REGISTRY.some((b) => b.category === this.selectedLeafPath && b.shape !== 'hat' && this.defined && b.isAvailable(this.defined))
        if (!stillValid) this.selectedLeafPath = firstLeafPath(this.paletteTree)
        const parentPath = this.selectedLeafPath.includes('/') ? this.selectedLeafPath.slice(0, this.selectedLeafPath.lastIndexOf('/')) : ''
        if (parentPath !== '' && !this.expandedCategoryPaths.includes(parentPath)) {
            this.expandedCategoryPaths = [...this.expandedCategoryPaths, parentPath]
        }
        // buildCategoryTree() above returns brand-new node objects every call, so restamp each
        // one's `expanded` from the durable (path-keyed) expandedCategoryPaths — see that field's
        // comment on PaletteCategoryNode for why the template reads `node.expanded` directly rather
        // than calling back into this component.
        for (const node of this.paletteTree) {
            if (node.children.length > 0) node.expanded = this.expandedCategoryPaths.includes(node.path)
        }
    }

    /**
     * Forces Blockly to recompute its size against the container's current bounding rect —
     * exposed for the host editor (routes-editor.ts/sequences-editor.ts) to call explicitly right
     * after switching the file-level tab back to Visual, the same way they already force Monaco's
     * raw editor to re-layout when switching to Raw. Belt-and-suspenders alongside the
     * IntersectionObserver in _build(): that observer's callback timing isn't guaranteed to land
     * before the user starts interacting, so the host calling this directly at the one moment it
     * knows the tab just became visible is the more deterministic fix.
     */
    refreshSize(): void {
        if (this.workspace) Blockly.svgResize(this.workspace)
    }

    /** Toggles a parent category open/closed, or selects a leaf category's blocks into the always-visible flyout. */
    onCategoryClick(node: PaletteCategoryNode): void {
        if (node.children.length > 0) {
            node.expanded = !node.expanded
            this.expandedCategoryPaths = node.expanded
                ? [...this.expandedCategoryPaths, node.path]
                : this.expandedCategoryPaths.filter((p) => p !== node.path)
            return
        }
        this.selectedLeafPath = node.path
        this.workspace?.updateToolbox(flatToolboxForPath(node.path, this.defined) as unknown as Blockly.utils.toolbox.ToolboxDefinition)
    }

    private _build(): void {
        if (!this.container) return
        this._rebuildPaletteTree()
        this.workspace = Blockly.inject(this.container, {
            // A flyout-only toolbox — Blockly reserves this permanent space next to the workspace
            // rather than the popup-on-click, overlay-and-close behavior Blockly's own category
            // toolbox's flyout has. The nested-category *sidebar* driving it (paletteTree, rendered
            // in exrail-block-canvas.html) is entirely our own, not Blockly's — see
            // exrail-blockly-toolbox.ts for why. onCategoryClick() swaps this flyout's contents via
            // updateToolbox().
            toolbox: flatToolboxForPath(this.selectedLeafPath, this.defined) as unknown as Blockly.utils.toolbox.ToolboxDefinition,
            // Served from src/renderer/public/blockly-media/ (Vite's publicDir, copied verbatim
            // into the build output) — without this, Blockly defaults to fetching its icon/sound
            // sprites from static.blockly.com, which the app's CSP blocks (img-src/connect-src
            // 'self' only) and which would be unwanted network access regardless.
            media: './blockly-media/',
            trashcan: true,
            zoom: { controls: true, wheel: true, startScale: 1 },
            move: { scrollbars: true, drag: true, wheel: false },
            theme: themeFor(this.themeService.effective),
            sounds: this.blocklySounds.enabled,
        })
        setWorkspaceDefined(this.workspace, this.defined)
        this._loadInto(this.workspace)

        this._changeListener = (e: Blockly.Events.Abstract) => this._onWorkspaceEvent(e)
        this.workspace.addChangeListener(this._changeListener)

        this._resizeObserver = new ResizeObserver(() => {
            if (this.workspace) Blockly.svgResize(this.workspace)
        })
        this._resizeObserver.observe(this.container)

        // ResizeObserver alone misses the case that matters here: routes-editor.html/
        // sequences-editor.html keep this element mounted but `display:none` (a CSS `hidden` class
        // on an ancestor, not this component) while the file-level Raw tab is active, rather than
        // tearing it down — see their own comments on why (avoids rebuilding the toolbox/flyout on
        // every tab switch). A `display:none` ancestor gives `container` a 0×0 box that Blockly's
        // last resize() baked into the SVG, and nothing re-triggers a resize when the ancestor's
        // `hidden` class is removed again since that's a plain class toggle elsewhere, not a change
        // to this element's own subtree. IntersectionObserver does fire on that transition (unlike
        // ResizeObserver, whose target never itself changes size at the moment display flips).
        this._visibilityObserver = new IntersectionObserver((entries) => {
            if (this.workspace && entries.some((e) => e.isIntersecting)) Blockly.svgResize(this.workspace)
        })
        this._visibilityObserver.observe(this.container)

        this._unsubTheme = this.themeService.onChange((effective) => {
            this.workspace?.setTheme(themeFor(effective))
        })

        this._unsubBlocklySounds = this.blocklySounds.onChange((enabled) => {
            this.workspace?.getAudioManager().setMuted(!enabled)
        })
    }

    private _loadInto(workspace: Blockly.WorkspaceSvg): void {
        const graph = this._loadGraph()
        this._suppressChange = true
        try {
            buildWorkspaceFromGraph(workspace, graph, BLOCK_REGISTRY)
            this._applyHeaderLabel()
        } finally {
            this._suppressChange = false
        }
        this._refreshOutput()
    }

    /** Pushes `headerLabel` onto the hat block's display-only field — called after (re)building
     *  the workspace and whenever the bindable changes on an already-mounted canvas. */
    headerLabelChanged(): void {
        this._applyHeaderLabel()
    }

    private _applyHeaderLabel(): void {
        if (!this.workspace) return
        const hat = this.workspace.getTopBlocks(true).find((b) => b.getField('HEADER_LABEL'))
        hat?.setFieldValue(this.headerLabel, 'HEADER_LABEL')
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
        const text = this._refreshOutput()
        this.onBodyChange?.(text)
    }

    /** Recompiles the workspace and stores the result on `outputText` for the readonly output pane
     *  — the single choke point every load/structural-change path routes through, so the pane never
     *  drifts from what onBodyChange would push out. Returns the text so _commitNow() doesn't need
     *  a second compile just to hand it to onBodyChange. */
    private _refreshOutput(): string {
        if (!this.workspace) {
            this.outputText = ''
            return ''
        }
        const graph = buildGraphFromWorkspace(this.workspace, BLOCK_REGISTRY)
        const text = compileBody(graph, BLOCK_REGISTRY)
        this.outputText = text
        return text
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
