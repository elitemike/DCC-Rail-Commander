import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { IDialogService } from '@aurelia/dialog'
import { InstallerState } from '../models/installer-state'
import { ToastService } from '../services/toast.service'
import { ConfigEditorState } from '../models/config-editor-state'
import { friendlyName } from '../utils/friendly-names'
import { PreferencesService } from '../services/preferences.service'
import { FileService } from '../services/file.service'
import { ArduinoCliService } from '../services/arduino-cli.service'
import { ConfigService } from '../services/config.service'
import { DeviceWizard } from '../components/device-wizard'
import { productDetails } from '../models/product-details'
import type { SavedConfiguration } from '../models/saved-configuration'
import { parseDeviceFromHeader } from '../utils/configHeaderParser'

export class Workspace {
    private readonly router = resolve(Router)
    private readonly dialogService = resolve(IDialogService)
    readonly state = resolve(InstallerState)
    readonly configEditorState = resolve(ConfigEditorState)
    private readonly toastService = resolve(ToastService)
    private readonly preferences = resolve(PreferencesService)
    private readonly files = resolve(FileService)
    private readonly cli = resolve(ArduinoCliService)
    private readonly config = resolve(ConfigService)

    // ── Active config file being edited ─────────────────────────────────────
    activeFileIndex = 0

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

    // ── Menu ─────────────────────────────────────────────────────────────────
    showDeviceMenu = false
    savedConfigs: SavedConfiguration[] = []

    async binding(): Promise<void> {
        await this.config.ready
        this.isMock = this.config.isMock
        if (!this.state.selectedDevice) {
            await this.router.load('home')
            return
        }
        await this.loadSavedConfigs()
        await this.refreshConfigFilesFromDisk()
        this.configEditorState.loadFromInstallerState()
    }

    /**
     * Re-reads each config file from disk to keep editor state aligned with
     * on-disk truth. For Load-from-Folder flows, prefer sourceFolder reads.
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

            for (const root of roots) {
                const diskPath = `${root}/${f.name}`
                const diskExists = await this.files.exists(diskPath)
                if (!diskExists) continue
                try {
                    diskContent = await this.files.readFile(diskPath)
                    break
                } catch {
                    // Continue fallback search across candidate roots.
                }
            }

            if (diskContent !== null && diskContent !== f.content) {
                f.content = diskContent
                changed = true
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
                    import('../components/confirm-dialog').then(m => m.ConfirmDialog).catch(() => null),
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
        this.state.savedConfigurations[idx] = {
            ...this.state.savedConfigurations[idx],
            configFiles: this.state.configFiles.map((f) => ({ ...f })),
            lastModified: new Date().toISOString(),
        }
        await this.preferences.set('savedConfigurations', this.state.savedConfigurations)
    }

    // ── Compile & Upload ──────────────────────────────────────────────────────
    clearCompileLog(): void {
        this.compileLog = ''
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
    }

    async compile(): Promise<void> {
        const device = this.state.selectedDevice
        if (!device || !this.state.scratchPath) return

        this.isCompiling = true
        this.compileLog = ''
        this.compileError = null
        this.compileSuccess = null
        this.progressPercent = 10

        try {
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
                // Try to recover from the injected header in config.h
                try {
                    if (this.state.scratchPath) {
                        const headerText = await this.files.readFile(`${this.state.scratchPath}/config.h`)
                        const parsed = parseDeviceFromHeader(headerText)
                        if (parsed && looksLikeFqbn(parsed.fqbn)) {
                            fqbn = parsed.fqbn
                            device.fqbn = fqbn
                            console.debug('[workspace.compile] recovered fqbn from config.h header:', fqbn)
                        }
                    }
                } catch (e) {
                    console.debug('[workspace.compile] failed to read/parse config.h for fqbn recovery')
                }
            }

            if (!looksLikeFqbn(fqbn)) {
                // As a final attempt, scan live boards and match by port/name/serial
                try {
                    const boards = await this.cli.listBoards()
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
                throw new Error(`Board "${device.name}" has no FQBN — install Arduino CLI and rescan to identify it.`)
            }

            this.compileLog += `Compiling for ${fqbn}...\n`
            this.progressPercent = 40
            const result = await this.cli.compile(this.state.scratchPath!, fqbn)
            this.compileLog += result.output ?? ''
            if (!result.success) throw new Error(result.error ?? 'Compilation failed')

            this.progressPercent = 70
            this.compileSuccess = true
            this.compileLog += '\n✓ Compile successful!'
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

    async upload(): Promise<void> {
        const device = this.state.selectedDevice
        if (!device || !this.state.scratchPath) return

        this.isCompiling = true
        this.compileError = null
        this.progressPercent = 75

        try {
            const fqbn = device.fqbn
            if (!fqbn) {
                throw new Error(`Board "${device.name}" has no FQBN — install Arduino CLI and rescan to identify it.`)
            }

            this.compileLog += `\nUploading to ${device.port}...\n`
            this.progressPercent = 80
            const result = await this.cli.upload(this.state.scratchPath!, fqbn, device.port)
            this.compileLog += result.output ?? ''
            if (!result.success) throw new Error(result.error ?? 'Upload failed')

            this.progressPercent = 100
            this.compileSuccess = true
            this.compileLog += '\n✓ Upload complete!'
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
        this.state.selectedDevice = { name: config.deviceName, port: config.devicePort, fqbn: config.deviceFqbn, protocol: 'serial' }
        this.state.selectedProduct = config.product || null
        this.state.selectedVersion = config.version || null
        this.state.repoPath = config.repoPath
        this.state.scratchPath = config.scratchPath
        this.state.sourceFolder = config.sourceFolder ?? null
        this.state.configFiles = config.configFiles.map((f) => ({ ...f }))
        this.state.activeConfigId = config.id
        this.activeFileIndex = 0
        this.compileLog = ''
        this.compileSuccess = null
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
