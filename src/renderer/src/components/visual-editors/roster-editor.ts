import { IObserverLocator, queueTask, resolve } from 'aurelia'
import { IDialogService } from '@aurelia/dialog'
import { TreeView, ContextMenu } from '@syncfusion/ej2-navigations'
import type { BeforeOpenCloseMenuEventArgs, MenuEventArgs, NodeSelectEventArgs, DrawNodeEventArgs } from '@syncfusion/ej2-navigations'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { Roster, RosterFunction, DefineGroup } from '../../utils/myAutomationParser'
import {
    getRealFunctions,
    commentInvalidRosterLines,
    deriveDefineGroups,
    sanitizeMacroName,
    serializeFunction,
} from '../../utils/myAutomationParser'
import { ToastService } from '../../services/toast.service'

type ViewTab = 'visual' | 'raw'

// ── Tree node data type ───────────────────────────────────────────────────────

interface TreeNodeData {
    id: string
    text: string
    displayText: string
    dccAddress: string
    fnCount: string
    childCount: string
    nodeType: string
    macroName: string
    rosterIdx: string
    expanded?: boolean
    children?: TreeNodeData[]
}

// ── Node content renderer (CSP-safe, no eval) ────────────────────────────────
// Syncfusion's nodeTemplate string uses new Function() internally which is blocked
// by Electron's CSP. We use the drawNode event to build DOM directly instead.

export class RosterEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)

    // ── View tabs ─────────────────────────────────────────────────────────────
    activeTab: ViewTab = 'visual'

    setTab(tab: ViewTab): void {
        if (tab === 'raw' && this.editBuffer !== null) {
            this.commitBuffer()
        }
        if (tab === 'visual' && this.activeTab === 'raw') {
            const text = this.rawEditor?.flush() ?? this._rawText
            this._processRawLeave(text)
            if (this.editBufferIndex !== null) {
                const fresh = this.state.roster[this.editBufferIndex]
                if (fresh) this._setBuffer(this.editBufferIndex, fresh)
                else this.clearBuffer()
            }
            this._rebuildTree()
        }
        if (tab === 'raw') {
            this.rawSnapshot = this.state.rosterRaw
            this._rawText = this.rawSnapshot
        }
        this.activeTab = tab
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    private splitterObj: Splitter | null = null
    private readonly observerLocator = resolve(IObserverLocator)

    private readonly _aliasSubscriber = {
        handleChange: () => {
            if (this.editBuffer !== null) {
                this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.dccAddress)
            }
        },
    }

    attached(): void {
        // Refresh alias display in case aliases changed while this editor was inactive
        if (this.editBuffer !== null) {
            this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.dccAddress)
        }
        this.observerLocator.getObserver(this.state, 'aliases').subscribe(this._aliasSubscriber)
        queueTask(() => {
            const savedWidth = this._loadSidebarWidth()
            this.splitterObj = new Splitter({
                paneSettings: [
                    { size: savedWidth, min: '200px', max: '600px' },
                    {},
                ],
                width: '100%',
                height: '100%',
                resizeStop: () => {
                    const pane = document.querySelector('#roster-splitter > div:first-child') as HTMLElement
                    if (pane) this._saveSidebarWidth(`${pane.offsetWidth}px`)
                },
            })
            this.splitterObj.appendTo('#roster-splitter')

            // TreeView — use drawNode (DOM API) instead of nodeTemplate string to avoid
            // Electron CSP eval violation (Syncfusion's template engine uses new Function())
            this.sfTree = new TreeView({
                fields: {
                    dataSource: this._buildTreeData() as unknown as { [key: string]: Object }[],
                    id: 'id',
                    text: 'text',
                    child: 'children',
                    expanded: 'expanded',
                },
                allowEditing: false,
                drawNode: (args: DrawNodeEventArgs) => {
                    this._renderNodeContent(args.node, args.nodeData as unknown as TreeNodeData)
                },
                nodeSelected: (args: NodeSelectEventArgs) => this._onNodeSelected(args),
                // Select the right-clicked node so _contextMenuNodeId is populated
                // before the ContextMenu's beforeOpen fires (mirrors the SF docs pattern).
                nodeClicked: (args) => {
                    if ((args.event as MouseEvent).which === 3 && this.sfTree) {
                        const uid = args.node.getAttribute('data-uid') ?? ''
                        const nodeData = this.sfTree.getTreeData(uid)
                        if (nodeData?.[0]) {
                            this._contextMenuNodeId = (nodeData[0] as { id: string }).id
                        }
                    }
                },
            })
            this.sfTree.appendTo(this.treeEl)

            // ContextMenu — second-arg constructor form per SF docs:
            // https://ej2.syncfusion.com/javascript/documentation/treeview/how-to/process-the-tree-node-operations-using-context-menu
            // The anchor element must be a <ul>; right-clicks on target: '#roster-treeview'
            // open the menu automatically. The ⋮ button dispatches a synthetic contextmenu
            // event so SF handles positioning identically to a real right-click.
            this.sfContextMenu = new ContextMenu({
                target: '#roster-treeview',
                items: [
                    { text: 'Clone', id: 'clone' },
                    { text: 'Delete', id: 'delete' },
                    { text: 'Rename Group', id: 'rename-group' },
                ],
                beforeOpen: (args: BeforeOpenCloseMenuEventArgs) => {
                    // If _contextMenuNodeId was not pre-set (real right-click path —
                    // nodeClicked fires *after* beforeOpen so we can't rely on it),
                    // derive the node id from the event target instead.
                    if (!this._contextMenuNodeId) {
                        const e = args.event as MouseEvent
                        if (!e || !this.sfTree) { args.cancel = true; return }
                        const nodeEl = (e.target as Element).closest('li[data-uid]') as HTMLElement | null
                        if (!nodeEl) { args.cancel = true; return }
                        const uid = nodeEl.dataset.uid ?? ''
                        const nodeData = this.sfTree.getTreeData(uid)
                        if (!nodeData?.[0]) { args.cancel = true; return }
                        this._contextMenuNodeId = (nodeData[0] as { id: string }).id
                    }
                    const isGroup = this._contextMenuNodeId.startsWith('group:')
                    if (isGroup) {
                        this.sfContextMenu!.hideItems(['clone', 'delete'], true)
                        this.sfContextMenu!.showItems(['rename-group'], true)
                    } else {
                        this.sfContextMenu!.showItems(['clone', 'delete'], true)
                        this.sfContextMenu!.hideItems(['rename-group'], true)
                    }
                },
                select: (args: MenuEventArgs) => this._onMenuSelect(args),
                onClose: () => { this._contextMenuNodeId = null },
            }, this.contextMenuEl)
        })
    }

    detaching(): void {
        this.observerLocator.getObserver(this.state, 'aliases').unsubscribe(this._aliasSubscriber)
        if (this.activeTab === 'raw') {
            const text = this.rawEditor?.flush() ?? this._rawText
            this._processRawLeave(text)
        } else if (this.editBuffer !== null) {
            this.commitBuffer()
        }
        this.sfContextMenu?.destroy()
        this.sfContextMenu = null
        this.sfTree?.destroy()
        this.sfTree = null
        this.splitterObj?.destroy()
        this.splitterObj = null
    }

    /**
     * Called whenever the user navigates away from raw mode.
     *
     * 1. Comments out any newly-invalid ROSTER lines and fires a toast for them.
     * 2. Persists ALL `// [INVALID]` lines (new + pre-existing) so they survive
     *    subsequent raw↔visual round-trips and don't silently disappear.
     */
    _processRawLeave(text: string): void {
        const { processedText, invalidLines } = commentInvalidRosterLines(text)

        const allInvalidComments = processedText
            .split('\n')
            .filter(l => l.trimStart().startsWith('// [INVALID]'))

        this.state.rosterPreservedComments = allInvalidComments.join('\n')
        this.state.setRosterFromRaw(processedText)

        if (invalidLines.length > 0) {
            this.toastService.show({
                title: 'Invalid Lines Commented Out',
                content: `${invalidLines.length} invalid roster line${invalidLines.length > 1 ? 's are' : ' is'} commented out to prevent data loss. Switch to Raw to review and fix.`,
                cssClass: 'e-toast-warning',
            })
        }
    }

    private _loadSidebarWidth(): string {
        try { return localStorage.getItem('roster-editor-sidebar-width') ?? '256px' } catch { return '256px' }
    }
    private _saveSidebarWidth(size: string): void {
        try { localStorage.setItem('roster-editor-sidebar-width', size) } catch { /* ignore */ }
    }

    // ── Raw snapshot for Monaco ───────────────────────────────────────────────
    rawEditor: { flush(): string } | null = null
    rawSnapshot = ''
    private _rawText = ''

    onRawChange = (text: string): void => {
        this._rawText = text
        this.state.setRosterFromRaw(text)
        if (this.editBufferIndex !== null) {
            const fresh = this.state.roster[this.editBufferIndex]
            if (fresh) this._setBuffer(this.editBufferIndex, fresh)
            else this.clearBuffer()
        }
    }

    // ── TreeView + ContextMenu ────────────────────────────────────────────────
    treeEl!: HTMLDivElement
    contextMenuEl!: HTMLUListElement
    private sfTree: TreeView | null = null
    private sfContextMenu: ContextMenu | null = null
    /** Id of the node last targeted by right-click or ⋮ button. Cleared on menu close. */
    private _contextMenuNodeId: string | null = null
    /** True while we are programmatically setting selectedNodes to avoid re-entrant nodeSelected → rebuild loops. */
    private _suppressNodeSelected = false

    private _buildTreeData(): TreeNodeData[] {
        const { groups, ungrouped } = deriveDefineGroups(this.state.roster)
        const nodes: TreeNodeData[] = []

        for (const group of groups) {
            const locoCount = group.rosterIndices.length
            const childCount = locoCount === 1 ? '1 loco' : `${locoCount} locos`
            const displayText = group.friendlyName || group.macroName
            nodes.push({
                id: `group:${group.macroName}`,
                text: displayText,
                displayText,
                dccAddress: '',
                fnCount: '',
                childCount,
                nodeType: 'group',
                macroName: group.macroName,
                rosterIdx: '',
                expanded: true,
                children: group.rosterIndices.map(i => {
                    const entry = this.state.roster[i]
                    return {
                        id: `loco:${i}`,
                        text: entry.name,
                        displayText: entry.name,
                        dccAddress: String(entry.dccAddress),
                        fnCount: String(getRealFunctions(entry).length),
                        childCount: '',
                        nodeType: 'loco',
                        macroName: group.macroName,
                        rosterIdx: String(i),
                        expanded: false,
                    }
                }),
            })
        }

        for (const i of ungrouped) {
            const entry = this.state.roster[i]
            nodes.push({
                id: `loco:${i}`,
                text: entry.name,
                displayText: entry.name,
                dccAddress: String(entry.dccAddress),
                fnCount: String(getRealFunctions(entry).length),
                childCount: '',
                nodeType: 'loco',
                macroName: '',
                rosterIdx: String(i),
                expanded: false,
            })
        }

        return nodes
    }

    private _rebuildTree(): void {
        if (!this.sfTree) return
        const data = this._buildTreeData()
        this.sfTree.fields = {
            dataSource: data as any,
            id: 'id',
            text: 'text',
            child: 'children',
            expanded: 'expanded',
        }
        // Suppress nodeSelected during refresh(): SF fires it synchronously for the
        // previously-selected node when restoring selection state after the rebuild.
        // Without this guard the old node's handler would overwrite editBufferIndex
        // before the queued selection-restore task runs.
        this._suppressNodeSelected = true
        this.sfTree.refresh()
        this._suppressNodeSelected = false

        // Expand all group nodes and restore selection
        // SF refresh() may not auto-apply expanded:true from data for new group nodes;
        // explicitly expand all group nodes so child locos are visible.
        const groupIds = this._buildTreeData()
            .filter(n => n.id.startsWith('group:'))
            .map(n => n.id)
        if (groupIds.length > 0) {
            this.sfTree.expandAll(groupIds)
        }

        // Restore the selected node
        const nodeId = this._currentSelectionNodeId()
        if (nodeId) {
            this._suppressNodeSelected = true
            this.sfTree.selectedNodes = [nodeId]
            this._suppressNodeSelected = false
        }
    }

    /** Builds custom node content using DOM APIs (no eval; CSP-safe). */
    private _renderNodeContent(node: HTMLLIElement, data: TreeNodeData): void {
        // SF TreeView structure: li > .e-text-content > .e-list-text
        const textWrap = node.querySelector('.e-text-content') as HTMLElement | null
        const textSpan = node.querySelector('.e-list-text') as HTMLElement | null
        if (!textWrap || !textSpan) return

        // Make the text-content wrapper a flex row so node content + ⋮ button lay out correctly.
        // position:relative + z-index:1 lifts it above e-fullrow (position:absolute, z-index:auto)
        // so the ⋮ button and text spans receive pointer events correctly.
        textWrap.style.cssText = 'display:flex;align-items:center;gap:0.375rem;min-width:0;width:100%;position:relative;z-index:1;'
        textSpan.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:0.375rem;'
        textSpan.textContent = ''

        if (data.nodeType === 'group') {
            const chip = document.createElement('span')
            chip.className = 'text-xs font-mono text-yellow-400 shrink-0'
            chip.textContent = '#define'

            const nameSpan = document.createElement('span')
            nameSpan.className = 'text-sm font-medium text-gray-100 truncate flex-1'
            nameSpan.textContent = data.displayText

            const countSpan = document.createElement('span')
            countSpan.className = 'text-xs text-gray-500 shrink-0'
            countSpan.textContent = data.childCount

            textSpan.appendChild(chip)
            textSpan.appendChild(nameSpan)
            textSpan.appendChild(countSpan)
        } else {
            const nameSpan = document.createElement('span')
            nameSpan.className = 'text-sm text-gray-300 truncate flex-1'
            nameSpan.textContent = data.displayText

            const addrSpan = document.createElement('span')
            addrSpan.className = 'text-xs text-gray-500 font-mono shrink-0'
            addrSpan.textContent = `#${data.dccAddress}`

            const fnBadge = document.createElement('span')
            fnBadge.className = 'px-1 py-0.5 text-xs rounded-full bg-gray-700 text-gray-300 shrink-0'
            fnBadge.textContent = data.fnCount

            textSpan.appendChild(nameSpan)
            textSpan.appendChild(addrSpan)
            textSpan.appendChild(fnBadge)
        }

    }

    private _currentSelectionNodeId(): string | null {
        if (this.selectedNodeType === 'loco' && this.editBufferIndex !== null) {
            return `loco:${this.editBufferIndex}`
        }
        if (this.selectedNodeType === 'group' && this.selectedMacroName) {
            return `group:${this.selectedMacroName}`
        }
        return null
    }

    private _onNodeSelected(args: NodeSelectEventArgs): void {
        if (this._suppressNodeSelected) return
        const id = (args.nodeData as { id?: string }).id ?? ''
        if (!id) return

        if (id.startsWith('group:')) {
            const macroName = id.slice('group:'.length)
            this.selectedNodeType = 'group'
            this.selectedMacroName = macroName
            this.clearBuffer()
            const { groups } = deriveDefineGroups(this.state.roster)
            const group = groups.find(g => g.macroName === macroName)
            if (group) {
                this.groupFunctions = group.functions.map(f => ({ ...f }))
                this.groupFriendlyName = group.friendlyName ?? ''
            }
        } else if (id.startsWith('loco:')) {
            const idx = parseInt(id.slice('loco:'.length), 10)
            this.selectedNodeType = 'loco'
            this.selectedMacroName = null
            this.groupFunctions = []
            this.groupFriendlyName = ''
            if (this.editBuffer !== null) this.commitBuffer()
            if (!isNaN(idx) && idx < this.state.roster.length) {
                this._setBuffer(idx, this.state.roster[idx])
            }
        }
        // No _rebuildTree() here — SF handles the visual highlight for user clicks.
        // Rebuilds only happen from data-changing paths (blur handlers, add/remove/clone).
    }

    private _onMenuSelect(args: MenuEventArgs): void {
        const action = args.item.id
        const nodeId = this._contextMenuNodeId ?? ''

        if (action === 'clone' && nodeId.startsWith('loco:')) {
            const idx = parseInt(nodeId.slice(5), 10)
            if (!isNaN(idx)) this.cloneEntry(idx)
        } else if (action === 'delete' && nodeId.startsWith('loco:')) {
            const idx = parseInt(nodeId.slice(5), 10)
            if (!isNaN(idx)) this.removeEntryByIndex(idx)
        } else if (action === 'rename-group' && nodeId.startsWith('group:')) {
            const macroName = nodeId.slice(6)
            this.promptRenameGroup(macroName)
        }
    }

    // ── Selection state ───────────────────────────────────────────────────────
    selectedNodeType: 'loco' | 'group' | null = null
    selectedMacroName: string | null = null

    get selectedEntry(): Roster | null {
        if (this.editBufferIndex === null) return null
        return this.state.roster[this.editBufferIndex] ?? null
    }

    // ── Loco edit buffer ──────────────────────────────────────────────────────
    editBuffer: Roster | null = null
    editBufferIndex: number | null = null
    errorMessage = ''
    warningMessage = ''
    aliasInput = ''

    get roster(): Roster[] {
        return this.state.roster
    }

    private _setBuffer(index: number, entry: Roster): void {
        this.editBufferIndex = index
        this.editBuffer = {
            dccAddress: entry.dccAddress,
            name: entry.name,
            comment: entry.comment,
            functions: entry.functions.map(f => ({ ...f })),
            functionMacro: entry.functionMacro,
            defineFriendlyName: entry.defineFriendlyName,
            appendedFunctions: entry.appendedFunctions?.map(f => ({ ...f })),
        }
        this.dccAddressInput = String(entry.dccAddress)
        this.aliasInput = this.state.getPrimaryAliasNameForId(entry.dccAddress)
        this.errorMessage = ''
        this.warningMessage = this.state.getCrossTypeIdWarning?.(entry.dccAddress, 'Roster') ?? ''
        this.loadAppendedFunctions()
    }

    clearBuffer(): void {
        this.editBuffer = null
        this.editBufferIndex = null
        this.aliasInput = ''
        this.errorMessage = ''
        this.warningMessage = ''
        this.appendedFunctionsList = []
    }

    commitBuffer(): void {
        if (this.editBuffer === null || this.editBufferIndex === null) return
        const conflict = this.state.roster.find(
            (r, i) => i !== this.editBufferIndex && r.dccAddress === this.editBuffer!.dccAddress,
        )
        if (conflict) {
            this.errorMessage = `DCC address ${this.editBuffer.dccAddress} is already used by "${conflict.name}".`
            return
        }
        const existing = this.state.roster[this.editBufferIndex]
        const changed = !existing || JSON.stringify(existing) !== JSON.stringify(this.editBuffer)
        const existingAliasName = existing ? this.state.getPrimaryAliasNameForId(existing.dccAddress) : ''
        const aliasChanged = !!existing && (existing.dccAddress !== this.editBuffer.dccAddress || existingAliasName !== this.aliasInput.trim())
        this.state.updateRosterEntry(this.editBufferIndex, { ...this.editBuffer })
        if (existing && (aliasChanged || this.aliasInput.trim() !== '')) {
            const aliasResult = this.state.syncAliasForId(
                existing.dccAddress,
                this.editBuffer.dccAddress,
                this.aliasInput,
                'Roster',
                existingAliasName,
            )
            if (!aliasResult.ok) {
                this.errorMessage = aliasResult.reason
                this.warningMessage = this.state.getCrossTypeIdWarning?.(this.editBuffer.dccAddress, 'Roster') ?? ''
                return
            }
        }
        this.errorMessage = ''
        this.warningMessage = this.state.getCrossTypeIdWarning?.(this.editBuffer.dccAddress, 'Roster') ?? ''
        // Only rebuild the tree when data actually changed; pure selection switches
        // (no edits) call commitBuffer too but produce no visible change, and
        // triggering a refresh on every click breaks SF's own selection management.
        if (changed) this._rebuildTree()
    }

    // ── DCC address + field blur handlers ────────────────────────────────────
    dccAddressInput = ''

    onDccAddressInput(): void {
        const n = parseInt(this.dccAddressInput, 10)
        if (!isNaN(n) && this.editBuffer) {
            this.editBuffer.dccAddress = n
            this.warningMessage = this.state.getCrossTypeIdWarning?.(n, 'Roster') ?? ''
        }
    }

    onDccAddressBlur(): void { this.commitBuffer() }
    onNameBlur(): void { this.commitBuffer() }
    onCommentBlur(): void { this.commitBuffer() }
    onAliasBlur(): void { this.commitBuffer() }

    // ── Add / remove loco entries ─────────────────────────────────────────────
    addEntry(): void {
        if (this.editBuffer !== null) this.commitBuffer()
        const maxAddr =
            this.state.roster.length > 0 ? Math.max(...this.state.roster.map(r => r.dccAddress)) + 1 : 1
        const newEntry: Roster = { dccAddress: maxAddr, name: `New Loco ${maxAddr}`, functions: [], comment: '' }
        this.state.addRosterEntry(newEntry)
        const idx = this.state.roster.length - 1
        this.selectedNodeType = 'loco'
        this.selectedMacroName = null
        this._setBuffer(idx, this.state.roster[idx])
        this._rebuildTree()
    }

    async removeEntryByIndex(index: number, event?: Event): Promise<void> {
        event?.stopPropagation()
        const entry = this.state.roster[index]
        const name = entry?.name || `Roster ${index}`
        const confirmed = await this._confirm(`Delete "${name}"?`, `Are you sure you want to remove this roster entry?`)
        if (!confirmed) return
        if (this.editBufferIndex === index) {
            this.clearBuffer()
            this.selectedNodeType = null
        } else if (this.editBufferIndex !== null && this.editBufferIndex > index) {
            this.editBufferIndex--
        }
        this.state.removeRosterEntry(index)
        this._rebuildTree()
    }

    // ── Clone ─────────────────────────────────────────────────────────────────
    cloneEntry(index: number): void {
        const entry = this.state.roster[index]
        const maxAddr =
            this.state.roster.length > 0 ? Math.max(...this.state.roster.map(r => r.dccAddress)) + 1 : 1
        const funcsCopy = entry.functions.map(f => ({ ...f }))
        const clone: Roster = {
            dccAddress: maxAddr,
            name: `${entry.name} (copy)`,
            functions: funcsCopy,
            comment: entry.comment,
            functionMacro: entry.functionMacro,
            defineFriendlyName: entry.defineFriendlyName,
        }

        if (!entry.functionMacro) {
            // Inline entry: generate a new #define and convert BOTH the original and the clone
            const existingMacros = new Set(
                this.state.roster.filter(r => r.functionMacro).map(r => r.functionMacro!),
            )
            let base = sanitizeMacroName(entry.name)
            let macroName = base
            let n = 1
            while (existingMacros.has(macroName)) macroName = `${base}_${n++}`

            this.state.updateRosterEntry(index, { ...entry, functionMacro: macroName })
            clone.functionMacro = macroName

            this.state.addRosterEntry(clone)

            // Select the new group
            this.selectedNodeType = 'group'
            this.selectedMacroName = macroName
            this.editBuffer = null
            this.editBufferIndex = null
            this.groupFunctions = funcsCopy.map(f => ({ ...f }))
            this.groupFriendlyName = ''
            this._rebuildTree()
        } else {
            this.state.addRosterEntry(clone)
            const cloneIndex = this.state.roster.length - 1
            this.selectedNodeType = 'loco'
            this.selectedMacroName = null
            this.groupFunctions = []
            this.groupFriendlyName = ''
            if (this.editBuffer !== null) this.commitBuffer()
            this._setBuffer(cloneIndex, this.state.roster[cloneIndex])
            // Rebuild tree; _rebuildTree() will automatically select the cloned node
            // because editBufferIndex is now set via _setBuffer() above
            this._rebuildTree()
        }
    }

    // ── "Edit function list" button (loco-with-macro detail) ─────────────────
    editFunctionList(): void {
        if (!this.editBuffer?.functionMacro) return
        const macroName = this.editBuffer.functionMacro
        this.commitBuffer()

        this.selectedNodeType = 'group'
        this.selectedMacroName = macroName
        this.editBuffer = null
        this.editBufferIndex = null

        const { groups } = deriveDefineGroups(this.state.roster)
        const group = groups.find(g => g.macroName === macroName)
        if (group) {
            this.groupFunctions = group.functions.map(f => ({ ...f }))
            this.groupFriendlyName = group.friendlyName ?? ''
        }

        if (this.sfTree) {
            this._suppressNodeSelected = true
            this.sfTree.selectedNodes = [`group:${macroName}`]
            this._suppressNodeSelected = false
        }
    }

    // ── Rename group ──────────────────────────────────────────────────────────
    promptRenameGroup(macroName: string): void {
        const newName = window.prompt(`Rename #define "${macroName}":`, macroName)
        if (!newName || newName === macroName || !newName.trim()) return

        const trimmed = newName.trim()
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
            this.toastService.show({
                title: 'Invalid Name',
                content: 'Macro name must be a valid C identifier (letters, digits, underscore; cannot start with digit).',
                cssClass: 'e-toast-warning',
            })
            return
        }

        const existingMacros = new Set(
            this.state.roster
                .filter(r => r.functionMacro && r.functionMacro !== macroName)
                .map(r => r.functionMacro!),
        )
        if (existingMacros.has(trimmed)) {
            this.toastService.show({
                title: 'Name Already Used',
                content: `A #define named "${trimmed}" already exists.`,
                cssClass: 'e-toast-warning',
            })
            return
        }

        this.state.renameMacro(macroName, trimmed)
        if (this.selectedMacroName === macroName) this.selectedMacroName = trimmed
        this._rebuildTree()
    }

    // ── Macro name editing (inline in group panel) ───────────────────────────
    editingMacroName = false
    macroNameInput = ''

    startEditingMacroName(): void {
        if (!this.selectedMacroName) return
        this.editingMacroName = true
        this.macroNameInput = this.selectedMacroName
    }

    cancelEditMacroName(): void {
        this.editingMacroName = false
        this.macroNameInput = ''
    }

    saveMacroName(): void {
        if (!this.selectedMacroName || !this.macroNameInput.trim()) return
        const trimmed = this.macroNameInput.trim()
        if (trimmed === this.selectedMacroName) {
            this.cancelEditMacroName()
            return
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
            this.toastService.show({
                title: 'Invalid Name',
                content: 'Macro name must be a valid C identifier (letters, digits, underscore; cannot start with digit).',
                cssClass: 'e-toast-warning',
            })
            return
        }
        const existingMacros = new Set(
            this.state.roster
                .filter(r => r.functionMacro && r.functionMacro !== this.selectedMacroName)
                .map(r => r.functionMacro!),
        )
        if (existingMacros.has(trimmed)) {
            this.toastService.show({
                title: 'Name Already Used',
                content: `A #define named "${trimmed}" already exists.`,
                cssClass: 'e-toast-warning',
            })
            return
        }
        this.state.renameMacro(this.selectedMacroName, trimmed)
        this.selectedMacroName = trimmed
        this.editingMacroName = false
        this.macroNameInput = ''
        this._rebuildTree()
    }

    // ── Group functions editing ───────────────────────────────────────────────
    groupFunctions: RosterFunction[] = []
    groupFriendlyName = ''
    groupDraggedIndex: number | null = null
    newGroupFunctionName = ''
    newGroupFunctionIsMomentary = false
    newGroupFunctionNoFunction = false

    get selectedGroupDisplayName(): string {
        return this.groupFriendlyName || this.selectedMacroName || ''
    }

    onGroupFriendlyNameBlur(): void {
        if (!this.selectedMacroName) return
        this.state.updateDefineFriendlyName(this.selectedMacroName, this.groupFriendlyName)
        this._rebuildTree()
    }

    addGroupFunction(): void {
        if (!this.selectedMacroName) return
        if (!this.newGroupFunctionNoFunction && !this.newGroupFunctionName.trim()) return
        const fn: RosterFunction = {
            name: this.newGroupFunctionNoFunction ? '' : this.newGroupFunctionName.trim(),
            isMomentary: this.newGroupFunctionIsMomentary,
            noFunction: this.newGroupFunctionNoFunction,
        }
        this.groupFunctions = [...this.groupFunctions, fn]
        this.newGroupFunctionName = ''
        this.newGroupFunctionIsMomentary = false
        this.newGroupFunctionNoFunction = false
        this.state.updateDefineFunctions(this.selectedMacroName, this.groupFunctions)
    }

    removeGroupFunction(i: number): void {
        if (!this.selectedMacroName) return
        this.groupFunctions = this.groupFunctions.filter((_, idx) => idx !== i)
        this.state.updateDefineFunctions(this.selectedMacroName, this.groupFunctions)
    }

    updateGroupFunctionName(i: number): void {
        if (!this.selectedMacroName) return
        this.state.updateDefineFunctions(this.selectedMacroName, this.groupFunctions)
    }

    toggleGroupMomentary(i: number): void {
        if (!this.selectedMacroName) return
        this.groupFunctions = this.groupFunctions.map((f, idx) =>
            idx === i ? { ...f, isMomentary: !f.isMomentary } : f,
        )
        this.state.updateDefineFunctions(this.selectedMacroName, this.groupFunctions)
    }

    groupDragStart(i: number, event: DragEvent): void {
        this.groupDraggedIndex = i
        event.dataTransfer!.effectAllowed = 'move'
    }

    groupDragOver(event: DragEvent): void {
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'move'
    }

    groupDrop(targetIndex: number, event: DragEvent): void {
        event.preventDefault()
        if (this.groupDraggedIndex === null || this.groupDraggedIndex === targetIndex || !this.selectedMacroName) return
        const fns = [...this.groupFunctions]
        const [moved] = fns.splice(this.groupDraggedIndex, 1)
        fns.splice(targetIndex, 0, moved)
        this.groupFunctions = fns
        this.groupDraggedIndex = null
        this.state.updateDefineFunctions(this.selectedMacroName, this.groupFunctions)
    }

    groupDragEnd(): void {
        this.groupDraggedIndex = null
    }

    handleAddGroupFunctionKeydown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter') { this.addGroupFunction(); return false }
        return true
    }

    // ── Loco functions management (existing, for inline locos) ────────────────
    newFunctionName = ''
    newFunctionIsMomentary = false
    newFunctionNoFunction = false

    addFunction(): void {
        if (!this.editBuffer) return
        if (!this.newFunctionNoFunction && !this.newFunctionName.trim()) return
        const fn: RosterFunction = {
            name: this.newFunctionNoFunction ? '' : this.newFunctionName.trim(),
            isMomentary: this.newFunctionIsMomentary,
            noFunction: this.newFunctionNoFunction,
        }
        this.editBuffer.functions = [...this.editBuffer.functions, fn]
        this.newFunctionName = ''
        this.newFunctionIsMomentary = false
        this.newFunctionNoFunction = false
        this.commitBuffer()
    }

    removeFunction(index: number): void {
        if (!this.editBuffer) return
        this.editBuffer.functions = this.editBuffer.functions.filter((_, i) => i !== index)
        this.commitBuffer()
    }

    updateFunctionName(index: number): void {
        this.commitBuffer()
    }

    toggleMomentary(index: number): void {
        if (!this.editBuffer) return
        this.editBuffer.functions[index] = {
            ...this.editBuffer.functions[index],
            isMomentary: !this.editBuffer.functions[index].isMomentary,
        }
        this.commitBuffer()
    }

    // Drag-to-reorder (for loco functions)
    draggedIndex: number | null = null

    dragStart(index: number, event: DragEvent): void {
        this.draggedIndex = index
        event.dataTransfer!.effectAllowed = 'move'
    }

    dragOver(event: DragEvent): void {
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'move'
    }

    drop(targetIndex: number, event: DragEvent): void {
        event.preventDefault()
        if (this.draggedIndex === null || this.draggedIndex === targetIndex || !this.editBuffer) return
        const fns = [...this.editBuffer.functions]
        const [moved] = fns.splice(this.draggedIndex, 1)
        fns.splice(targetIndex, 0, moved)
        this.editBuffer.functions = fns
        this.draggedIndex = null
        this.commitBuffer()
    }

    dragEnd(): void {
        this.draggedIndex = null
    }

    handleAddFunctionKeydown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter') { this.addFunction(); return false }
        return true
    }

    // ── Appended functions (for locos with a group) ───────────────────────────
    appendedFunctionsList: RosterFunction[] = []
    appendedDraggedIndex: number | null = null
    newAppendedFunctionName = ''
    newAppendedFunctionIsMomentary = false
    newAppendedFunctionNoFunction = false

    /** Load appended functions when selecting a loco with a macro. */
    loadAppendedFunctions(): void {
        if (!this.editBuffer?.functionMacro) {
            this.appendedFunctionsList = []
            return
        }
        this.appendedFunctionsList = this.editBuffer.appendedFunctions?.map(f => ({ ...f })) ?? []
    }

    addAppendedFunction(): void {
        if (!this.editBuffer?.functionMacro) return
        if (!this.newAppendedFunctionNoFunction && !this.newAppendedFunctionName.trim()) return
        const fn: RosterFunction = {
            name: this.newAppendedFunctionNoFunction ? '' : this.newAppendedFunctionName.trim(),
            isMomentary: this.newAppendedFunctionIsMomentary,
            noFunction: this.newAppendedFunctionNoFunction,
        }
        // Update both the UI list and the edit buffer in sync
        this.appendedFunctionsList = [...this.appendedFunctionsList, fn]
        this.editBuffer.appendedFunctions = this.appendedFunctionsList.length > 0 ? [...this.appendedFunctionsList] : undefined
        // Clear input fields
        this.newAppendedFunctionName = ''
        this.newAppendedFunctionIsMomentary = false
        this.newAppendedFunctionNoFunction = false
        // Defer commit to let Aurelia render the new item first
        queueTask(() => this.commitBuffer())
    }

    removeAppendedFunction(index: number): void {
        this.appendedFunctionsList = this.appendedFunctionsList.filter((_, i) => i !== index)
        this.editBuffer!.appendedFunctions = this.appendedFunctionsList.length > 0 ? [...this.appendedFunctionsList] : undefined
        queueTask(() => this.commitBuffer())
    }

    updateAppendedFunctionName(index: number): void {
        this.editBuffer!.appendedFunctions = this.appendedFunctionsList.length > 0 ? [...this.appendedFunctionsList] : undefined
        queueTask(() => this.commitBuffer())
    }

    toggleAppendedMomentary(index: number): void {
        this.appendedFunctionsList = this.appendedFunctionsList.map((f, idx) =>
            idx === index ? { ...f, isMomentary: !f.isMomentary } : f,
        )
        this.editBuffer!.appendedFunctions = this.appendedFunctionsList.length > 0 ? [...this.appendedFunctionsList] : undefined
        queueTask(() => this.commitBuffer())
    }

    appendedDragStart(i: number, event: DragEvent): void {
        this.appendedDraggedIndex = i
        event.dataTransfer!.effectAllowed = 'move'
    }

    appendedDragOver(event: DragEvent): void {
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'move'
    }

    appendedDrop(targetIndex: number, event: DragEvent): void {
        event.preventDefault()
        if (this.appendedDraggedIndex === null || this.appendedDraggedIndex === targetIndex) return
        const fns = [...this.appendedFunctionsList]
        const [moved] = fns.splice(this.appendedDraggedIndex, 1)
        fns.splice(targetIndex, 0, moved)
        this.appendedFunctionsList = fns
        this.appendedDraggedIndex = null
        this.editBuffer!.appendedFunctions = this.appendedFunctionsList.length > 0 ? [...this.appendedFunctionsList] : undefined
        queueTask(() => this.commitBuffer())
    }

    appendedDragEnd(): void {
        this.appendedDraggedIndex = null
    }

    handleAddAppendedFunctionKeydown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter') { this.addAppendedFunction(); return false }
        return true
    }

    private _updateAppendedFunctions(): void {
        if (!this.editBuffer?.functionMacro) return
        // Update the appended functions for serialization
        this.editBuffer.appendedFunctions = this.appendedFunctionsList.length > 0 ? this.appendedFunctionsList : undefined
        // Commit will update state.roster with the new editBuffer
        this.commitBuffer()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    getRealFunctionCount(entry: Roster): number {
        return getRealFunctions(entry).length
    }

    get hasEntries(): boolean {
        return this.state.roster.length > 0
    }

    private async _confirm(title: string, message: string): Promise<boolean> {
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('../confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
                model: { title, message },
            })
            const result = await dialog.closed
            return result.status === 'ok'
        } catch {
            return window.confirm(`${title}\n\n${message}`)
        }
    }
}
