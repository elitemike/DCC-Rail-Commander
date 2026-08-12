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
import { Splitter } from '@syncfusion/ej2-layouts'
import { DropDownList } from '@syncfusion/ej2-dropdowns'
import { CheckBox } from '@syncfusion/ej2-buttons'
import type { FileEditorPanelCustomElement } from '../components/visual-editors/file-editor-panel'
import type { CompileOutputTerminalCustomElement } from '../components/compile-output-terminal'

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
    compileTerminal?: CompileOutputTerminalCustomElement

    // ── Left-nav section (Throttle vs Configuration) ──────────────────────────
    activeSection: 'throttle' | 'config' = 'config'

    /** Throttle is only reachable while the selected device is live at its port. */
    get showThrottleSection(): boolean {
        return this.deviceConnectionStatus === 'connected'
    }

    selectThrottleSection(): void {
        this.activeSection = 'throttle'
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

    // ── Device monitor ────────────────────────────────────────────────────────
    showMonitor = false
    /** Persisted app-wide preference (not per-device) — whether checkDeviceConnection() is allowed to auto-open the Monitor on connect. Loaded in binding(), toggled via the checkbox next to the Monitor button. */
    autoConnectMonitor = true
    autoConnectMonitorEl!: HTMLInputElement
    private sfAutoConnectMonitor?: CheckBox

    // ── Live device connection status (port badge) ────────────────────────────
    /** Whether the selected device currently answers at its recorded port — drives the port badge and auto-opening the Monitor. */
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
        // Fire-and-forget: a git call that can be slow (or fail entirely
        // offline) and must never block the rest of the view from rendering.
        void this.loadVersions()
        this.autoConnectMonitor = (await this.preferences.get<boolean>('autoConnectMonitor')) ?? true
        // Fire-and-forget: re-scans serial ports/boards to confirm the
        // selected device is actually plugged in, updating the port badge
        // and (on a fresh connect, if autoConnectMonitor is on) auto-opening
        // the Monitor.
        void this.checkDeviceConnection()
    }

    /** Persists the auto-connect-Monitor preference — called from the checkbox next to the Monitor button. */
    setAutoConnectMonitor(enabled: boolean): void {
        this.autoConnectMonitor = enabled
        void this.preferences.set('autoConnectMonitor', enabled)
    }

    /**
     * Re-scans connected serial ports/boards and checks whether the currently
     * selected device is actually live at its recorded port — the same
     * mergeDetectedBoards() lookup rescanPort()/ensureLivePort() already use,
     * just read-only here (never corrects the stored port itself).
     *
     * On a transition into 'connected' — not on every repeat check while
     * already connected — the Monitor is auto-opened if it isn't already
     * showing and autoConnectMonitor (a persisted app preference, not
     * per-device) is on. Gating on the transition (rather than "is
     * connected") means a user who's manually closed the Monitor won't have
     * it pop back open on an unrelated hotplug event while the device was
     * already live.
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
            if (isLive && !wasConnected && !this.showMonitor && this.autoConnectMonitor) {
                this.showMonitor = true
                this.activeBottomTab = 'monitor'
                this.openBottomPanel()
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

    /** Load available firmware version tags for the active device's repo. The latest Prod release is always selected. */
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
            const latest = pickLatestVersion(this.versions)
            if (latest) {
                this.state.selectedVersion = latest
            } else if (this.state.selectedVersion && !this.versions.includes(this.state.selectedVersion)) {
                // Couldn't fetch anything (e.g. offline) — keep whatever was
                // already known selectable rather than clearing it out.
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

        this.sfAutoConnectMonitor = new CheckBox({
            label: 'Auto-connect',
            checked: this.autoConnectMonitor,
            change: (args) => this.setAutoConnectMonitor(args.checked),
        })
        this.sfAutoConnectMonitor.appendTo(this.autoConnectMonitorEl)

        // Re-check whenever a USB device is plugged/unplugged — covers both
        // the selected board coming online after the workspace already loaded,
        // and it going away mid-session. Debounced since a hub can fire several
        // attach events back-to-back.
        this._unsubUsbAttached = window.usb?.onAttached(() => this._scheduleConnectionCheck()) ?? null
        this._unsubUsbDetached = window.usb?.onDetached(() => this._scheduleConnectionCheck()) ?? null
    }

    detaching(): void {
        this.splitterObj?.destroy()
        this.splitterObj = null
        this.sfVersion?.destroy()
        this.sfVersion = undefined
        this.sfAutoConnectMonitor?.destroy()
        this.sfAutoConnectMonitor = undefined
        if (this._connectionCheckTimer) {
            clearTimeout(this._connectionCheckTimer)
            this._connectionCheckTimer = null
        }
        this._unsubUsbAttached?.()
        this._unsubUsbDetached?.()
        this._unsubUsbAttached = null
        this._unsubUsbDetached = null
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
            // was missing (e.g. the user's file predates EX-Installer or was
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
            'myAliases.h',
            'myAutomation.h',
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

    async saveFiles(): Promise<void> {
        await this.flushPendingFormEdits()
        // Ensure latest parsed state (roster headers, turnout headers) is written
        // back into configFiles before we write to disk.
        this.configEditorState.syncAll()
        for (const f of this.state.configFiles) {
            if (this.state.scratchPath) {
                await this.files.writeFile(`${this.state.scratchPath}/${f.name}`, f.content)
            }
            // When loaded from a folder that lacks a .ino, the internal scratch path
            // is used for compilation but we must also write back to the user's
            // original folder so their changes are persisted there.
            if (this.state.sourceFolder) {
                await this.files.writeFile(`${this.state.sourceFolder}/${f.name}`, f.content)
            }
        }
        this.configEditorState.clearChanges()
        await this.updateSavedConfig()
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

    private async flushPendingFormEdits(): Promise<void> {
        const active = globalThis.document?.activeElement as HTMLElement | null | undefined
        if (active && typeof active.blur === 'function') {
            active.blur()
            // Allow framework blur/change handlers to run before saving files.
            await Promise.resolve()
            await new Promise<void>(resolve => setTimeout(resolve, 0))
        }
        // Monaco's raw editors (myAutomation.h, generic custom files) debounce
        // content → binding updates by 300ms and don't respond to blur, so a
        // Save right after typing can otherwise be overwritten with stale
        // pre-edit content.
        this.filePanel?.flushPending()
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
            const result = await this.pio.compile(this.state.scratchPath!, fqbn)
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

        // The Monitor holds the port open for live traffic, but the uploader
        // needs exclusive access to it during upload. Close it (if
        // open) and remember to bring it back afterwards — success or
        // failure — so watching the monitor doesn't mean manually closing
        // and reopening it around every upload. Switching to the Output tab
        // too avoids leaving the bottom panel showing a blank Monitor pane
        // for the duration (its tab button itself is hidden while closed).
        const monitorWasOpen = this.showMonitor
        const wasOnMonitorTab = this.activeBottomTab === 'monitor'
        if (monitorWasOpen) {
            this.showMonitor = false
            this.activeBottomTab = 'output'
        }
        try {
            if (await this.usb.isPortOpen(device.port)) {
                await this.usb.closePort(device.port)
            }
        } catch {
            // Best-effort — ensureLivePort()/the upload call itself will surface a real problem.
        }

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
            const result = await this.pio.upload(this.state.scratchPath!, fqbn, device.port)
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
            if (monitorWasOpen) {
                this.showMonitor = true
                if (wasOnMonitorTab) this.activeBottomTab = 'monitor'
            }
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

    /** True when a device with both an FQBN and a port is selected. */
    get canCompile(): boolean {
        const d = this.state.selectedDevice
        return !!d && !!d.fqbn && !!d.port
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
