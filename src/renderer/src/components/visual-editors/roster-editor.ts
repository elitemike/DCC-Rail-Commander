import { IObserverLocator, queueTask, resolve } from 'aurelia'
import { loadTreeWidth, saveTreeWidth } from '../../utils/tree-width'
import { IDialogService } from '@aurelia/dialog'
import { TreeView, ContextMenu } from '@syncfusion/ej2-navigations'
import type { BeforeOpenCloseMenuEventArgs, MenuEventArgs, NodeSelectEventArgs, DrawNodeEventArgs, DragAndDropEventArgs } from '@syncfusion/ej2-navigations'
import { Splitter } from '@syncfusion/ej2-layouts'
import { ConfigEditorState } from '../../models/config-editor-state'
import { allFolderPaths, buildFolderTree, isValidFolderName, itemIndicesUnder, type FolderTreeNode } from '../../utils/folder-tree'
import type { TextInputResult } from '../dialogs/text-input-dialog'
import type { Roster, RosterFunction, DefineGroup } from '../../utils/myAutomationParser'
import {
    getRealFunctions,
    commentInvalidRosterLines,
    deriveDefineGroups,
    sanitizeMacroName,
    serializeFunction,
} from '../../utils/myAutomationParser'
import { ToastService } from '../../services/toast.service'
import { EditorDefaultViewService } from '../../services/editor-default-view.service'

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
    /** Folder path (folders), or the folder a #define group sits in ('' = top level). */
    folderPath?: string
    expanded?: boolean
    children?: TreeNodeData[]
}

const FOLDER_PREFIX = 'folder:'

/** Node id of a #define group: unique per folder, since one macro can appear under several folders. */
const groupNodeId = (macroName: string, folderPath: string): string => (folderPath ? `group:${macroName}@${folderPath}` : `group:${macroName}`)

/** Splits a `group:` node id back into the macro name and the folder it sits in. */
function parseGroupNodeId(id: string): { macroName: string; folderPath: string } {
    const body = id.slice('group:'.length)
    const at = body.indexOf('@')
    return at < 0 ? { macroName: body, folderPath: '' } : { macroName: body.slice(0, at), folderPath: body.slice(at + 1) }
}

// ── Node content renderer (CSP-safe, no eval) ────────────────────────────────
// Syncfusion's nodeTemplate string uses new Function() internally which is blocked
// by Electron's CSP. We use the drawNode event to build DOM directly instead.

export class RosterEditorCustomElement {
    readonly state = resolve(ConfigEditorState)
    private readonly dialogService = resolve(IDialogService)
    private readonly toastService = resolve(ToastService)
    private readonly editorDefaultView = resolve(EditorDefaultViewService)

    // ── View tabs ─────────────────────────────────────────────────────────────
    activeTab: ViewTab = 'visual'
    /** Set once the user explicitly clicks Visual/Raw for this file. Until then, attached() re-applies the current default-editor-view preference on every visit — see attached() below. */
    private _userChoseTab = false

    setTab(tab: ViewTab): void {
        this._userChoseTab = true
        this._applyTab(tab)
    }

    /** Applies the current default-editor-view preference, unless the user has already picked a tab for this file this session. Called from attached() on every visit — see there for why. */
    private _applyDefaultViewIfUnset(): void {
        if (!this._userChoseTab) this._applyTab(this.editorDefaultView.value)
    }

    /** setTab()'s actual work, factored out so attached() can (re)apply the default-editor-view preference without marking it as a user choice. */
    private _applyTab(tab: ViewTab): void {
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
    /** Guards the queueTask() below — this component can be torn down before the deferred Splitter/TreeView/ContextMenu creation runs, which would otherwise append live widgets into detached elements and leave broken instances for detaching() to (potentially) throw on. */
    private _detached = false

    private readonly _aliasSubscriber = {
        handleChange: () => {
            if (this.editBuffer !== null) {
                this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.dccAddress, 'Roster')
            }
        },
    }

    attached(): void {
        // Aurelia's if.bind caches and reuses this same component instance across
        // hide/show cycles — re-apply the current default-editor-view preference on
        // every visit (not just the first) so a setting change made while this
        // file's editor already existed still takes effect, as long as the user
        // hasn't manually picked a tab for it this session.
        this._applyDefaultViewIfUnset()
        // Reset the guard set by the previous detaching() — or the queued widget
        // creation below would skip itself forever after the first time this
        // editor is left and revisited.
        this._detached = false
        // Refresh alias display in case aliases changed while this editor was inactive
        if (this.editBuffer !== null) {
            this.aliasInput = this.state.getPrimaryAliasNameForId(this.editBuffer.dccAddress, 'Roster')
        }
        this.observerLocator.getObserver(this.state, 'aliases').subscribe(this._aliasSubscriber)
        queueTask(() => {
            if (this._detached) return
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
                allowDragAndDrop: true,
                drawNode: (args: DrawNodeEventArgs) => {
                    this._renderNodeContent(args.node, args.nodeData as unknown as TreeNodeData)
                },
                // Locos, #define groups (moves all of the group's locos) and folders can be dragged.
                nodeDragStart: (args: DragAndDropEventArgs) => {
                    const id = String((args.draggedNodeData as { id?: string }).id ?? '')
                    if (!id.startsWith('loco:') && !id.startsWith('group:') && !id.startsWith(FOLDER_PREFIX)) args.cancel = true
                },
                nodeDragging: (args: DragAndDropEventArgs) => this._onNodeDragging(args),
                nodeDragStop: (args: DragAndDropEventArgs) => {
                    // The move is applied to state and the tree rebuilt from it - letting SF also
                    // move the DOM node would leave the two out of step.
                    args.cancel = true
                    this._clearDropHighlight()
                    // State changes now, but the tree is rebuilt only after SF has finished its own drop
                    // handling: refreshing it from inside this callback leaves the next drag dead
                    // (no drag handle). SF can also still nest the dragged node under a loco target in
                    // the DOM despite `cancel`; the tree is derived from state, so always rebuild
                    // afterwards, including for rejected/no-op drops.
                    this._inDrop = true
                    try { this._onNodeDrop(args) } finally { this._inDrop = false }
                    setTimeout(() => this._rebuildTree(), 100)
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
                    { text: 'New Folder\u2026', id: 'new-folder' },
                    { text: 'Rename Folder\u2026', id: 'rename-folder' },
                    { text: 'Delete Folder', id: 'delete-folder' },
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
                    const all = ['clone', 'delete', 'rename-group', 'new-folder', 'rename-folder', 'delete-folder']
                    const id = this._contextMenuNodeId
                    const show = id.startsWith(FOLDER_PREFIX) ? ['new-folder', 'rename-folder', 'delete-folder']
                        : id.startsWith('group:') ? ['rename-group']
                            : ['clone', 'delete']
                    this.sfContextMenu!.hideItems(all.filter(i => !show.includes(i)), true)
                    this.sfContextMenu!.showItems(show, true)
                },
                select: (args: MenuEventArgs) => this._onMenuSelect(args),
                onClose: () => { this._contextMenuNodeId = null },
            }, this.contextMenuEl)
        })
    }

    detaching(): void {
        this._detached = true
        this.observerLocator.getObserver(this.state, 'aliases').unsubscribe(this._aliasSubscriber)
        if (this.activeTab === 'raw') {
            const text = this.rawEditor?.flush() ?? this._rawText
            this._processRawLeave(text)
        } else if (this.editBuffer !== null) {
            this.commitBuffer()
        }
        // A widget left in a broken/partially-appended state must not be allowed to
        // throw here — that would abort Aurelia's own teardown of this component
        // mid-sequence and leave its DOM stuck in place instead of being removed.
        try { this.sfContextMenu?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.sfContextMenu = null
        try { this.sfTree?.destroy() } catch { /* already broken — nothing to clean up */ }
        this.sfTree = null
        try { this.splitterObj?.destroy() } catch { /* already broken — nothing to clean up */ }
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
        return `${loadTreeWidth()}px`
    }
    private _saveSidebarWidth(size: string): void {
        saveTreeWidth(parseInt(size, 10))
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

    /**
     * Tree layers, outermost first: user folders (`// @tree:` comments) -> #define groups -> locos.
     * A #define group is *not* a top-level node: it appears inside whichever folder holds its locos
     * (so one macro can show up under several folders, or at the top level), and locos with no
     * #define sit directly in their folder. The macros and ROSTER lines themselves never change.
     */
    private _buildTreeData(): TreeNodeData[] {
        const roster = this.state.roster
        const plural = (n: number): string => (n === 1 ? '1 loco' : `${n} locos`)

        const locoNode = (i: number, macroName: string): TreeNodeData => {
            const entry = roster[i]
            return {
                id: `loco:${i}`,
                text: entry.name,
                displayText: entry.name,
                dccAddress: String(entry.dccAddress),
                fnCount: String(getRealFunctions(entry).length),
                childCount: '',
                nodeType: 'loco',
                macroName,
                rosterIdx: String(i),
                expanded: false,
            }
        }

        /** The #define groups and loose locos among `indices`, all of which live directly in `folderPath`. */
        const levelNodes = (indices: number[], folderPath: string): TreeNodeData[] => {
            const byMacro = new Map<string, number[]>()
            const loose: number[] = []
            for (const i of indices) {
                const macro = roster[i].functionMacro
                if (!macro) { loose.push(i); continue }
                const list = byMacro.get(macro)
                if (list) list.push(i)
                else byMacro.set(macro, [i])
            }
            const nodes: TreeNodeData[] = []
            for (const [macroName, idxs] of byMacro) {
                const displayText = roster[idxs[0]].defineFriendlyName || macroName
                nodes.push({
                    id: groupNodeId(macroName, folderPath),
                    text: displayText,
                    displayText,
                    dccAddress: '',
                    fnCount: '',
                    childCount: plural(idxs.length),
                    nodeType: 'group',
                    macroName,
                    rosterIdx: '',
                    folderPath,
                    expanded: true,
                    children: idxs.map(i => locoNode(i, macroName)),
                })
            }
            for (const i of loose) nodes.push(locoNode(i, ''))
            return nodes
        }

        const convert = (nodes: FolderTreeNode[], path: string): TreeNodeData[] => {
            const folders: TreeNodeData[] = []
            const indices: number[] = []
            for (const n of nodes) {
                if (n.kind === 'folder') {
                    folders.push({
                        id: `${FOLDER_PREFIX}${n.path}`,
                        text: n.name,
                        displayText: n.name,
                        dccAddress: '',
                        fnCount: '',
                        childCount: plural(itemIndicesUnder(roster, n.path).length),
                        nodeType: 'folder',
                        macroName: '',
                        rosterIdx: '',
                        folderPath: n.path,
                        expanded: true,
                        children: convert(n.children, n.path),
                    })
                } else {
                    indices.push(n.index)
                }
            }
            return [...folders, ...levelNodes(indices, path)]
        }

        return convert(buildFolderTree(roster, this.state.rosterFolders), '')
    }

    /** Ids of every folder/group node at any depth - all start expanded. */
    private _expandableIds(nodes: TreeNodeData[]): string[] {
        return nodes.flatMap(n => (n.children ? [n.id, ...this._expandableIds(n.children)] : []))
    }

    private _inDrop = false

    private _rebuildTree(): void {
        if (!this.sfTree || this._inDrop) return
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
        const groupIds = this._expandableIds(this._buildTreeData())
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

        if (data.nodeType === 'folder') {
            const icon = document.createElement('span')
            icon.className = 'shrink-0 text-sm'
            icon.textContent = '\u{1F4C1}'

            const nameSpan = document.createElement('span')
            nameSpan.className = 'text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1'
            nameSpan.textContent = data.displayText

            const countSpan = document.createElement('span')
            countSpan.className = 'text-xs text-gray-500 shrink-0'
            countSpan.textContent = data.childCount

            textSpan.appendChild(icon)
            textSpan.appendChild(nameSpan)
            textSpan.appendChild(countSpan)
        } else if (data.nodeType === 'group') {
            const chip = document.createElement('span')
            chip.className = 'text-xs font-mono text-yellow-400 shrink-0'
            chip.textContent = '#define'

            const nameSpan = document.createElement('span')
            nameSpan.className = 'text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1'
            nameSpan.textContent = data.displayText

            const countSpan = document.createElement('span')
            countSpan.className = 'text-xs text-gray-500 shrink-0'
            countSpan.textContent = data.childCount

            textSpan.appendChild(chip)
            textSpan.appendChild(nameSpan)
            textSpan.appendChild(countSpan)
        } else {
            const nameSpan = document.createElement('span')
            nameSpan.className = 'text-sm text-gray-700 dark:text-gray-300 truncate flex-1'
            nameSpan.textContent = data.displayText

            const addrSpan = document.createElement('span')
            addrSpan.className = 'text-xs text-gray-500 font-mono shrink-0'
            addrSpan.textContent = `#${data.dccAddress}`

            const fnBadge = document.createElement('span')
            fnBadge.className = 'px-1 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 shrink-0'
            fnBadge.textContent = data.fnCount

            textSpan.appendChild(nameSpan)
            textSpan.appendChild(addrSpan)
            textSpan.appendChild(fnBadge)

            if (this.state.rosterAddressesNeedingAlias.has(Number(data.dccAddress))) {
                const warningDot = document.createElement('span')
                warningDot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0'
                warningDot.title = 'No alias set (Strict aliases is enabled)'
                warningDot.setAttribute('data-testid', 'alias-warning-dot')
                textSpan.appendChild(warningDot)
            }
        }

    }

    private _currentSelectionNodeId(): string | null {
        if (this.selectedNodeType === 'loco' && this.editBufferIndex !== null) {
            return `loco:${this.editBufferIndex}`
        }
        if (this.selectedNodeType === 'group' && this.selectedMacroName) {
            return groupNodeId(this.selectedMacroName, this.selectedGroupFolder)
        }
        if (this.selectedNodeType === 'folder' && this.selectedFolder !== null) {
            return `${FOLDER_PREFIX}${this.selectedFolder}`
        }
        return null
    }

    private _onNodeSelected(args: NodeSelectEventArgs): void {
        if (this._suppressNodeSelected) return
        const id = (args.nodeData as { id?: string }).id ?? ''
        if (!id) return

        if (id.startsWith(FOLDER_PREFIX)) {
            if (this.editBuffer !== null) this.commitBuffer()
            this.selectedNodeType = 'folder'
            this.selectedFolder = id.slice(FOLDER_PREFIX.length)
            this.selectedMacroName = null
            this.groupFunctions = []
            this.groupFriendlyName = ''
            this.clearBuffer()
        } else if (id.startsWith('group:')) {
            const { macroName, folderPath } = parseGroupNodeId(id)
            this.selectedNodeType = 'group'
            this.selectedMacroName = macroName
            this.selectedGroupFolder = folderPath
            this.selectedFolder = null
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
            this.selectedFolder = null
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
            this.promptRenameGroup(parseGroupNodeId(nodeId).macroName)
        } else if (action === 'new-folder' && nodeId.startsWith(FOLDER_PREFIX)) {
            void this.promptNewFolder(nodeId.slice(FOLDER_PREFIX.length))
        } else if (action === 'rename-folder' && nodeId.startsWith(FOLDER_PREFIX)) {
            void this.promptRenameFolder(nodeId.slice(FOLDER_PREFIX.length))
        } else if (action === 'delete-folder' && nodeId.startsWith(FOLDER_PREFIX)) {
            void this.deleteFolder(nodeId.slice(FOLDER_PREFIX.length))
        }
    }

    // ── Selection state ───────────────────────────────────────────────────────
    selectedNodeType: 'loco' | 'group' | 'folder' | null = null
    selectedMacroName: string | null = null
    /** Folder a selected #define group sits in ('' = top level) - the same macro can appear under several folders. */
    selectedGroupFolder = ''
    /** Path of the folder node selected in the tree (mutually exclusive with a loco/group selection), or null. */
    selectedFolder: string | null = null

    get selectedEntry(): Roster | null {
        if (this.editBufferIndex === null) return null
        return this.state.roster[this.editBufferIndex] ?? null
    }

    // ── Loco edit buffer ──────────────────────────────────────────────────────
    editBuffer: Roster | null = null
    editBufferIndex: number | null = null
    errorMessage = ''
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
        this.aliasInput = this.state.getPrimaryAliasNameForId(entry.dccAddress, 'Roster')
        this.errorMessage = ''
        this.loadAppendedFunctions()
    }

    clearBuffer(): void {
        this.editBuffer = null
        this.editBufferIndex = null
        this.aliasInput = ''
        this.errorMessage = ''
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
        if (this.state.strictAliases && this.aliasInput.trim() === '') {
            this.errorMessage = 'This loco requires an alias when Strict aliases is enabled.'
            return
        }
        const existing = this.state.roster[this.editBufferIndex]
        // Folder placement is owned by state, not the edit buffer, so a drag/move made while the
        // loco is selected isn't undone by a later commit of stale buffer fields.
        const { folder: _existingFolder, ...existingFields } = existing ?? ({} as Roster)
        const changed = !existing || JSON.stringify(existingFields) !== JSON.stringify(this.editBuffer)
        const existingAliasName = existing ? this.state.getPrimaryAliasNameForId(existing.dccAddress, 'Roster') : ''
        const aliasChanged = !!existing && (existing.dccAddress !== this.editBuffer.dccAddress || existingAliasName !== this.aliasInput.trim())
        this.state.updateRosterEntry(this.editBufferIndex, { ...this.editBuffer, ...(existing?.folder ? { folder: existing.folder } : {}) })
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
                return
            }
        }
        this.errorMessage = ''
        // Only rebuild the tree when data actually changed; pure selection switches
        // (no edits) call commitBuffer too but produce no visible change, and
        // triggering a refresh on every click breaks SF's own selection management.
        // aliasChanged is included alongside `changed` because the alias itself lives
        // outside the roster entry object diffed by `changed` — an alias-only edit
        // (e.g. clearing the strict-aliases warning dot) would otherwise never repaint
        // the tree despite being a real, visible change.
        if (changed || aliasChanged) this._rebuildTree()
    }

    // ── DCC address + field blur handlers ────────────────────────────────────
    dccAddressInput = ''

    onDccAddressInput(): void {
        const n = parseInt(this.dccAddressInput, 10)
        if (!isNaN(n) && this.editBuffer) {
            this.editBuffer.dccAddress = n
        }
    }

    onDccAddressBlur(): void { this.commitBuffer() }
    onNameBlur(): void { this.commitBuffer() }
    onCommentBlur(): void { this.commitBuffer() }
    onAliasBlur(): void { this.commitBuffer() }

    /**
     * Marks the Save button dirty as soon as the alias field's live value
     * diverges from what's actually committed — not just on blur. Without
     * this, clicking Save right after typing (without tabbing away first)
     * finds the button still disabled: it's the click itself that would
     * normally flush the buffer via commitBuffer(), but a disabled button
     * never receives the click in the first place.
     */
    onAliasInput(): void {
        if (this.editBuffer === null || this.editBufferIndex === null) return
        const existing = this.state.roster[this.editBufferIndex]
        const existingAliasName = existing ? this.state.getPrimaryAliasNameForId(existing.dccAddress, 'Roster') : ''
        if (this.aliasInput.trim() !== existingAliasName) {
            this.state.hasChanges = true
        }
    }

    // ── Folders (the layer above the #define groups; organizing only) ───────────
    /** Where a new loco / folder goes by default: the selected folder, else beside the selected loco or group. */
    private _defaultFolder(): string {
        if (this.selectedNodeType === 'folder') return this.selectedFolder ?? ''
        if (this.selectedNodeType === 'group') return this.selectedGroupFolder
        if (this.editBufferIndex !== null) return this.state.roster[this.editBufferIndex]?.folder ?? ''
        return ''
    }

    get folderPaths(): string[] {
        return allFolderPaths(this.state.roster, this.state.rosterFolders)
    }

    get selectedFolderName(): string {
        return this.selectedFolder?.split('/').pop() ?? ''
    }

    get selectedFolderCount(): number {
        return this.selectedFolder ? itemIndicesUnder(this.state.roster, this.selectedFolder).length : 0
    }

    /** The folder select in a loco's detail pane (value '' = top level). */
    get locoFolder(): string {
        return this.editBufferIndex !== null ? this.state.roster[this.editBufferIndex]?.folder ?? '' : ''
    }

    onLocoFolderChange(folder: string): void {
        if (this.editBufferIndex === null) return
        this.moveLocoToFolder(this.editBufferIndex, folder)
    }

    moveLocoToFolder(index: number, folder: string): void {
        if (this.editBuffer !== null) this.commitBuffer()
        this.state.moveToFolder('roster', index, folder)
        this._rebuildTree()
    }

    private async _promptName(title: string, label: string, value: string, confirmLabel: string, validate: (v: string) => string): Promise<string | null> {
        const { dialog } = await this.dialogService.open({
            component: () => import('../dialogs/text-input-dialog').then(m => m.TextInputDialog).catch(() => null),
            model: { title, label, value, confirmLabel, validate },
        })
        const result = await dialog.closed
        if (result.status !== 'ok' || !result.value) return null
        return (result.value as TextInputResult).value
    }

    /** Creates a folder inside `parentPath` (default: the selected folder, or beside the selected loco/group). */
    async promptNewFolder(parentPath?: string): Promise<void> {
        const parent = parentPath ?? this._defaultFolder()
        const existing = new Set(this.folderPaths)
        const name = await this._promptName(
            parent ? `New folder in "${parent}"` : 'New folder',
            'Folder name',
            '',
            'Create',
            v => (!isValidFolderName(v) ? 'Enter a name (it can\u2019t contain \u201c/\u201d).' : existing.has(parent ? `${parent}/${v}` : v) ? 'A folder with that name already exists here.' : ''),
        )
        if (name === null) return
        const path = parent ? `${parent}/${name}` : name
        if (this.editBuffer !== null) this.commitBuffer()
        if (!this.state.addFolderTo('roster', path)) return
        this.clearBuffer()
        this.selectedNodeType = 'folder'
        this.selectedFolder = path
        this.selectedMacroName = null
        this._rebuildTree()
    }

    async promptRenameFolder(path: string): Promise<void> {
        const current = path.split('/').pop() ?? path
        const parent = path.split('/').slice(0, -1).join('/')
        const existing = new Set(this.folderPaths)
        const name = await this._promptName(
            'Rename folder',
            'Folder name',
            current,
            'Rename',
            v => (!isValidFolderName(v) ? 'Enter a name (it can\u2019t contain \u201c/\u201d).' : v !== current && existing.has(parent ? `${parent}/${v}` : v) ? 'A folder with that name already exists here.' : ''),
        )
        if (name === null || name === current) return
        const to = parent ? `${parent}/${name}` : name
        if (this.editBuffer !== null) this.commitBuffer()
        if (!this.state.renameFolderIn('roster', path, to)) return
        this._followFolder(path, to)
        this._rebuildTree()
    }

    /** Deletes a folder after confirmation; its locos and subfolders move up one level (nothing else is deleted). */
    async deleteFolder(path: string): Promise<void> {
        const confirmed = await this._confirm(`Delete folder "${path.split('/').pop()}"?`, 'Its locos and subfolders will move up one level \u2014 no locos are deleted.')
        if (!confirmed) return
        if (this.editBuffer !== null) this.commitBuffer()
        this.state.deleteFolderFrom('roster', path)
        const parent = path.split('/').slice(0, -1).join('/')
        this._followFolder(path, parent, true)
        this._rebuildTree()
    }

    /** Keeps the selection pointing at the same thing after folder `from` was renamed to `to` (or deleted, `to` being its parent). */
    private _followFolder(from: string, to: string, deleted = false): void {
        const inside = (p: string | null): boolean => p !== null && (p === from || p.startsWith(`${from}/`))
        const remap = (p: string): string => (p === from && deleted ? to : to + p.slice(from.length)).replace(/^\//, '')
        if (this.selectedNodeType === 'folder' && inside(this.selectedFolder)) {
            if (deleted && this.selectedFolder === from) { this.selectedNodeType = null; this.selectedFolder = null }
            else this.selectedFolder = remap(this.selectedFolder!)
        }
        if (this.selectedNodeType === 'group' && inside(this.selectedGroupFolder)) this.selectedGroupFolder = remap(this.selectedGroupFolder)
    }

    /** The folder a tree node lives in (a folder node is its own container) - the drop target for a dragged loco. */
    private _containerOfNode(id: string): string | null {
        if (id.startsWith(FOLDER_PREFIX)) return id.slice(FOLDER_PREFIX.length)
        if (id.startsWith('group:')) return parseGroupNodeId(id).folderPath
        if (id.startsWith('loco:')) return this.state.roster[parseInt(id.slice('loco:'.length), 10)]?.folder ?? ''
        return null
    }

    /** Removes the drop-target outline set by _onNodeDragging. */
    private _clearDropHighlight(): void {
        this.treeEl?.classList.remove('drop-target-root')
        this.treeEl?.querySelectorAll('li.drop-target').forEach(el => el.classList.remove('drop-target'))
    }

    /** Outlines where a drop would land: the destination folder, or the whole tree for the top level. */
    private _highlightDrop(folderPath: string | null): void {
        this._clearDropHighlight()
        if (folderPath === null) return
        if (folderPath === '') { this.treeEl.classList.add('drop-target-root'); return }
        const li = [...this.treeEl.querySelectorAll<HTMLElement>('li[data-uid]')]
            .find(el => (this.sfTree?.getTreeData(el.dataset.uid ?? '')?.[0] as { id?: string } | undefined)?.id === `${FOLDER_PREFIX}${folderPath}`)
        li?.classList.add('drop-target')
    }

    /** Picks the drag cursor icon and outlines the destination so a valid drop point is obvious (see _onNodeDrop). */
    private _onNodeDragging(args: DragAndDropEventArgs): void {
        if (!this.sfTree) return
        const draggedId = String((args.draggedNodeData as { id?: string }).id ?? '')
        const targetEl = (args.target as Element | null)?.closest('li[data-uid]') as HTMLElement | null
        if (!targetEl) {
            // Blank space inside the tree drops to the top level; outside it nothing happens.
            const inside = !!(args.target as Element | null)?.closest('#roster-treeview')
            this._highlightDrop(inside ? '' : null)
            if (!inside) args.dropIndicator = 'e-no-drop'
            return
        }
        const targetId = (this.sfTree.getTreeData(targetEl.dataset.uid ?? '')?.[0] as { id?: string } | undefined)?.id
        if (!targetId) return
        if (targetId === draggedId) { this._highlightDrop(null); args.dropIndicator = 'e-no-drop'; return }
        if (draggedId.startsWith(FOLDER_PREFIX)) {
            const from = draggedId.slice(FOLDER_PREFIX.length)
            const into = targetId.startsWith(FOLDER_PREFIX) ? targetId.slice(FOLDER_PREFIX.length) : null
            const ok = into !== null && into !== from && !into.startsWith(`${from}/`)
            this._highlightDrop(ok ? into : null)
            args.dropIndicator = ok ? 'e-drop-in' : 'e-no-drop'
            return
        }
        // A loco lands in the folder that contains the target (or the target itself, if a folder).
        this._highlightDrop(this._containerOfNode(targetId))
        args.dropIndicator = targetId.startsWith(FOLDER_PREFIX) ? 'e-drop-in' : 'e-drop-next'
    }

    /** Applies a drag-and-drop: onto a folder nests inside it; onto a loco/group joins that level; onto blank space goes to the top. */
    private _onNodeDrop(args: DragAndDropEventArgs): void {
        if (!this.sfTree) return
        const draggedId = String((args.draggedNodeData as { id?: string }).id ?? '')
        const targetEl = (args.target as Element | null)?.closest('li[data-uid]') as HTMLElement | null
        const targetId = targetEl ? (this.sfTree.getTreeData(targetEl.dataset.uid ?? '')?.[0] as { id?: string } | undefined)?.id ?? null : null
        if (targetId === draggedId) return
        const container = targetId ? this._containerOfNode(targetId) : ''
        if (container === null) return

        if (draggedId.startsWith(FOLDER_PREFIX)) {
            const from = draggedId.slice(FOLDER_PREFIX.length)
            if (targetId && !targetId.startsWith(FOLDER_PREFIX)) {
                this.toastService.show({ title: "Can't Move Here", content: 'A folder can only be moved into another folder or to the top level.', cssClass: 'e-toast-warning' })
                return
            }
            const name = from.split('/').pop()!
            const to = container ? `${container}/${name}` : name
            if (to === from) return
            if (this.editBuffer !== null) this.commitBuffer()
            if (!this.state.renameFolderIn('roster', from, to)) {
                this.toastService.show({ title: "Can't Move Here", content: `A folder named "${name}" already exists there.`, cssClass: 'e-toast-warning' })
                return
            }
            this._followFolder(from, to)
            this._rebuildTree()
            return
        }

        if (draggedId.startsWith('group:')) {
            // A #define group moves as a whole: every loco using that macro in the group's folder.
            const { macroName, folderPath } = parseGroupNodeId(draggedId)
            if (container === folderPath) return
            if (this.editBuffer !== null) this.commitBuffer()
            this.state.roster
                .map((r, i) => (r.functionMacro === macroName && (r.folder ?? '') === folderPath ? i : -1))
                .filter(i => i >= 0)
                .forEach(i => this.state.moveToFolder('roster', i, container))
            if (this.selectedNodeType === 'group' && this.selectedMacroName === macroName && this.selectedGroupFolder === folderPath) {
                this.selectedGroupFolder = container
            }
            this._rebuildTree()
            return
        }

        const index = parseInt(draggedId.slice('loco:'.length), 10)
        if (isNaN(index)) return
        this.moveLocoToFolder(index, container)
    }

    // ── Add / remove loco entries ─────────────────────────────────────────────
    addEntry(): void {
        if (this.editBuffer !== null) this.commitBuffer()
        const maxAddr =
            this.state.roster.length > 0 ? Math.max(...this.state.roster.map(r => r.dccAddress)) + 1 : 1
        const folder = this._defaultFolder()
        const newEntry: Roster = { dccAddress: maxAddr, name: `New Loco ${maxAddr}`, functions: [], comment: '', ...(folder ? { folder } : {}) }
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
            ...(entry.folder ? { folder: entry.folder } : {}),
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
            this.selectedGroupFolder = entry.folder ?? ''
            this.selectedFolder = null
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
        const folderOfLoco = this.editBufferIndex !== null ? this.state.roster[this.editBufferIndex]?.folder ?? '' : ''
        this.commitBuffer()

        this.selectedNodeType = 'group'
        this.selectedMacroName = macroName
        this.selectedGroupFolder = folderOfLoco
        this.selectedFolder = null
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
            this.sfTree.selectedNodes = [groupNodeId(macroName, folderOfLoco)]
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

    async removeGroupFunction(i: number): Promise<void> {
        if (!this.selectedMacroName) return
        if (!(await this._confirmRemoveFunction(this.groupFunctions[i]?.name, i))) return
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

    async removeFunction(index: number): Promise<void> {
        if (!this.editBuffer) return
        if (!(await this._confirmRemoveFunction(this.editBuffer.functions[index]?.name, index))) return
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

    async removeAppendedFunction(index: number): Promise<void> {
        if (!(await this._confirmRemoveFunction(this.appendedFunctionsList[index]?.name, index))) return
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

    /** Confirms removing one function-key row; `name` is the row's label, `index` its F-number. */
    private _confirmRemoveFunction(name: string | undefined, index: number): Promise<boolean> {
        const label = name ? `F${index} (${name})` : `F${index}`
        return this._confirm(`Delete "${label}"?`, 'Are you sure you want to remove this function?')
    }

    private async _confirm(title: string, message: string): Promise<boolean> {
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('../dialogs/confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
                model: { title, message },
            })
            const result = await dialog.closed
            return result.status === 'ok'
        } catch {
            return window.confirm(`${title}\n\n${message}`)
        }
    }
}
