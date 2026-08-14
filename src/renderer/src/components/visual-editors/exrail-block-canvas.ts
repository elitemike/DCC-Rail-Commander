import { bindable, BindingMode, queueTask } from 'aurelia'
import {
    Diagram,
    SymbolPalette,
    NodeConstraints,
    PortVisibility,
    PortConstraints,
    type NodeModel,
    type ConnectorModel,
    type PointPortModel,
    type IDropEventArgs,
    type ICollectionChangeEventArgs,
    type PaletteModel,
} from '@syncfusion/ej2-diagrams'
import { BLOCK_REGISTRY } from './exrail-block-registry'
import { parseBody, compileBody } from './exrail-block-compiler'
import type { BlockTypeDef, CanvasNodeInfo, DefinedObjects, GraphConnector, ParsedGraph } from './exrail-block-compiler'

const NODE_W = 180
const NODE_H = 54
const ROW_GAP = 78
const BRANCH_GAP_X = 150

const IN_PORT = (id: string) => `${id}-in`
const OUT_PORT = (id: string) => `${id}-out`
const THEN_PORT = (id: string) => `${id}-then`
const ELSE_PORT = (id: string) => `${id}-else`
/** Hidden port used only to anchor the synthetic terminal-DONE marker's connector — kept separate from OUT_PORT so the marker never makes a node's real forward port look "already used" to _openForwardPorts(). */
const TERM_PORT = (id: string) => `${id}-term`

const TERMINAL_DONE_ID = 'doneTerminal'

const SNAP_RADIUS = 45
const PALETTE_W = 208
const PALETTE_SYMBOL_W = 170
const PALETTE_SYMBOL_H = 60

/** Distinct EJ2 Basic shape per block category, so hat/action/condition/end read apart at a glance without relying on color alone. */
const SHAPE_FOR: Record<BlockTypeDef['shape'], string> = {
    hat: 'Ellipse',
    stack: 'Rectangle',
    branch: 'Diamond',
    cap: 'Hexagon',
}

/**
 * Drag-and-drop EXRAIL block canvas for a single route/sequence body. Wraps
 * EJ2 Diagram + SymbolPalette imperatively (this repo's established pattern —
 * see turnout-editor.ts/roster-editor.ts) rather than via a framework wrapper.
 *
 * Node shapes are all `type: 'Basic'` with plain-string annotations — never
 * `nodeTemplate`/`type: 'HTML'`, which compile via `new Function()` and are
 * blocked by Electron's CSP (see CLAUDE.md).
 */
export class ExrailBlockCanvasCustomElement {
    @bindable kind: 'route' | 'sequence' = 'route'
    @bindable({ mode: BindingMode.oneTime }) initialBody = ''
    @bindable defined: DefinedObjects | null = null
    @bindable onBodyChange: ((body: string) => void) | null = null

    private diagram: Diagram | null = null
    private palette: SymbolPalette | null = null
    private _resizeObserver: ResizeObserver | null = null
    private _detached = false
    private _idCounter = 0
    private _diagramElId = `exrail-block-diagram-${Math.random().toString(36).slice(2)}`
    private _paletteElId = `exrail-block-palette-${Math.random().toString(36).slice(2)}`

    parseError: string | null = null
    canvasWarning: string | null = null
    selectedNodeId: string | null = null

    get diagramElId(): string { return this._diagramElId }
    get paletteElId(): string { return this._paletteElId }

    get selectedNode(): { def: BlockTypeDef; info: CanvasNodeInfo } | null {
        if (!this.diagram || !this.selectedNodeId) return null
        const node = this.diagram.nodes.find((n) => n.id === this.selectedNodeId)
        if (!node?.addInfo) return null
        const info = node.addInfo as CanvasNodeInfo
        const def = BLOCK_REGISTRY.find((b) => b.id === info.blockTypeId)
        return def ? { def, info } : null
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    attached(): void {
        this._detached = false
        queueTask(() => {
            if (this._detached || !document.getElementById(this._paletteElId)) return
            this._setupResizeObserver()
            this._build()
        })
    }

    detaching(): void {
        this._detached = true
        this._resizeObserver?.disconnect()
        this._resizeObserver = null
        try { this.diagram?.destroy() } catch { /* already broken — nothing to clean up */ }
        try { this.palette?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.diagram = null
        this.palette = null
    }

    /**
     * Rebuilds the diagram from a new body without waiting for this element to be torn down and
     * re-attached — sequences-editor/routes-editor's master-detail views reuse this same element
     * across a row/sequence selection change (the `if.bind` gating Blocks-vs-Text doesn't flip),
     * and `initialBody` is `oneTime` so it never re-reads on its own. Called via `component.ref`
     * whenever the host's selection changes underneath an already-mounted canvas.
     */
    reload(body: string): void {
        this.initialBody = body
        this.selectedNodeId = null
        this.parseError = null
        this.canvasWarning = null
        try { this.diagram?.destroy() } catch { /* already broken — nothing to clean up */ }
        try { this.palette?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.diagram = null
        this.palette = null
        queueTask(() => {
            if (this._detached) return
            this._build()
        })
    }

    private _setupResizeObserver(): void {
        const paletteEl = document.getElementById(this._paletteElId)
        const row = paletteEl?.parentElement
        if (!row) return
        this._resizeObserver = new ResizeObserver(() => {
            if (!row.clientWidth || !row.clientHeight) return
            if (this.diagram) {
                this.diagram.width = Math.max(200, row.clientWidth - PALETTE_W)
                this.diagram.height = row.clientHeight
                this.diagram.dataBind()
            }
            if (this.palette) {
                this.palette.height = row.clientHeight
                this.palette.dataBind()
            }
        })
        this._resizeObserver.observe(row)
    }

    private _build(): void {
        const paletteEl = document.getElementById(this._paletteElId)
        const row = paletteEl?.parentElement
        if (!row) return
        // Measure the row BEFORE constructing either EJ2 widget: both Diagram and
        // SymbolPalette bake a fixed pixel width/height into their target element's
        // inline style at construction time, ignoring the surrounding Tailwind flex
        // classes — if unmeasured (or measured off ITS OWN container after the other
        // widget already clobbered the shared row's layout), one of them ends up
        // sized from a stale/zero reading. Pass explicit pixel dimensions to both,
        // derived from this single trustworthy pre-construction measurement.
        const rowWidth = row.clientWidth || 600
        const rowHeight = row.clientHeight || 360
        this._buildPalette(PALETTE_W, rowHeight)
        this._buildDiagram(Math.max(200, rowWidth - PALETTE_W), rowHeight)
    }

    definedChanged(): void {
        if (!this.palette) return
        this.palette.palettes = this._buildPaletteModels()
        this.palette.dataBind()
        queueTask(() => this._labelPaletteSymbols())
    }

    // ── Palette ────────────────────────────────────────────────────────────

    private _availableBlocks(): BlockTypeDef[] {
        const defined = this.defined
        return BLOCK_REGISTRY.filter((b) => b.shape !== 'hat' && (defined ? b.isAvailable(defined) : false))
    }

    private _paletteSymbolNode(def: BlockTypeDef): NodeModel {
        return {
            id: `palette-${def.id}`,
            width: PALETTE_SYMBOL_W,
            height: PALETTE_SYMBOL_H,
            shape: { type: 'Basic', shape: SHAPE_FOR[def.shape] as 'Rectangle' },
            style: { fill: def.color, strokeColor: '#ffffff', strokeWidth: 1 },
            addInfo: { blockTypeId: def.id, paramValues: this._defaultParamValues(def) } satisfies CanvasNodeInfo,
        }
    }

    /**
     * EJ2's SymbolPalette renders symbol previews to an offscreen canvas whose text draw is
     * gated on internal wrap-bounds state that never gets computed for palette symbols (only
     * for nodes owned by a full Diagram) — annotations silently never paint there. Label each
     * palette tile ourselves with a plain DOM overlay instead of fighting that renderer.
     */
    private _labelPaletteSymbols(): void {
        for (const def of this._availableBlocks()) {
            const container = document.getElementById(`palette-${def.id}_container`)
            if (!container || container.querySelector('.exrail-palette-label')) continue
            container.style.position = 'relative'
            const label = document.createElement('div')
            label.className = 'exrail-palette-label'
            label.textContent = def.label
            label.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 8px;color:#ffffff;font-size:11px;font-weight:600;text-align:center;line-height:1.15;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.6);'
            container.appendChild(label)
        }
    }

    private _defaultParamValues(def: BlockTypeDef): Record<string, string | number> {
        const values: Record<string, string | number> = {}
        for (const p of def.params) {
            values[p.name] = p.kind === 'string' ? '' : this._firstAvailableId(p.kind)
        }
        return values
    }

    private _firstAvailableId(kind: BlockTypeDef['params'][number]['kind']): number {
        const d = this.defined
        if (!d) return 0
        switch (kind) {
            case 'turnoutRef': return d.turnouts[0]?.id ?? 0
            case 'sensorRef': return (d.sensors ?? [])[0]?.id ?? 0
            case 'signalRef': return d.signals[0]?.red ?? 0
            case 'rosterRef': return d.roster[0]?.dccAddress ?? 0
            case 'routeOrSequenceRef': return d.routes?.[0]?.id ?? d.sequences?.[0]?.id ?? 0
            default: return 0
        }
    }

    private _buildPaletteModels(): PaletteModel[] {
        const blocks = this._availableBlocks()
        const byShape = new Map<string, BlockTypeDef[]>()
        for (const b of blocks) {
            if (!byShape.has(b.shape)) byShape.set(b.shape, [])
            byShape.get(b.shape)!.push(b)
        }
        const titles: Record<string, string> = { stack: 'Actions', branch: 'Conditions', cap: 'Ends' }
        return Array.from(byShape.entries()).map(([shape, defs]) => ({
            id: `palette-group-${shape}`,
            title: titles[shape] ?? shape,
            expanded: true,
            symbols: defs.map((d) => this._paletteSymbolNode(d)),
        }))
    }

    private _buildPalette(width: number, height: number): void {
        if (!document.getElementById(this._paletteElId)) return
        this.palette = new SymbolPalette({
            width,
            height,
            palettes: this._buildPaletteModels(),
            symbolWidth: PALETTE_SYMBOL_W,
            symbolHeight: PALETTE_SYMBOL_H,
            symbolMargin: { left: 10, right: 10, top: 10, bottom: 10 },
            expandMode: 'Multiple',
            enableSearch: false,
            getSymbolInfo: () => ({ fit: true }),
        })
        this.palette.appendTo(`#${this._paletteElId}`)
        queueTask(() => this._labelPaletteSymbols())
    }

    // ── Graph load ─────────────────────────────────────────────────────────

    private _loadGraph(): ParsedGraph {
        if (this.initialBody.trim() === '') {
            return { nodes: [{ id: 'hat', info: { blockTypeId: this.kind === 'route' ? 'ROUTE' : 'SEQUENCE', paramValues: {} } }], connectors: [], hatNodeId: 'hat' }
        }
        const result = parseBody(this.initialBody, this.kind, BLOCK_REGISTRY)
        if (!result.ok) {
            this.parseError = result.reason
            return { nodes: [{ id: 'hat', info: { blockTypeId: this.kind === 'route' ? 'ROUTE' : 'SEQUENCE', paramValues: {} } }], connectors: [], hatNodeId: 'hat' }
        }
        this.parseError = null
        return result.graph
    }

    private _registryById(id: string): BlockTypeDef | undefined {
        return BLOCK_REGISTRY.find((b) => b.id === id)
    }

    /**
     * Default port visibility ('Connect' — only shown once a connector is already mid-drag)
     * makes ports invisible to grab a drag FROM, so manually wiring two placed nodes together
     * is impossible via the mouse. Every port here is shown on hover and (for the outgoing
     * ones — out/then/else) draws a new connector when dragged from, matching how the
     * auto-snap-on-drop connectors already behave.
     */
    private readonly _inPortStyle: Partial<PointPortModel> = {
        visibility: PortVisibility.Hover,
        shape: 'Circle',
        width: 10,
        height: 10,
        style: { fill: '#3b82f6', strokeColor: '#ffffff', strokeWidth: 1 },
    }
    private readonly _outPortStyle: Partial<PointPortModel> = {
        ...this._inPortStyle,
        constraints: PortConstraints.Default | PortConstraints.Draw,
    }
    /** Never drawn, never grabbable — exists purely so a connector can target/source it programmatically (the terminal-DONE marker link). */
    private readonly _hiddenPortStyle: Partial<PointPortModel> = {
        visibility: PortVisibility.Hidden,
        shape: 'Circle',
        width: 1,
        height: 1,
    }

    private _buildPorts(nodeId: string, shape: BlockTypeDef['shape']): PointPortModel[] {
        const ports: PointPortModel[] = []
        if (shape !== 'hat') ports.push({ id: IN_PORT(nodeId), offset: { x: 0.5, y: 0 }, ...this._inPortStyle })
        if (shape === 'branch') {
            ports.push({ id: THEN_PORT(nodeId), offset: { x: 0.22, y: 1 }, ...this._outPortStyle })
            ports.push({ id: ELSE_PORT(nodeId), offset: { x: 0.78, y: 1 }, ...this._outPortStyle })
            ports.push({ id: OUT_PORT(nodeId), offset: { x: 0.5, y: 1 }, ...this._outPortStyle })
            ports.push({ id: TERM_PORT(nodeId), offset: { x: 0.5, y: 1 }, ...this._hiddenPortStyle })
        } else if (shape !== 'cap') {
            ports.push({ id: OUT_PORT(nodeId), offset: { x: 0.5, y: 1 }, ...this._outPortStyle })
            ports.push({ id: TERM_PORT(nodeId), offset: { x: 0.5, y: 1 }, ...this._hiddenPortStyle })
        }
        return ports
    }

    private _nodeLabel(def: BlockTypeDef, paramValues: Record<string, string | number>): string {
        if (def.params.length === 0) return def.label
        const values = def.params.map((p) => paramValues[p.name]).join(', ')
        return `${def.label} (${values})`
    }

    private _buildNodeModel(id: string, info: CanvasNodeInfo, x: number, y: number): NodeModel {
        const def = this._registryById(info.blockTypeId)
        const color = def?.color ?? '#7f8c8d'
        const blockShape = def?.shape ?? 'stack'
        // Every node keeps its aspect ratio while being resized; the hat (Route/Sequence
        // start) additionally loses Delete — it's the graph's required root, so removing it
        // would leave compileBody() with nothing to walk from. The terminal-DONE marker loses
        // Delete for the same reason as the hat: it isn't really there (see isTerminalMarker),
        // so removing it wouldn't remove anything from the compiled text anyway.
        let constraints = NodeConstraints.Default | NodeConstraints.AspectRatio
        if (blockShape === 'hat' || info.isTerminalMarker) constraints &= ~NodeConstraints.Delete
        return {
            id,
            width: NODE_W,
            height: NODE_H,
            offsetX: x,
            offsetY: y,
            shape: { type: 'Basic', shape: SHAPE_FOR[blockShape] as 'Rectangle' },
            style: { fill: color, strokeColor: '#ffffff', strokeWidth: blockShape === 'hat' ? 2 : 1 },
            annotations: [{ content: def ? this._nodeLabel(def, info.paramValues) : info.blockTypeId, style: { color: '#ffffff', fontSize: 12 } }],
            addInfo: info as unknown as Record<string, unknown>,
            ports: this._buildPorts(id, def?.shape ?? 'stack'),
            constraints,
        }
    }

    /** Lays the graph out top-to-bottom; branch then/else chains are offset left/right and the trunk resumes below the taller side. Purely cosmetic — structure comes from addInfo/connectors, not position. */
    private _layout(graph: ParsedGraph): { nodes: NodeModel[]; connectors: ConnectorModel[] } {
        const nodeById = new Map(graph.nodes.map((n) => [n.id, n.info]))
        const nextIdOf = (id: string) => graph.connectors.find((c) => c.sourceID === id)?.targetID
        const nodes: NodeModel[] = []
        const connectors: ConnectorModel[] = []

        const place = (startId: string | undefined, x: number, y: number): number => {
            let currentId = startId
            let curY = y
            while (currentId !== undefined) {
                const info = nodeById.get(currentId)
                if (!info) break
                nodes.push(this._buildNodeModel(currentId, info, x, curY))
                const def = this._registryById(info.blockTypeId)
                if (def?.shape === 'branch') {
                    const thenBottom = info.thenChildFirstId !== undefined ? place(info.thenChildFirstId, x - BRANCH_GAP_X, curY + ROW_GAP) : curY + ROW_GAP
                    const elseBottom = info.elseChildFirstId !== undefined ? place(info.elseChildFirstId, x + BRANCH_GAP_X, curY + ROW_GAP) : curY + ROW_GAP
                    curY = Math.max(thenBottom, elseBottom)
                } else {
                    curY += ROW_GAP
                }
                const nextId = nextIdOf(currentId)
                if (nextId !== undefined) {
                    connectors.push({ id: `c_${currentId}_${nextId}`, sourceID: currentId, sourcePortID: OUT_PORT(currentId), targetID: nextId, targetPortID: IN_PORT(nextId), type: 'Orthogonal' })
                }
                currentId = nextId
            }
            return curY
        }

        nodes.push(this._buildNodeModel(graph.hatNodeId, nodeById.get(graph.hatNodeId)!, 220, 40))
        const firstBodyId = nextIdOf(graph.hatNodeId)
        if (firstBodyId !== undefined) {
            connectors.push({ id: `c_${graph.hatNodeId}_${firstBodyId}`, sourceID: graph.hatNodeId, sourcePortID: OUT_PORT(graph.hatNodeId), targetID: firstBodyId, targetPortID: IN_PORT(firstBodyId), type: 'Orthogonal' })
        }
        place(firstBodyId, 220, 40 + ROW_GAP)

        // Visual-only then/else connectors, drawn from the branch's dedicated port to its child chain's first node.
        for (const n of graph.nodes) {
            const def = this._registryById(n.info.blockTypeId)
            if (def?.shape !== 'branch') continue
            if (n.info.thenChildFirstId !== undefined) {
                connectors.push({ id: `c_${n.id}_then`, sourceID: n.id, sourcePortID: THEN_PORT(n.id), targetID: n.info.thenChildFirstId, targetPortID: IN_PORT(n.info.thenChildFirstId), type: 'Orthogonal' })
            }
            if (n.info.elseChildFirstId !== undefined) {
                connectors.push({ id: `c_${n.id}_else`, sourceID: n.id, sourcePortID: ELSE_PORT(n.id), targetID: n.info.elseChildFirstId, targetPortID: IN_PORT(n.info.elseChildFirstId), type: 'Orthogonal' })
            }
        }

        this._idCounter = Math.max(0, ...graph.nodes.map((n) => Number(n.id.replace(/^n/, '')) || 0))
        return { nodes, connectors }
    }

    private _buildDiagram(width: number, height: number): void {
        if (!document.getElementById(this._diagramElId)) return
        const graph = this._loadGraph()
        const { nodes, connectors } = this._layout(graph)

        this.diagram = new Diagram({
            width,
            height,
            nodes,
            connectors,
            drop: (args: IDropEventArgs) => this._onDrop(args),
            collectionChange: (args: ICollectionChangeEventArgs) => this._onCollectionChange(args),
            click: (args) => {
                const id = (args as { element?: { id?: string } }).element?.id
                this.selectedNodeId = id ?? null
            },
        })
        this.diagram.appendTo(`#${this._diagramElId}`)
        this._syncTerminalDoneNode()
    }

    // ── Drop / auto-snap ──────────────────────────────────────────────────

    /** Every port on existing nodes that could still accept an outgoing forward connector (i.e. isn't already the source of one). */
    private _openForwardPorts(): Array<{ nodeId: string; portId: string; x: number; y: number }> {
        if (!this.diagram) return []
        const used = new Set(this.diagram.connectors.map((c) => c.sourcePortID).filter((p): p is string => !!p))
        const out: Array<{ nodeId: string; portId: string; x: number; y: number }> = []
        for (const node of this.diagram.nodes) {
            const info = node.addInfo as CanvasNodeInfo | undefined
            if (!info) continue
            const def = this._registryById(info.blockTypeId)
            if (!def || def.shape === 'cap') continue
            const nodeId = node.id!
            const portIds = def.shape === 'branch' ? [THEN_PORT(nodeId), ELSE_PORT(nodeId), OUT_PORT(nodeId)] : [OUT_PORT(nodeId)]
            for (const portId of portIds) {
                if (used.has(portId)) continue
                const port = (node.ports ?? []).find((p) => p.id === portId)
                const fx = port?.offset?.x ?? 0.5
                const fy = port?.offset?.y ?? 1
                out.push({
                    nodeId,
                    portId,
                    x: (node.offsetX ?? 0) - NODE_W / 2 + fx * NODE_W,
                    y: (node.offsetY ?? 0) - NODE_H / 2 + fy * NODE_H,
                })
            }
        }
        return out
    }

    /**
     * True if `nodeId` is reachable from the hat via plain forward connectors only — i.e. it's
     * part of the main body, not nested inside an IF/IFNOT/IFCLOSED/IFTHROWN branch leg. Walks
     * backward from `nodeId` toward the hat; a then/else connector anywhere along that path
     * means it's inside a branch (not top-level).
     */
    private _isTopLevelNode(nodeId: string): boolean {
        if (!this.diagram) return true
        let current: string | undefined = nodeId
        const seen = new Set<string>()
        while (current !== undefined && current !== 'hat') {
            if (seen.has(current)) return true
            seen.add(current)
            const incoming = this.diagram.connectors.find((c) => c.targetID === current)
            if (!incoming) return true
            if (incoming.sourcePortID?.endsWith('-then') || incoming.sourcePortID?.endsWith('-else')) return false
            current = incoming.sourceID
        }
        return true
    }

    /**
     * DONE must only ever end a branch leg (compileBody's doc comment) — the file itself always
     * appends its own terminating DONE after the compiled body, so a DONE placed on the main
     * body would compile into a second, duplicate DONE that corrupts the next reparse (the
     * earlier DONE silently absorbs everything after it as "body", losing the block placed
     * after it — see parseSequencesFromFile/parseRoutesFromFile, which stop at the first DONE
     * line they see). A connector reaching a DONE node is only valid entering via a then/else
     * port, or continuing a chain that's already inside a branch.
     */
    private _isValidDoneTarget(sourceNodeId: string, sourcePortId: string): boolean {
        if (sourcePortId.endsWith('-then') || sourcePortId.endsWith('-else')) return true
        return !this._isTopLevelNode(sourceNodeId)
    }

    private _warnDoneMustBeInBranch(): void {
        const message = 'DONE can only end an IF/IFNOT/IFCLOSED/IFTHROWN branch — the file already adds a terminating DONE automatically.'
        this.canvasWarning = message
        setTimeout(() => { if (this.canvasWarning === message) this.canvasWarning = null }, 4000)
    }

    private _onDrop(args: IDropEventArgs): void {
        const element = args.element as NodeModel
        if (!element.addInfo) return

        // The dropped element EJ2 hands us here is already a live Node instance (its own
        // internal ShapeAnnotation objects, wrapper, etc.) that EJ2 itself inserted using the
        // raw palette-tile model (palette tile size, no ports, no annotation — the palette
        // draws its own label via a DOM overlay, see _labelPaletteSymbols()). Mutating that
        // live object's properties directly (id/ports/width/height/annotations) doesn't
        // reliably reach its rendered wrapper — confirmed by attempting it, which left dropped
        // nodes both unlabeled and structurally inconsistent with normal nodes (breaking their
        // later drag/connect behaviour). Instead: remove EJ2's raw clone and add back a fresh
        // node built by the exact same _buildNodeModel() path used for nodes loaded from a
        // parsed body, so dropped and loaded nodes are always identical under the hood.
        const rawId = element.id
        const info = element.addInfo as CanvasNodeInfo
        const px = args.position.x ?? 0
        const py = args.position.y ?? 0

        queueTask(() => {
            if (!this.diagram) return
            const rawNode = this.diagram.nodes.find((n) => n.id === rawId)
            if (rawNode) this.diagram.remove(rawNode)

            const candidates = this._openForwardPorts()
            let best: { nodeId: string; portId: string; x: number; y: number; dist: number } | null = null
            for (const c of candidates) {
                const dist = Math.hypot(c.x - px, c.y - py)
                if (dist <= SNAP_RADIUS && (!best || dist < best.dist)) best = { ...c, dist }
            }

            if (best && info.blockTypeId === 'DONE' && !this._isValidDoneTarget(best.nodeId, best.portId)) {
                this._warnDoneMustBeInBranch()
                best = null
            }

            this._idCounter += 1
            const id = `n${this._idCounter}`
            const x = best ? best.x : px
            const y = best ? best.y + NODE_H / 2 + 20 : py
            this.diagram.add(this._buildNodeModel(id, info, x, y))

            if (best) {
                const isBranchChild = best.portId.endsWith('-then') || best.portId.endsWith('-else')
                this.diagram.add({
                    id: `c_${best.nodeId}_${id}`,
                    sourceID: best.nodeId,
                    sourcePortID: best.portId,
                    targetID: id,
                    targetPortID: IN_PORT(id),
                    type: 'Orthogonal',
                } as ConnectorModel)
                if (isBranchChild) {
                    const sourceNode = this.diagram.nodes.find((n) => n.id === best!.nodeId)
                    const sourceInfo = sourceNode?.addInfo as CanvasNodeInfo | undefined
                    if (sourceInfo) {
                        if (best.portId.endsWith('-then')) sourceInfo.thenChildFirstId = id
                        else sourceInfo.elseChildFirstId = id
                    }
                }
            }
            this._commit()
        })
    }

    // ── Validation + commit ────────────────────────────────────────────────

    /**
     * compileBody() doesn't read a branch's then/else connectors directly — it reads
     * `thenChildFirstId`/`elseChildFirstId` off the branch node's own addInfo (see _commit(),
     * which filters -then/-else connectors OUT of the compiled graph entirely; they're
     * cosmetic). _onDrop()'s auto-snap path sets those fields itself, but a connector the user
     * draws by hand — now possible since ports are visible/drawable, see _buildPorts() — only
     * produces the connector; without this, it would visually attach but silently not affect
     * the compiled EXRAIL text.
     */
    private _syncBranchChild(connector: ConnectorModel, clear: boolean): void {
        if (!this.diagram) return
        const portId = connector.sourcePortID
        const isThen = portId?.endsWith('-then')
        const isElse = portId?.endsWith('-else')
        if (!isThen && !isElse) return
        const sourceNode = this.diagram.nodes.find((n) => n.id === connector.sourceID)
        const info = sourceNode?.addInfo as CanvasNodeInfo | undefined
        if (!info) return
        const key = isThen ? 'thenChildFirstId' : 'elseChildFirstId'
        if (clear) {
            if (info[key] === connector.targetID) info[key] = undefined
        } else {
            info[key] = connector.targetID
        }
    }

    private _onCollectionChange(args: ICollectionChangeEventArgs): void {
        const isConnector = 'sourceID' in args.element
        if (args.type === 'Addition' && isConnector) {
            const connector = args.element as ConnectorModel
            if (args.state === 'Changing' && this.diagram) {
                const fanOut = this.diagram.connectors.some((c) => c !== connector && c.sourcePortID === connector.sourcePortID && c.sourceID === connector.sourceID)
                if (fanOut) { args.cancel = true; return }
                const targetInfo = this.diagram.nodes.find((n) => n.id === connector.targetID)?.addInfo as CanvasNodeInfo | undefined
                if (targetInfo?.blockTypeId === 'DONE' && !targetInfo.isTerminalMarker && connector.sourceID && connector.sourcePortID
                    && !this._isValidDoneTarget(connector.sourceID, connector.sourcePortID)) {
                    args.cancel = true
                    this._warnDoneMustBeInBranch()
                    return
                }
            }
            if (args.state === 'Changed') this._syncBranchChild(connector, false)
        }
        if (args.type === 'Removal') {
            // Backstop alongside the hat node's NodeConstraints.Delete removal in
            // _buildNodeModel — if it's ever recreated without that constraint (e.g. a future
            // addInfo-driven rebuild), this still stops the graph's required root from being
            // removed.
            if (args.state === 'Changing' && 'addInfo' in args.element) {
                const info = (args.element as { addInfo?: unknown }).addInfo as CanvasNodeInfo | undefined
                if (info && this._registryById(info.blockTypeId)?.shape === 'hat') { args.cancel = true; return }
            }
            if (isConnector && args.state === 'Changed') this._syncBranchChild(args.element as ConnectorModel, true)
        }
        if (args.state === 'Changed') this._commit()
    }

    private _commit(): void {
        if (!this.diagram) return
        // _syncTerminalDoneNode()'s own add/remove calls fire this same collectionChange ->
        // _commit() path re-entrantly. Its edits never change the compiled text (the marker is
        // filtered out below regardless), so recompiling and re-notifying onBodyChange here
        // would be a same-text no-op at best — and at worst, if the host treats every
        // onBodyChange call as a real edit (e.g. re-deriving `defined` with a fresh reference
        // and remounting this element), a no-op notification becomes a remount, which reruns
        // the marker sync, which notifies again: an infinite remount loop. Skip entirely.
        if (this._syncingTerminalDone) return
        const nodes = this.diagram.nodes
            .filter((n) => !(n.addInfo as CanvasNodeInfo | undefined)?.isTerminalMarker)
            .map((n) => ({ id: n.id!, info: n.addInfo as CanvasNodeInfo }))
        // A source can only ever have one plain forward connector (branches' then/else/out legs
        // are already excluded above and tracked separately via thenChildFirstId/elseChildFirstId).
        // EJ2 can end up with two overlapping connectors for the same source — e.g. its own
        // port-proximity auto-connect firing alongside the snap-on-drop connector _onDrop()
        // adds — which compileBody()'s walk() has no cycle/visited guard against, so it would
        // silently double-emit that branch of the body. Keep only the first per source.
        // The terminal-DONE marker's own link (sourcePortID ending "-term") is excluded the same
        // way as then/else — it's cosmetic, never part of the compiled graph.
        const seenSources = new Set<string>()
        const connectors: GraphConnector[] = this.diagram.connectors
            .filter((c) => !c.sourcePortID?.endsWith('-then') && !c.sourcePortID?.endsWith('-else') && !c.sourcePortID?.endsWith('-term'))
            .filter((c) => {
                if (seenSources.has(c.sourceID!)) return false
                seenSources.add(c.sourceID!)
                return true
            })
            .map((c) => ({ id: c.id!, sourceID: c.sourceID!, targetID: c.targetID! }))
        const graph: ParsedGraph = { nodes, connectors, hatNodeId: 'hat' }
        const text = compileBody(graph, BLOCK_REGISTRY)
        this.onBodyChange?.(text)
        this._syncTerminalDoneNode()
    }

    // ── Terminal DONE marker ─────────────────────────────────────────────────

    private _syncingTerminalDone = false

    /** Id of the last node in the plain top-level chain (never inside a then/else leg), starting from the hat. Always resolves to at least 'hat' itself. */
    private _topLevelTailId(): string {
        if (!this.diagram) return 'hat'
        let current = 'hat'
        const seen = new Set<string>()
        while (!seen.has(current)) {
            seen.add(current)
            const next = this.diagram.connectors.find((c) => c.sourceID === current && c.sourcePortID === OUT_PORT(current))?.targetID
            if (next === undefined || next === TERMINAL_DONE_ID) return current
            current = next
        }
        return current
    }

    /**
     * Keeps a synthetic "Done" node trailing whatever the top-level chain currently ends on,
     * standing in for the terminating DONE that serializeRoutesToFile/serializeSequencesToFile
     * always append after this body — the user asked to see that DONE represented on the
     * canvas instead of it being an invisible, implied thing. It's purely cosmetic: _commit()
     * strips it (and its connector) out of the graph before compiling, so it can never
     * duplicate the real, file-level DONE.
     *
     * Not shown when the chain currently ends on a cap block (DONE/FOLLOW/RESET/...) — those
     * already halt execution themselves, so the file's trailing DONE is unreachable dead text
     * there and drawing it would just be confusing.
     */
    private _syncTerminalDoneNode(): void {
        if (!this.diagram || this._syncingTerminalDone) return
        this._syncingTerminalDone = true
        try {
            const tailId = this._topLevelTailId()
            const tailNode = this.diagram.nodes.find((n) => n.id === tailId)
            const tailInfo = tailNode?.addInfo as CanvasNodeInfo | undefined
            const tailDef = tailInfo ? this._registryById(tailInfo.blockTypeId) : undefined
            const eligible = !!tailDef && tailDef.shape !== 'cap'

            const existingMarker = this.diagram.nodes.find((n) => n.id === TERMINAL_DONE_ID)
            const existingConnector = this.diagram.connectors.find((c) => c.targetID === TERMINAL_DONE_ID)

            if (!eligible) {
                if (existingConnector) this.diagram.remove(existingConnector)
                if (existingMarker) this.diagram.remove(existingMarker)
                return
            }

            if (existingConnector && existingConnector.sourceID === tailId) return

            if (existingConnector) this.diagram.remove(existingConnector)

            const x = tailNode!.offsetX ?? 220
            const y = (tailNode!.offsetY ?? 40) + ROW_GAP

            if (!existingMarker) {
                this.diagram.add(this._buildNodeModel(TERMINAL_DONE_ID, { blockTypeId: 'DONE', paramValues: {}, isTerminalMarker: true }, x, y))
            } else {
                existingMarker.offsetX = x
                existingMarker.offsetY = y
            }

            this.diagram.add({
                id: `c_${tailId}_${TERMINAL_DONE_ID}`,
                sourceID: tailId,
                sourcePortID: TERM_PORT(tailId),
                targetID: TERMINAL_DONE_ID,
                targetPortID: IN_PORT(TERMINAL_DONE_ID),
                type: 'Orthogonal',
            } as ConnectorModel)
        } finally {
            this._syncingTerminalDone = false
        }
    }

    // ── Param side panel ───────────────────────────────────────────────────

    updateParam(name: string, rawValue: string): void {
        const sel = this.selectedNode
        if (!sel) return
        const paramDef = sel.def.params.find((p) => p.name === name)
        if (!paramDef) return
        if (paramDef.kind === 'string') {
            sel.info.paramValues[name] = rawValue
        } else {
            // The param panel is a plain text input (see exrail-block-canvas.html) with no
            // numeric keyboard/validation, and this fires on blur — including the blur caused
            // by navigating away to another nav item mid-edit. Silently keep the last-good value
            // rather than committing Number(rawValue) here: an incomplete/invalid string (e.g.
            // "-" typed but not finished) would otherwise compile straight into the file as a
            // literal, permanent "THROW(NaN)".
            const parsed = Number(rawValue)
            if (Number.isNaN(parsed)) return
            sel.info.paramValues[name] = parsed
        }
        if (!this.diagram || !this.selectedNodeId) return
        const node = this.diagram.nodes.find((n) => n.id === this.selectedNodeId)
        if (node?.annotations?.[0]) {
            node.annotations[0].content = this._nodeLabel(sel.def, sel.info.paramValues)
            this.diagram.dataBind()
        }
        this._commit()
    }
}
