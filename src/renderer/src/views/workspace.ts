import { queueTask, resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { IDialogService } from '@aurelia/dialog'
import { InstallerState } from '../models/installer-state'
import { ToastService } from '../services/toast.service'
import { ConfigEditorState } from '../models/config-editor-state'
import { friendlyName } from '../utils/friendly-names'
import { PreferencesService } from '../services/preferences.service'
import { FileService } from '../services/file.service'
import { GitService } from '../services/git.service'
import { PlatformIoService } from '../services/platformio.service'
import { UsbService } from '../services/usb.service'
import { ConfigService } from '../services/config.service'
import { DeviceWizard } from '../components/device-wizard'
import { DevicePickerDialog } from '../components/dialogs/device-picker-dialog'
import { productDetails, sortVersionsDescending, pickLatestVersion } from '../models/product-details'
import type { SavedConfiguration } from '../models/saved-configuration'
import type { DetectedBoardInfo } from '../../../types/ipc'
import { parseDeviceFromHeader, injectDeviceHeader, hasDeviceHeader, reconcileDevicePort } from '../utils/configHeaderParser'
import { copyProductSourceFiles } from '../utils/product-source-files'
import { mergeDetectedBoards } from '../utils/device-scan'
import { buildFileChangeSet, normalizeForComparison } from '../utils/config-file-diff'
import { Splitter } from '@syncfusion/ej2-layouts'
import { DropDownList } from '@syncfusion/ej2-dropdowns'
import type { FileEditorPanelCustomElement } from '../components/visual-editors/file-editor-panel'
import type { CompileOutputTerminalCustomElement } from '../components/compile-output-terminal'
import { hasErrorMarkers, onMarkersChanged, filesWithErrorMarkers, revalidateAllModels } from '../config/dccex-validators'
import type { IDisposable } from 'monaco-editor'

export class Workspace {
    private readonly router = resolve(Router)
    private readonly dialogService = resolve(IDialogService)
    readonly state = resolve(InstallerState)
    readonly configEditorState = resolve(ConfigEditorState)
    private readonly toastService = resolve(ToastService)
    private readonly preferences = resolve(PreferencesService)
    private readonly files = resolve(FileService)
    private readonly git = resolve(GitService)
    private readonly pio = resolve(PlatformIoService)
    private readonly usb = resolve(UsbService)
    private readonly config = resolve(ConfigService)

    // ── Active config file being edited ─────────────────────────────────────
    activeFileIndex = 0
    filePanel?: FileEditorPanelCustomElement
    accessoriesPanel?: { flushPending(): void }
    compileTerminal?: CompileOutputTerminalCustomElement

    // ── Left-nav section (Throttle vs Configuration vs Accessories) ──────────
    activeSection: 'throttle' | 'config' | 'accessories' = 'config'

    /** Throttle is only reachable while the selected device is live at its port. */
    get showThrottleSection(): boolean {
        return this.deviceConnectionStatus === 'connected'
    }

    /** Throttle needs a live serial connection to send anything — auto-connect on entry if not already connected. */
    async selectThrottleSection(): Promise<void> {
        if (!this.portConnected) {
            const ok = await this.connect()
            if (!ok) return
        }
        this.activeSection = 'throttle'
    }

    // ── Device Settings tree (General + WiFi / Accessories / Startup) ────────
    deviceSettingsExpanded = true

    toggleDeviceSettings(): void {
        this.deviceSettingsExpanded = !this.deviceSettingsExpanded
    }

    get generalWifiFileIndex(): number {
        return this.state.configFiles.findIndex(f => f.name === 'config.h' || f.name === 'myConfig.h')
    }

    get startupFileIndex(): number {
        return this.state.configFiles.findIndex(f => f.name === 'myStartup.h')
    }

    get automationFileIndex(): number {
        return this.state.configFiles.findIndex(f => f.name === 'myAutomation.h')
    }

    get generalWifiHasError(): boolean {
        return this.fileHasError('config.h') || this.fileHasError('myConfig.h')
    }

    get startupHasError(): boolean {
        return this.fileHasError('myStartup.h')
    }

    /** Accessories is a slice of myAutomation.h (the HAL Devices block) — same underlying model. */
    get accessoriesHasError(): boolean {
        return this.fileHasError('myAutomation.h')
    }

    get automationHasError(): boolean {
        return this.fileHasError('myAutomation.h')
    }

    selectGeneralWifi(): void {
        const idx = this.generalWifiFileIndex
        if (idx !== -1) this.setActiveFile(idx)
    }

    selectAccessoriesSection(): void {
        this.activeFile && this.syncContent()
        this.activeSection = 'accessories'
    }

    selectStartup(): void {
        this.configEditorState.ensureStartupFileExists()
        const idx = this.startupFileIndex
        if (idx !== -1) this.setActiveFile(idx)
    }

    /** "Advanced" — myAutomation.h. Not labeled "Automation": that name collides
     *  with EXRAIL's own AUTOMATION() blocks (a different, user-visible concept). */
    selectAdvanced(): void {
        const idx = this.automationFileIndex
        if (idx !== -1) this.setActiveFile(idx)
    }

    /** Cross-file navigation, e.g. the Startup row's "Edit in Turnouts" link. */
    private navigateFileHandler = (e: Event): void => {
        const filename = (e as CustomEvent<{ filename: string }>).detail?.filename
        if (!filename) return
        const idx = this.state.configFiles.findIndex(f => f.name === filename)
        if (idx !== -1) this.setActiveFile(idx)
    }

    readonly friendlyName = friendlyName

    isMock = false

    // ── New custom file input ──────────────────────────────────────────────
    showNewFileInput = false
    newFileName = ''
    newFileError = ''

    // ── Compile / upload state ───────────────────────────────────────────────
    isCompiling = false
    compileLog = ''
    compileSuccess: boolean | null = null
    compileError: string | null = null
    progressPercent = 0

    // ── Firmware version (git tag) selection — applied on next Compile ───────
    versions: string[] = []
    versionBusy = false
    versionError: string | null = null
    versionEl!: HTMLInputElement
    private sfVersion?: DropDownList

    // ── Menu ─────────────────────────────────────────────────────────────────
    showDeviceMenu = false
    savedConfigs: SavedConfiguration[] = []

    // ── Device monitor — a view only; it neither opens nor closes the port ────
    showMonitor = false
    /** Persisted app-wide preference (not per-device) — whether checkDeviceConnection() is allowed to auto-connect once the device is detected. Loaded in binding(), toggled from the Settings dialog. */
    autoConnectMonitor = true
    /** Persisted app-wide preference — whether a fresh auto-connect also opens the Monitor (see checkDeviceConnection()). Loaded in binding(), toggled from the Settings dialog. */
    showMonitorOnConnect = true

    /** Persisted app-wide preference — whether compile()/upload() pass -v to PlatformIO. Loaded in binding(), toggled from the Settings dialog. */
    verboseCompile = false
    /** Persisted app-wide preference — whether loadVersions() always overrides the version selection with the latest Prod release. Loaded in binding(), toggled from the Settings dialog. */
    useLatestProdVersion = true
    /** Persisted app-wide preference — when on, canCompile also requires no Monaco error markers across any config file. Loaded in binding(), toggled from the Settings dialog. */
    strictCompile = false
    /** Persisted app-wide preference (default on) — mirrored onto configEditorState.strictAliases, which the turnout/roster/sensor/route/sequence editors actually consult. Loaded in binding(), toggled from the Settings dialog. */
    strictAliases = true
    /** Live mirror of hasErrorMarkers(), kept current via onMarkersChanged() (see binding()/detaching()) — only consulted when strictCompile is on. */
    hasBlockingErrors = false
    /** Live mirror of filesWithErrorMarkers(), kept current via onMarkersChanged() — drives the error dot in the file list, independent of strictCompile. */
    filesWithErrors: Set<string> = new Set()
    private _unsubMarkersChanged: IDisposable | null = null

    // ── Serial connection — the actual open/closed state of the port ─────────
    /** True once connect() has successfully opened the selected device's port. The single source of truth for whether anything (Throttle, Monitor) can currently talk to the device — Monitor visibility is a separate, unrelated concern. */
    portConnected = false
    private _unsubUsbClosed: (() => void) | null = null

    /**
     * Opens the selected device's port. `openMonitor` additionally shows the
     * Monitor panel once connected — used by the auto-connect path (see
     * checkDeviceConnection()) to preserve today's "device appears, Monitor
     * pops open" behavior; a future preference could make that its own
     * separate toggle, but for now it's just a parameter here. Manual
     * connects (the toolbar button, Throttle auto-connect) don't pass it, so
     * they only ever establish the connection.
     */
    async connect(options?: { openMonitor?: boolean }): Promise<boolean> {
        const port = this.state.selectedDevice?.port
        if (!port) return false
        if (this.portConnected) return true
        try {
            await this.usb.openPort(port, 115200)
            this.portConnected = true
        } catch (err) {
            const msg = (err as Error).message
            // Port already open from a previous session (e.g. after upload) — attach anyway.
            if (/already open/i.test(msg)) {
                this.portConnected = true
            } else {
                this.toastService.show({ title: 'Connect Failed', content: msg, cssClass: 'e-toast-danger' })
                return false
            }
        }
        if (options?.openMonitor && !this.showMonitor) {
            this.activeBottomTab = 'monitor'
            this.showMonitor = true
            this.openBottomPanel()
        }
        return true
    }

    async disconnect(): Promise<void> {
        const port = this.state.selectedDevice?.port
        if (port) {
            try {
                if (await this.usb.isPortOpen(port)) await this.usb.closePort(port)
            } catch {
                // Best-effort — nothing meaningful to recover from here.
            }
        }
        this.portConnected = false
    }

    async toggleConnect(): Promise<void> {
        if (this.portConnected) await this.disconnect()
        else await this.connect()
    }

    // ── Live device connection status (port badge) ────────────────────────────
    /** Whether the selected device currently answers at its recorded port — drives the port badge and gates the Throttle nav item. Independent of portConnected (that's whether *we've* opened it; this is whether it's physically there to open). */
    deviceConnectionStatus: 'checking' | 'connected' | 'disconnected' | 'unknown' = 'unknown'
    private _connectionCheckTimer: ReturnType<typeof setTimeout> | null = null
    private _unsubUsbAttached: (() => void) | null = null
    private _unsubUsbDetached: (() => void) | null = null

    // ── Bottom panel / splitter ──────────────────────────────────────────────
    private splitterObj: Splitter | null = null
    activeBottomTab: 'output' | 'monitor' = 'output'

    toggleMonitor(): void {
        const next = !this.showMonitor
        if (next) {
            // Set activeBottomTab before showMonitor mounts the content div, so
            // the div's hidden-class binding evaluates correctly on its first
            // bind instead of momentarily reflecting the previous tab.
            this.activeBottomTab = 'monitor'
            this.showMonitor = next
            this.openBottomPanel()
        } else {
            this.showMonitor = next
            if (this.activeBottomTab === 'monitor') this.activeBottomTab = 'output'
        }
    }

    setBottomTab(tab: 'output' | 'monitor'): void {
        this.activeBottomTab = tab
    }

    private openBottomPanel(): void {
        this.splitterObj?.expand(1)
    }

    closeBottomPanel(): void {
        this.splitterObj?.collapse(1)
        // Keep showMonitor in sync with the panel's actual visibility — otherwise
        // it stays true after closing via this button, and the next click on the
        // Monitor toggle just flips it back to false (a no-op, since the panel is
        // already collapsed) instead of reopening it.
        this.showMonitor = false
    }

    async binding(): Promise<void> {
        // Seed the version dropdown's dataSource with whatever is already
        // selected *before* anything renders, so the SF DropDownList has a
        // sensible initial value/option instead of an empty list while
        // loadVersions()'s async fetch is still in flight.
        this.seedVersionsFromSelected()
        await this.config.ready
        this.isMock = this.config.isMock
        if (!this.state.selectedDevice) {
            await this.router.load('home')
            return
        }
        await this.loadSavedConfigs()
        await this.refreshConfigFilesFromDisk()
        this.configEditorState.loadFromInstallerState()
        if (this.state.pendingMigrationOnLoad) {
            this.configEditorState.hasChanges = true
            this.state.pendingMigrationOnLoad = false
        }
        this.autoConnectMonitor = (await this.preferences.get<boolean>('autoConnectMonitor')) ?? true
        this.showMonitorOnConnect = (await this.preferences.get<boolean>('showMonitorOnConnect')) ?? true
        this.verboseCompile = (await this.preferences.get<boolean>('verboseCompile')) ?? false
        this.useLatestProdVersion = (await this.preferences.get<boolean>('useLatestProdVersion')) ?? true
        this.strictCompile = (await this.preferences.get<boolean>('strictCompile')) ?? false
        this.strictAliases = (await this.preferences.get<boolean>('strictAliases')) ?? true
        this.configEditorState.strictAliases = this.strictAliases
        this.hasBlockingErrors = hasErrorMarkers()
        this.filesWithErrors = filesWithErrorMarkers()
        this._unsubMarkersChanged = onMarkersChanged(() => {
            this.hasBlockingErrors = hasErrorMarkers()
            this.filesWithErrors = filesWithErrorMarkers()
        })
        // Fire-and-forget: a git call that can be slow (or fail entirely
        // offline) and must never block the rest of the view from rendering.
        // Started after the preferences above are loaded so it reads a
        // settled useLatestProdVersion rather than racing its default.
        void this.loadVersions()
        // Fire-and-forget: re-scans serial ports/boards to confirm the
        // selected device is actually plugged in, updating the port badge
        // and (on a fresh connect, if autoConnectMonitor is on) auto-opening
        // the Monitor.
        void this.checkDeviceConnection()
    }

    /** Persists the auto-connect preference — called from the Settings dialog. */
    setAutoConnectMonitor(enabled: boolean): void {
        this.autoConnectMonitor = enabled
        void this.preferences.set('autoConnectMonitor', enabled)
    }

    /** Persists the show-Monitor-on-connect preference — called from the Settings dialog. */
    setShowMonitorOnConnect(enabled: boolean): void {
        this.showMonitorOnConnect = enabled
        void this.preferences.set('showMonitorOnConnect', enabled)
    }

    /** Persists the verbose-compile preference — called from the Settings dialog. */
    setVerboseCompile(enabled: boolean): void {
        this.verboseCompile = enabled
        void this.preferences.set('verboseCompile', enabled)
    }

    /** Persists the use-latest-Prod-version preference — called from the Settings dialog. */
    setUseLatestProdVersion(enabled: boolean): void {
        this.useLatestProdVersion = enabled
        void this.preferences.set('useLatestProdVersion', enabled)
    }

    /** Persists the strict-compile preference — called from the Settings dialog. */
    setStrictCompile(enabled: boolean): void {
        this.strictCompile = enabled
        void this.preferences.set('strictCompile', enabled)
    }

    /** Persists the strict-aliases preference and mirrors it onto configEditorState, which the turnout/roster/sensor/route/sequence editors actually consult — called from the Settings dialog. Also re-runs Monaco validation on every open model, since validateAliasRequired() depends on this setting but has no text change of its own to react to. */
    setStrictAliases(enabled: boolean): void {
        this.strictAliases = enabled
        this.configEditorState.strictAliases = enabled
        void this.preferences.set('strictAliases', enabled)
        revalidateAllModels()
    }

    /** Opens the app-wide Settings dialog. Each toggle applies (and persists) immediately via its callback — there is nothing to "save" on close. */
    openSettings(): void {
        void this.dialogService.open({
            component: () => import('../components/dialogs/settings-dialog').then(m => m.SettingsDialog).catch(() => null),
            model: {
                autoConnect: this.autoConnectMonitor,
                showMonitorOnConnect: this.showMonitorOnConnect,
                verboseCompile: this.verboseCompile,
                useLatestProdVersion: this.useLatestProdVersion,
                strictCompile: this.strictCompile,
                strictAliases: this.strictAliases,
                onAutoConnectChange: (v: boolean) => this.setAutoConnectMonitor(v),
                onShowMonitorOnConnectChange: (v: boolean) => this.setShowMonitorOnConnect(v),
                onVerboseCompileChange: (v: boolean) => this.setVerboseCompile(v),
                onUseLatestProdVersionChange: (v: boolean) => this.setUseLatestProdVersion(v),
                onStrictCompileChange: (v: boolean) => this.setStrictCompile(v),
                onStrictAliasesChange: (v: boolean) => this.setStrictAliases(v),
            },
        })
    }

    /**
     * Re-scans connected serial ports/boards and checks whether the currently
     * selected device is actually live at its recorded port — the same
     * mergeDetectedBoards() lookup rescanPort()/ensureLivePort() already use,
     * just read-only here (never corrects the stored port itself).
     *
     * On a transition into 'connected' — not on every repeat check while
     * already connected — connect() is called if autoConnectMonitor (a
     * persisted app preference, not per-device) is on, passing openMonitor
     * per the separate showMonitorOnConnect preference. Gating on the
     * transition (rather than "is live") means a user who's manually
     * disconnected won't be auto-reconnected on an unrelated hotplug event
     * while the device was already live. A transition OUT of live drops
     * portConnected — the underlying port is gone either way, so there's
     * nothing left for us to hold open.
     */
    async checkDeviceConnection(): Promise<void> {
        const device = this.state.selectedDevice
        if (!device?.port) {
            this.deviceConnectionStatus = 'disconnected'
            return
        }
        const wasConnected = this.deviceConnectionStatus === 'connected'
        this.deviceConnectionStatus = 'checking'
        try {
            await this.usb.initialize()
            await this.usb.refresh()
            let cliBoards: DetectedBoardInfo[] = []
            try {
                cliBoards = await this.pio.listBoards()
            } catch { /* fall back silently to the raw serial-port list */ }
            const connected = mergeDetectedBoards(this.usb.serialPorts, cliBoards)
            const isLive = connected.some((b) => b.port === device.port)
            this.deviceConnectionStatus = isLive ? 'connected' : 'disconnected'
            if (isLive && !wasConnected && this.autoConnectMonitor) {
                await this.connect({ openMonitor: this.showMonitorOnConnect })
            } else if (!isLive && this.portConnected) {
                this.portConnected = false
            }
        } catch {
            this.deviceConnectionStatus = 'disconnected'
        }
    }

    /** Debounces bursts of USB attach/detach events (e.g. a hub enumerating several devices at once) into a single re-check. */
    private _scheduleConnectionCheck(): void {
        if (this._connectionCheckTimer) clearTimeout(this._connectionCheckTimer)
        this._connectionCheckTimer = setTimeout(() => {
            this._connectionCheckTimer = null
            void this.checkDeviceConnection()
        }, 400)
    }

    private seedVersionsFromSelected(): void {
        this.versions = this.state.selectedVersion ? [this.state.selectedVersion] : []
    }

    /** Load available firmware version tags for the active device's repo. The latest Prod release is selected unless useLatestProdVersion is off and a version is already selected. */
    async loadVersions(): Promise<void> {
        const repoPath = this.state.repoPath
        if (!repoPath) {
            this.versions = []
            return
        }
        this.versionBusy = true
        this.versionError = null
        try {
            // Pull first so newly-tagged releases show up — listTags() only
            // reads whatever is already local, and this repo is otherwise
            // only refreshed from the "Add Device" wizard. Non-fatal: fall
            // back to whatever tags are already local if offline.
            try {
                await this.git.pull(repoPath)
            } catch {
                // ignore — proceed with local tags
            }
            const tags = await this.git.listTags(repoPath)
            this.versions = sortVersionsDescending(tags)
            // Nothing selected yet still needs a sane default even with the
            // preference off — it only preserves an *existing* selection.
            if (this.useLatestProdVersion || !this.state.selectedVersion) {
                const latest = pickLatestVersion(this.versions)
                if (latest) this.state.selectedVersion = latest
            }
            if (this.state.selectedVersion && !this.versions.includes(this.state.selectedVersion)) {
                // Couldn't fetch anything (e.g. offline), or the preference is
                // off and the selected version isn't tagged locally — keep it
                // selectable rather than silently dropping it.
                this.versions = [this.state.selectedVersion, ...this.versions]
            }
        } catch (err) {
            this.versionError = (err as Error).message
        } finally {
            this.versionBusy = false
            this.refreshSfVersion()
        }
    }

    /** Sync the SF DropDownList's dataSource/value from `versions`/`state.selectedVersion`. */
    private refreshSfVersion(): void {
        if (!this.sfVersion) return
        this.sfVersion.dataSource = this.versions
        if (this.state.selectedVersion && this.sfVersion.value !== this.state.selectedVersion) {
            this.sfVersion.value = this.state.selectedVersion
        }
        this.sfVersion.refresh()
    }

    attached(): void {
        queueTask(() => {
            this.splitterObj = new Splitter({
                orientation: 'Vertical',
                width: '100%',
                height: '100%',
                paneSettings: [
                    { size: '65%', min: '100px' },
                    { size: '35%', min: '60px', collapsed: true },
                ],
            })
            this.splitterObj.appendTo('#workspace-splitter')
        })

        this.sfVersion = new DropDownList({
            dataSource: this.versions,
            value: this.state.selectedVersion,
            change: (args) => {
                // Just records the selection — the actual git checkout and
                // firmware source refresh happen lazily on the next Compile
                // (see refreshCheckedOutVersion()).
                this.state.selectedVersion = args.value as string
            },
        })
        this.sfVersion.appendTo(this.versionEl)

        // Re-check whenever a USB device is plugged/unplugged — covers both
        // the selected board coming online after the workspace already loaded,
        // and it going away mid-session. Debounced since a hub can fire several
        // attach events back-to-back.
        this._unsubUsbAttached = window.usb?.onAttached(() => this._scheduleConnectionCheck()) ?? null
        this._unsubUsbDetached = window.usb?.onDetached(() => this._scheduleConnectionCheck()) ?? null

        // portConnected can go stale from outside connect()/disconnect() —
        // an unplug, a driver error, anything that makes the underlying
        // serialport instance close itself — so mirror the raw event rather
        // than relying solely on our own open/close calls.
        this._unsubUsbClosed = window.usb?.onClosed(({ path }) => {
            if (path === this.state.selectedDevice?.port) this.portConnected = false
        }) ?? null

        try {
            window.addEventListener('exinst:navigate-file', this.navigateFileHandler as EventListener)
        } catch {
            // noop in non-browser contexts
        }
    }

    detaching(): void {
        try {
            window.removeEventListener('exinst:navigate-file', this.navigateFileHandler as EventListener)
        } catch {
            // noop
        }
        this.splitterObj?.destroy()
        this.splitterObj = null
        this.sfVersion?.destroy()
        this.sfVersion = undefined
        if (this._connectionCheckTimer) {
            clearTimeout(this._connectionCheckTimer)
            this._connectionCheckTimer = null
        }
        this._unsubUsbAttached?.()
        this._unsubUsbDetached?.()
        this._unsubUsbClosed?.()
        this._unsubUsbAttached = null
        this._unsubUsbDetached = null
        this._unsubUsbClosed = null
        this._unsubMarkersChanged?.dispose()
        this._unsubMarkersChanged = null
        // Don't leak an open port once the workspace itself goes away (e.g.
        // navigating Home) — Monitor no longer owns this, so nothing else will.
        if (this.portConnected) void this.disconnect()
    }

    /**
     * Re-reads each config file from disk to keep editor state aligned with
     * on-disk truth. For Load-from-Folder flows, prefer sourceFolder reads.
     *
     * After reading config.h from disk, if the device header block is absent,
     * inject it (using the device stored in InstallerState) and persist it back
     * to disk immediately so subsequent reads see the complete header.
     */
    private async refreshConfigFilesFromDisk(): Promise<void> {
        const roots = [
            ...(this.state.sourceFolder ? [this.state.sourceFolder] : []),
            ...(this.state.scratchPath ? [this.state.scratchPath] : []),
        ]
        if (roots.length === 0) return

        let changed = false

        for (const f of this.state.configFiles) {
            let diskContent: string | null = null
            let diskPath: string | null = null

            for (const root of roots) {
                const candidate = `${root}/${f.name}`
                const diskExists = await this.files.exists(candidate)
                if (!diskExists) continue
                try {
                    diskContent = await this.files.readFile(candidate)
                    diskPath = candidate
                    break
                } catch {
                    // Continue fallback search across candidate roots.
                }
            }

            if (diskContent !== null && diskContent !== f.content) {
                f.content = diskContent
                changed = true
            }

            // Ensure config.h on disk always has the device header block. If it
            // was missing (e.g. the user's file predates DCC-Rail-Commander or was
            // edited externally), inject it now and persist back to every root so
            // all copies stay in sync.
            if (f.name === 'config.h' && diskPath && !hasDeviceHeader(f.content)) {
                const device = this.state.selectedDevice
                if (device && device.fqbn) {
                    f.content = injectDeviceHeader(f.content, device)
                    changed = true
                    // Write back to every root that has this file
                    for (const root of roots) {
                        try {
                            const candidate = `${root}/${f.name}`
                            if (await this.files.exists(candidate)) {
                                await this.files.writeFile(candidate, f.content)
                            }
                        } catch {
                            // Non-fatal — header will be written on next Save
                        }
                    }
                    console.debug('[workspace] injected missing device header into config.h on disk')
                }
            }
        }

        if (changed) await this.updateSavedConfig()
    }

    private async loadSavedConfigs(): Promise<void> {
        try {
            const saved = await this.preferences.get('savedConfigurations') as SavedConfiguration[] | undefined
            this.savedConfigs = Array.isArray(saved) ? saved : this.state.savedConfigurations
        } catch {
            this.savedConfigs = this.state.savedConfigurations
        }
    }

    // ── Config file editing ───────────────────────────────────────────────────
    get activeFile(): { name: string; content: string } | null {
        return this.state.configFiles[this.activeFileIndex] ?? null
    }

    setActiveFile(index: number): void {
        this.activeFile && this.syncContent()
        this.activeFileIndex = index
        this.activeSection = 'config'
    }

    syncContent(): void {
        // content is already two-way bound via textarea; nothing extra needed
    }

    // ── Custom file management ────────────────────────────────────────────────
    startNewFile(): void {
        this.newFileName = ''
        this.newFileError = ''
        this.showNewFileInput = true
    }

    cancelNewFile(): void {
        this.showNewFileInput = false
        this.newFileName = ''
        this.newFileError = ''
    }

    confirmNewFile(): void {
        let name = this.newFileName.trim()
        if (!name) {
            this.newFileError = 'Name is required.'
            return
        }
        // Auto-append .h if no extension
        if (!name.includes('.')) name = name + '.h'
        const reserved = [
            'config.h',
            'myRoster.h',
            'myTurnouts.h',
            'mySignals.h',
            'mySensors.h',
            'myRoutes.h',
            'mySequences.h',
            'myEvents.h',
            'myAliases.h',
            'myAutomation.h',
            'myStartup.h',
        ]
        if (reserved.includes(name)) {
            this.newFileError = `"${name}" is a reserved file name.`
            return
        }
        if (this.state.configFiles.some(f => f.name === name)) {
            this.newFileError = `"${name}" already exists.`
            return
        }
        this.configEditorState.addCustomFile(name)
        // Select the newly created file
        const newIndex = this.state.configFiles.findIndex(f => f.name === name)
        if (newIndex !== -1) this.activeFileIndex = newIndex
        this.cancelNewFile()
    }

    handleNewFileKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') this.confirmNewFile()
        if (event.key === 'Escape') this.cancelNewFile()
    }

    async removeCustomFile(index: number, event: Event): Promise<void> {
        event.stopPropagation()
        const file = this.state.configFiles[index]
        if (!file || !this.configEditorState.isCustomFile(file.name)) return
        const confirmed = await this._confirm(
            'Delete File',
            `Are you sure you want to delete "${file.name}"? This cannot be undone.`,
        )
        if (!confirmed) return
        const deletes: Promise<void>[] = []
        if (this.state.scratchPath) {
            deletes.push(this.files.deleteFiles(`${this.state.scratchPath}/${file.name}`))
        }
        if (this.state.sourceFolder) {
            deletes.push(this.files.deleteFiles(`${this.state.sourceFolder}/${file.name}`))
        }
        await Promise.all(deletes)
        this.configEditorState.removeCustomFile(file.name)
        // Keep active index in bounds
        if (this.activeFileIndex >= this.state.configFiles.length) {
            this.activeFileIndex = Math.max(0, this.state.configFiles.length - 1)
        }
        // Persist the deletion immediately so it survives a refresh
        void this.updateSavedConfig()
    }

    private async _confirm(title: string, message: string): Promise<boolean> {
        try {
            const { dialog } = await this.dialogService.open({
                component: () =>
                    import('../components/dialogs/confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
                model: { title, message },
            })
            const result = await dialog.closed
            return result.status === 'ok'
        } catch {
            return window.confirm(`${title}\n\n${message}`)
        }
    }

    /**
     * Writes a file only if its on-disk content actually differs from what
     * we're about to write (ignoring dynamic timestamp lines) — skips the
     * write for files nothing changed in. This matters both for save latency
     * (fewer IPC round-trips on a slower or antivirus-contended disk) and for
     * PlatformIO's incremental build: rewriting a file with identical content
     * still bumps its mtime, which needlessly invalidates that file's
     * compilation cache entry on the next build.
     */
    private async writeIfChanged(path: string, content: string): Promise<void> {
        const existing = (await this.files.exists(path)) ? await this.files.readFile(path) : null
        if (existing !== null && normalizeForComparison(existing) === normalizeForComparison(content)) {
            return
        }
        await this.files.writeFile(path, content)
    }

    async saveFiles(): Promise<void> {
        await this.flushPendingFormEdits()
        // Ensure latest parsed state (roster headers, turnout headers) is written
        // back into configFiles before we write to disk.
        this.configEditorState.syncAll()
        // Every file write is independent, so run them concurrently rather than
        // one sequential IPC round-trip at a time — on a slower or antivirus-
        // contended disk the serial version could take long enough that the
        // dirty indicator visibly lagged behind the save actually completing.
        const writes: Promise<void>[] = []
        for (const f of this.state.configFiles) {
            if (this.state.scratchPath) {
                writes.push(this.writeIfChanged(`${this.state.scratchPath}/${f.name}`, f.content))
            }
            // When loaded from a folder that lacks a .ino, the internal scratch path
            // is used for compilation but we must also write back to the user's
            // original folder so their changes are persisted there.
            if (this.state.sourceFolder) {
                writes.push(this.writeIfChanged(`${this.state.sourceFolder}/${f.name}`, f.content))
            }
        }
        await Promise.all(writes)
        this.configEditorState.clearChanges()
        await this.updateSavedConfig()
    }

    /**
     * Opens a diff of every config file that will change on the next Save —
     * on-disk "before" vs. in-memory "after" content — with a Save action of
     * its own. This is the toolbar Save button's click handler, so it can be
     * invoked with nothing actually pending; syncAll() unconditionally sets
     * hasChanges = true as a side effect (it's normally called right before
     * a real save), which must not stick if the user just opens and closes
     * the dialog without saving — otherwise the Save button's dirty
     * indicator would light up on its own.
     */
    async openChangesDialog(): Promise<void> {
        await this.flushPendingFormEdits()
        const hadChanges = this.configEditorState.hasChanges
        this.configEditorState.syncAll()
        if (!hadChanges) this.configEditorState.hasChanges = false

        const roots = [
            ...(this.state.sourceFolder ? [this.state.sourceFolder] : []),
            ...(this.state.scratchPath ? [this.state.scratchPath] : []),
        ]
        const files = await buildFileChangeSet(
            this.state.configFiles,
            roots,
            (p) => this.files.readFile(p),
            (p) => this.files.exists(p),
        )

        void this.dialogService.open({
            component: () =>
                import('../components/dialogs/file-changes-dialog').then((m) => m.FileChangesDialog).catch(() => null),
            model: { files, onSave: () => this.saveFiles() },
        })
    }

    private async updateSavedConfig(): Promise<void> {
        const id = this.state.activeConfigId
        if (!id) return
        const idx = this.state.savedConfigurations.findIndex((c) => c.id === id)
        if (idx === -1) return
        const device = this.state.selectedDevice
        this.state.savedConfigurations[idx] = {
            ...this.state.savedConfigurations[idx],
            // Keep the saved copy's device identity in sync with the live one —
            // switchToConfig() rebuilds state.selectedDevice straight from these
            // fields, so without this, rescanning/reconciling a port only "took"
            // for the rest of the current session: the next time this config was
            // switched to (menu, or app restart re-loading the active config),
            // devicePort would revert to whatever was saved when the config was
            // first created, even though config.h on disk already had the new port.
            ...(device
                ? {
                    deviceName: device.name,
                    devicePort: device.port,
                    deviceFqbn: device.fqbn,
                    deviceSerialNumber: device.serialNumber,
                }
                : {}),
            configFiles: this.state.configFiles.map((f) => ({ ...f })),
            lastModified: new Date().toISOString(),
        }
        await this.preferences.set('savedConfigurations', this.state.savedConfigurations)
    }

    /**
     * If the user picked a different firmware version (Device Settings'
     * version dropdown) than what's currently checked out, check it out in
     * repoPath and refresh the firmware source files in scratchPath before
     * compiling. User config files (config.h, myAutomation.h, etc.) are never
     * touched — see copyProductSourceFiles().
     */
    private async refreshCheckedOutVersion(): Promise<void> {
        const { selectedProduct, selectedVersion, repoPath, scratchPath, activeConfigId } = this.state
        if (!selectedProduct || !selectedVersion || !repoPath || !scratchPath) return

        const savedConfig = this.state.savedConfigurations.find((c) => c.id === activeConfigId)
        // Nothing to reconcile if we don't know what's currently checked out,
        // or it already matches the selected version.
        if (!savedConfig || savedConfig.version === selectedVersion) return

        const product = productDetails[selectedProduct]
        if (!product) return
        if (!(await this.files.exists(`${repoPath}/.git`))) return

        const checkout = await this.git.checkout(repoPath, selectedVersion)
        if (!checkout.success) {
            throw new Error(checkout.error ?? `Failed to check out ${selectedVersion}`)
        }

        await copyProductSourceFiles(this.files, product, repoPath, scratchPath)

        savedConfig.version = selectedVersion
        await this.preferences.set('savedConfigurations', this.state.savedConfigurations)
    }

    // ── Compile & Upload ──────────────────────────────────────────────────────
    clearCompileLog(): void {
        this.compileLog = ''
        this.compileTerminal?.reset()
        this.compileSuccess = null
        this.compileError = null
    }

    /** Copies the full Output panel log (ANSI stripped) to the OS clipboard. */
    async copyCompileLog(): Promise<void> {
        await this.compileTerminal?.flush()
        const text = this.compileTerminal?.getText() ?? ''
        try {
            await navigator.clipboard.writeText(text)
            this.toastService.show({
                title: 'Copied',
                content: 'Output copied to clipboard.',
                cssClass: 'e-toast-success',
            })
        } catch (err) {
            this.toastService.show({
                title: 'Copy Failed',
                content: (err as Error).message,
                cssClass: 'e-toast-danger',
            })
        }
    }

    /** Prompts for a save location and writes the full Output panel log to disk. */
    async saveCompileLog(): Promise<void> {
        await this.compileTerminal?.flush()
        const text = this.compileTerminal?.getText() ?? ''
        const path = await this.files.selectSavePath('compile-output.txt')
        if (!path) return
        try {
            await this.files.writeFile(path, text)
            this.toastService.show({
                title: 'Saved',
                content: `Output saved to ${path}.`,
                cssClass: 'e-toast-success',
            })
        } catch (err) {
            this.toastService.show({
                title: 'Save Failed',
                content: (err as Error).message,
                cssClass: 'e-toast-danger',
            })
        }
    }

    private async flushPendingFormEdits(): Promise<void> {
        const active = globalThis.document?.activeElement as HTMLElement | null | undefined
        if (active && typeof active.blur === 'function') {
            active.blur()
            // Allow framework blur/change handlers to run before saving files.
            await Promise.resolve()
            await new Promise<void>(resolve => setTimeout(resolve, 0))
        }
        // Monaco's raw editors (myAutomation.h, myStartup.h, Accessories, generic
        // custom files) debounce content → binding updates by 300ms and don't
        // respond to blur, so a Save right after typing can otherwise be
        // overwritten with stale pre-edit content.
        this.filePanel?.flushPending()
        this.accessoriesPanel?.flushPending()
    }

    async compile(): Promise<void> {
        const device = this.state.selectedDevice
        if (!device || !this.state.scratchPath) return

        this.isCompiling = true
        this.compileLog = ''
        this.compileTerminal?.reset()
        this.compileError = null
        this.compileSuccess = null
        this.progressPercent = 10
        this.activeBottomTab = 'output'
        this.openBottomPanel()

        try {
            await this.refreshCheckedOutVersion()
            await this.saveFiles()
            this.progressPercent = 20

            // Validate FQBN and attempt recovery from header or live scan when
            // the stored value is missing or looks invalid. This prevents
            // accidental comment lines (e.g. "//   Protocol: serial") from
            // being passed to the Arduino CLI.
            const looksLikeFqbn = (s?: string) => !!s && s.includes(':') && !s.trim().startsWith('//')

            let fqbn = device.fqbn
            console.debug('[workspace.compile] scratchPath=', this.state.scratchPath, 'device.fqbn=', fqbn, 'device=', device)

            if (!looksLikeFqbn(fqbn)) {
                // Try to recover from the injected header in config.h, then fall back
                // to inferring the target from MOTOR_SHIELD_TYPE.
                try {
                    if (this.state.scratchPath) {
                        const headerText = await this.files.readFile(`${this.state.scratchPath}/config.h`)
                        const parsed = parseDeviceFromHeader(headerText)
                        if (parsed && looksLikeFqbn(parsed.fqbn)) {
                            fqbn = parsed.fqbn
                            device.fqbn = fqbn
                            console.debug('[workspace.compile] recovered fqbn from config.h header:', fqbn)
                        }
                        // Also infer from MOTOR_SHIELD_TYPE when no device header is present
                        if (!looksLikeFqbn(fqbn)) {
                            const motorMatch = /^#define\s+MOTOR_SHIELD_TYPE\s+(\S+)/m.exec(headerText)
                            const motorDriver = motorMatch?.[1]?.toUpperCase() ?? ''
                            if (motorDriver.startsWith('EXCSB1')) {
                                fqbn = 'esp32:esp32:esp32'
                                device.fqbn = fqbn
                                if (!device.name || device.name === 'Unknown') device.name = 'EX-CSB1'
                                console.debug('[workspace.compile] recovered fqbn from MOTOR_SHIELD_TYPE:', motorDriver, '→', fqbn)
                            }
                        }
                    }
                } catch (e) {
                    console.debug('[workspace.compile] failed to read/parse config.h for fqbn recovery')
                }
            }

            if (!looksLikeFqbn(fqbn)) {
                // As a final attempt, scan live boards and match by port/name/serial
                try {
                    const boards = await this.pio.listBoards()
                    const match = boards.find(b => b.port === device.port || b.name === device.name || (b.serialNumber && (device as any).serialNumber && b.serialNumber === (device as any).serialNumber))
                    if (match && looksLikeFqbn(match.fqbn)) {
                        fqbn = match.fqbn
                        device.fqbn = fqbn
                        console.debug('[workspace.compile] recovered fqbn from live board scan:', fqbn)
                    }
                } catch {
                    console.debug('[workspace.compile] live board scan failed while recovering fqbn')
                }
            }

            if (!looksLikeFqbn(fqbn)) {
                throw new Error(`Board "${device.name}" has no FQBN — reconnect the board and rescan to identify it.`)
            }

            this.compileLog += `Compiling for ${fqbn}...\n`
            this.compileTerminal?.write(`Compiling for ${fqbn}...\n`)
            this.progressPercent = 40
            let streamedLines = 0
            const unsubCompile = this.pio.subscribeToProgress(({ phase, message }) => {
                if (phase === 'compile') {
                    this.compileLog += message + '\n'
                    this.compileTerminal?.write(message + '\n')
                    streamedLines++
                }
            })
            const result = await this.pio.compile(this.state.scratchPath!, fqbn, this.verboseCompile)
            unsubCompile()
            if (streamedLines === 0) {
                this.compileLog += result.output ?? ''
                this.compileTerminal?.write(result.output ?? '')
            }
            if (!result.success) throw new Error(result.error ?? 'Compilation failed')

            this.progressPercent = 70
            this.compileSuccess = true
            this.compileLog += '\n✓ Compile successful!'
            this.compileTerminal?.write('\n✓ Compile successful!')
            this.toastService.show({
                title: 'Compile Successful',
                content: `Built for ${fqbn}.`,
                cssClass: 'e-toast-success',
            })
        } catch (err) {
            this.compileError = (err as Error).message
            this.compileSuccess = false
            this.toastService.show({
                title: 'Compile Failed',
                content: (err as Error).message,
                cssClass: 'e-toast-danger',
            })
        } finally {
            this.isCompiling = false
        }
    }

    /**
     * Verifies `device.port` is still a live serial port right before an upload
     * touches it, and transparently corrects it if the board re-enumerated on a
     * different port (common right after a reset-triggering upload, a replug, or
     * — on Windows — a freshly/manually-bound generic USB-serial driver that
     * doesn't keep a stable COM number). Without this, the uploader would
     * be handed a stale port string and fail with an opaque "port doesn't exist"
     * error instead of the app recovering or explaining what happened.
     */
    private async ensureLivePort(device: DetectedBoardInfo): Promise<void> {
        await this.usb.initialize()
        await this.usb.refresh()

        let cliBoards: DetectedBoardInfo[] = []
        try {
            cliBoards = await this.pio.listBoards()
        } catch { /* fall back silently to the raw serial-port list */ }

        const connected = mergeDetectedBoards(this.usb.serialPorts, cliBoards)
        if (connected.some((b) => b.port === device.port)) return // still live at the cached port

        const { device: reconciled, portChanged } = reconcileDevicePort(device, connected)
        if (!portChanged) {
            throw new Error(
                `Board "${device.name}" is no longer available at ${device.port}. `
                + `Reconnect it and click the port badge to rescan before uploading.`,
            )
        }

        device.port = reconciled.port
        const configH = this.state.configFiles.find((f) => f.name === 'config.h')
        if (configH) {
            configH.content = injectDeviceHeader(configH.content, device)
            // ConfigEditorState.configHContent is a separate cached copy (it's what
            // the Raw editor and saveFiles()'s syncAll() actually read/write) —
            // without this, syncAll() below would see its own stale copy still has
            // *a* device header and keep it as-is, silently discarding the port we
            // just wrote into configH.content.
            this.configEditorState.configHContent = configH.content
        }
        await this.updateSavedConfig()
        await this.saveFiles()

        this.toastService.show({
            title: 'Port Updated',
            content: `Board reconnected at ${device.port}.`,
            cssClass: 'e-toast-success',
        })
    }

    async upload(): Promise<void> {
        const device = this.state.selectedDevice
        if (!device || !this.state.scratchPath) return

        // The uploader needs exclusive access to the port. Disconnect (if
        // connected) and remember to reconnect afterwards — success or
        // failure — so an active connection doesn't mean manually
        // disconnecting around every upload. The Monitor, if open, just
        // shows the resulting disconnect/reconnect like any other live
        // status change — it's a view, not something upload needs to manage.
        const wasConnected = this.portConnected
        if (wasConnected) await this.disconnect()

        this.isCompiling = true
        this.compileError = null
        this.progressPercent = 75

        try {
            const fqbn = device.fqbn
            if (!fqbn) {
                throw new Error(`Board "${device.name}" has no FQBN — reconnect the board and rescan to identify it.`)
            }

            await this.ensureLivePort(device)

            this.compileLog += `\nUploading to ${device.port}...\n`
            this.compileTerminal?.write(`\nUploading to ${device.port}...\n`)
            this.progressPercent = 80
            let streamedUploadLines = 0
            const unsubUpload = this.pio.subscribeToProgress(({ phase, message }) => {
                if (phase === 'upload') {
                    this.compileLog += message + '\n'
                    this.compileTerminal?.write(message + '\n')
                    streamedUploadLines++
                }
            })
            const result = await this.pio.upload(this.state.scratchPath!, fqbn, device.port, this.verboseCompile)
            unsubUpload()
            if (streamedUploadLines === 0) {
                this.compileLog += result.output ?? ''
                this.compileTerminal?.write(result.output ?? '')
            }
            if (!result.success) throw new Error(result.error ?? 'Upload failed')

            this.progressPercent = 100
            this.compileSuccess = true
            this.compileLog += '\n✓ Upload complete!'
            this.compileTerminal?.write('\n✓ Upload complete!')
            this.toastService.show({
                title: 'Upload Complete',
                content: `Firmware uploaded to ${device.port}.`,
                cssClass: 'e-toast-success',
            })
        } catch (err) {
            this.compileError = (err as Error).message
            this.compileSuccess = false
            this.toastService.show({
                title: 'Upload Failed',
                content: (err as Error).message,
                cssClass: 'e-toast-danger',
            })
        } finally {
            this.isCompiling = false
            if (wasConnected) await this.connect()
        }
    }

    async compileAndUpload(): Promise<void> {
        await this.compile()
        if (this.compileSuccess) {
            await this.upload()
        }
    }

    // ── Device switching ──────────────────────────────────────────────────────
    toggleDeviceMenu(): void {
        this.showDeviceMenu = !this.showDeviceMenu
    }

    async switchToConfig(config: SavedConfiguration): Promise<void> {
        this.showDeviceMenu = false
        // The port we're connected to (if any) belongs to the device we're
        // switching away from — checkDeviceConnection() below decides whether
        // to reconnect to the new one.
        if (this.portConnected) await this.disconnect()
        this.state.selectedDevice = {
            name: config.deviceName,
            port: config.devicePort,
            fqbn: config.deviceFqbn,
            protocol: 'serial',
            serialNumber: config.deviceSerialNumber,
        }
        this.state.selectedProduct = config.product || null
        this.state.selectedVersion = config.version || null
        this.state.repoPath = config.repoPath
        this.state.scratchPath = config.scratchPath
        this.state.sourceFolder = config.sourceFolder ?? null
        this.state.configFiles = config.configFiles.map((f) => ({ ...f }))
        this.state.activeConfigId = config.id
        this.activeFileIndex = 0
        this.compileLog = ''
        this.compileTerminal?.reset()
        this.compileSuccess = null
        // Reset the version dropdown's dataSource to match the newly-switched
        // device right away, since loadVersions()'s fetch below is async.
        this.seedVersionsFromSelected()
        this.refreshSfVersion()
        await this.refreshConfigFilesFromDisk()
        // Ensure the ConfigEditorState mirrors the newly-switched config files
        // so components that parse `config.h` (e.g. commandstation form) see
        // updated values such as `MOTOR_SHIELD_TYPE` immediately.
        this.configEditorState.loadFromInstallerState()
        // Notify any mounted components that the active config changed so they
        // can re-parse `config.h` and refresh UI state without requiring a
        // full reattach / reload.
        try {
            window.dispatchEvent(new CustomEvent('exinst:config-switched'))
        } catch {
            // noop in non-browser or test environments
        }
        // repoPath just changed to a different device's repo — refresh the
        // version list for it (fire-and-forget, same reasoning as binding()).
        void this.loadVersions()
        this.deviceConnectionStatus = 'unknown'
        void this.checkDeviceConnection()
    }

    async addNewDevice(): Promise<void> {
        this.showDeviceMenu = false
        this.state.reset()
        const result = await this.dialogService
            .open({ component: () => DeviceWizard })
            .whenClosed((r) => r)
        if (typeof result === 'object' && result !== null && 'status' in result && (result as any).status === 'ok') {
            await this.loadSavedConfigs()
            // The wizard stored the new config in state directly and in savedConfigurations.
            // Re-apply it via switchToConfig so configFiles / repoPath are all in sync.
            const newId = ((result as any).value as { id: string } | undefined)?.id
            const newConfig = this.state.savedConfigurations.find((c) => c.id === newId)
            if (newConfig) {
                await this.switchToConfig(newConfig)
            }
        }
    }

    async deleteConfig(config: SavedConfiguration, event: Event): Promise<void> {
        event.stopPropagation()
        this.state.savedConfigurations = this.state.savedConfigurations.filter((c) => c.id !== config.id)
        this.savedConfigs = this.savedConfigs.filter((c) => c.id !== config.id)
        await this.preferences.set('savedConfigurations', this.state.savedConfigurations)
        // If the deleted config was the one open, switch to the next or go home
        if (config.id === this.state.activeConfigId) {
            const next = this.savedConfigs[0]
            if (next) {
                await this.switchToConfig(next)
            } else {
                this.showDeviceMenu = false
                this.router.load('home')
            }
        }
    }

    goHome(): void {
        this.router.load('home')
    }

    async rescanPort(): Promise<void> {
        const device = this.state.selectedDevice
        if (!device) return

        const result = await this.dialogService
            .open({
                component: () => DevicePickerDialog,
                model: { initialFqbn: device.fqbn, portOnly: true },
            })
            .whenClosed((r) => r)

        // cancel = user closed the dialog — keep existing port
        if ((result as any).status === 'cancel') return

        const picked = (result as any).value as { port: string; fqbn: string } | null
        if (!picked?.port) return

        // Still connected to the OLD port at this point — close it before
        // repointing device.port, same reasoning as switchToConfig().
        if (this.portConnected) await this.disconnect()

        device.port = picked.port
        if (picked.fqbn && (picked.fqbn.startsWith(device.fqbn) || !device.fqbn)) {
            device.fqbn = picked.fqbn
        }

        // Persist the new port into config.h header and saved configs
        const configH = this.state.configFiles.find(f => f.name === 'config.h')
        if (configH) {
            configH.content = injectDeviceHeader(configH.content, device)
            // See the matching comment in ensureLivePort() — without this,
            // saveFiles()'s syncAll() below clobbers the port we just wrote with
            // ConfigEditorState's stale cached copy of config.h.
            this.configEditorState.configHContent = configH.content
        }
        await this.updateSavedConfig()
        // Also write to disk so it survives a reload
        await this.saveFiles()

        this.toastService.show({
            title: 'Port Updated',
            content: `Now using ${device.port}.`,
            cssClass: 'e-toast-success',
        })

        this.deviceConnectionStatus = 'unknown'
        void this.checkDeviceConnection()
    }

    /** True when a device with both an FQBN and a port is selected, and (if strictCompile is on) no config file currently has a Monaco error marker. */
    get canCompile(): boolean {
        const d = this.state.selectedDevice
        if (!d || !d.fqbn || !d.port) return false
        if (this.strictCompile && this.hasBlockingErrors) return false
        return true
    }

    /** True if the named config file's Monaco model currently has an error marker — drives the file-list error dot. */
    fileHasError(filename: string): boolean {
        return this.filesWithErrors.has(filename)
    }

    get productName(): string {
        const key = this.state.selectedProduct
        return key ? (productDetails[key]?.productName ?? key) : ''
    }

    get activeConfigName(): string {
        const id = this.state.activeConfigId
        if (!id) return this.state.selectedDevice?.name ?? ''
        return (
            this.savedConfigs.find((c) => c.id === id)?.name ??
            this.state.savedConfigurations.find((c) => c.id === id)?.name ??
            this.state.selectedDevice?.name ?? ''
        )
    }
}
