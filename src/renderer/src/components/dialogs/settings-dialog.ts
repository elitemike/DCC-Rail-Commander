import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { CheckBox } from '@syncfusion/ej2-buttons'
import { ThemeService, type ThemeMode } from '../../services/theme.service'
import { BlocklySoundsService } from '../../services/blockly-sounds.service'
import { EditorDefaultViewService, type EditorViewMode } from '../../services/editor-default-view.service'
import { UpdaterService } from '../../services/updater.service'

export interface SettingsDialogModel {
    autoConnect: boolean
    showMonitorOnConnect: boolean
    verboseCompile: boolean
    useLatestProdVersion: boolean
    strictCompile: boolean
    quickCompileEnabled: boolean
    strictAliases: boolean
    onAutoConnectChange: (enabled: boolean) => void
    onShowMonitorOnConnectChange: (enabled: boolean) => void
    onVerboseCompileChange: (enabled: boolean) => void
    onUseLatestProdVersionChange: (enabled: boolean) => void
    onStrictCompileChange: (enabled: boolean) => void
    onQuickCompileEnabledChange: (enabled: boolean) => void
    onStrictAliasesChange: (enabled: boolean) => void
}

/**
 * App-wide settings dialog. Every toggle applies (and persists, via its
 * model callback — Workspace owns the actual PreferencesService writes)
 * immediately on change, so there's nothing to "save" — Close is the only
 * action.
 */
export class SettingsDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)
    readonly theme = resolve(ThemeService)
    readonly blocklySounds = resolve(BlocklySoundsService)
    readonly editorDefaultView = resolve(EditorDefaultViewService)
    readonly updater = resolve(UpdaterService)

    private model!: SettingsDialogModel

    autoConnect = true
    showMonitorOnConnect = true
    verboseCompile = false
    useLatestProdVersion = true
    strictCompile = false
    quickCompileEnabled = true
    strictAliases = true

    autoConnectEl!: HTMLInputElement
    showMonitorOnConnectEl!: HTMLInputElement
    verboseCompileEl!: HTMLInputElement
    useLatestProdVersionEl!: HTMLInputElement
    strictCompileEl!: HTMLInputElement
    quickCompileEnabledEl!: HTMLInputElement
    strictAliasesEl!: HTMLInputElement
    blocklySoundsEl!: HTMLInputElement
    autoCheckUpdatesEl!: HTMLInputElement

    private sfAutoConnect?: CheckBox
    private sfShowMonitorOnConnect?: CheckBox
    private sfVerboseCompile?: CheckBox
    private sfUseLatestProdVersion?: CheckBox
    private sfStrictCompile?: CheckBox
    private sfQuickCompileEnabled?: CheckBox
    private sfStrictAliases?: CheckBox
    private sfBlocklySounds?: CheckBox
    private sfAutoCheckUpdates?: CheckBox

    activate(model: SettingsDialogModel): void {
        this.model = model
        this.autoConnect = model.autoConnect
        this.showMonitorOnConnect = model.showMonitorOnConnect
        this.verboseCompile = model.verboseCompile
        this.useLatestProdVersion = model.useLatestProdVersion
        this.strictCompile = model.strictCompile
        this.quickCompileEnabled = model.quickCompileEnabled
        this.strictAliases = model.strictAliases
    }

    attached(): void {
        this.sfAutoConnect = new CheckBox({
            checked: this.autoConnect,
            change: (args) => this.model.onAutoConnectChange(args.checked),
        })
        this.sfAutoConnect.appendTo(this.autoConnectEl)

        this.sfShowMonitorOnConnect = new CheckBox({
            checked: this.showMonitorOnConnect,
            change: (args) => this.model.onShowMonitorOnConnectChange(args.checked),
        })
        this.sfShowMonitorOnConnect.appendTo(this.showMonitorOnConnectEl)

        this.sfVerboseCompile = new CheckBox({
            checked: this.verboseCompile,
            change: (args) => this.model.onVerboseCompileChange(args.checked),
        })
        this.sfVerboseCompile.appendTo(this.verboseCompileEl)

        this.sfUseLatestProdVersion = new CheckBox({
            checked: this.useLatestProdVersion,
            change: (args) => this.model.onUseLatestProdVersionChange(args.checked),
        })
        this.sfUseLatestProdVersion.appendTo(this.useLatestProdVersionEl)

        this.sfStrictCompile = new CheckBox({
            checked: this.strictCompile,
            change: (args) => this.model.onStrictCompileChange(args.checked),
        })
        this.sfStrictCompile.appendTo(this.strictCompileEl)

        this.sfQuickCompileEnabled = new CheckBox({
            checked: this.quickCompileEnabled,
            change: (args) => this.model.onQuickCompileEnabledChange(args.checked),
        })
        this.sfQuickCompileEnabled.appendTo(this.quickCompileEnabledEl)

        this.sfStrictAliases = new CheckBox({
            checked: this.strictAliases,
            change: (args) => this.model.onStrictAliasesChange(args.checked),
        })
        this.sfStrictAliases.appendTo(this.strictAliasesEl)

        this.sfBlocklySounds = new CheckBox({
            checked: this.blocklySounds.enabled,
            change: (args) => void this.blocklySounds.setEnabled(args.checked),
        })
        this.sfBlocklySounds.appendTo(this.blocklySoundsEl)

        this.sfAutoCheckUpdates = new CheckBox({
            checked: this.updater.autoCheck,
            change: (args) => void this.updater.setAutoCheck(args.checked),
        })
        this.sfAutoCheckUpdates.appendTo(this.autoCheckUpdatesEl)
    }

    detaching(): void {
        this.sfAutoConnect?.destroy()
        this.sfAutoConnect = undefined
        this.sfShowMonitorOnConnect?.destroy()
        this.sfShowMonitorOnConnect = undefined
        this.sfVerboseCompile?.destroy()
        this.sfVerboseCompile = undefined
        this.sfUseLatestProdVersion?.destroy()
        this.sfUseLatestProdVersion = undefined
        this.sfStrictCompile?.destroy()
        this.sfStrictCompile = undefined
        this.sfQuickCompileEnabled?.destroy()
        this.sfQuickCompileEnabled = undefined
        this.sfStrictAliases?.destroy()
        this.sfStrictAliases = undefined
        this.sfBlocklySounds?.destroy()
        this.sfBlocklySounds = undefined
        this.sfAutoCheckUpdates?.destroy()
        this.sfAutoCheckUpdates = undefined
    }

    /** Applies (and persists) the theme immediately — ThemeService is the source of truth, so there's no local mirrored field to keep in sync. */
    setTheme(mode: ThemeMode): void {
        void this.theme.setMode(mode)
    }

    /** Applies (and persists) the default editor view immediately — EditorDefaultViewService is the source of truth, same as theme above. */
    setDefaultEditorView(mode: EditorViewMode): void {
        void this.editorDefaultView.setValue(mode)
    }

    get hasUpdate(): boolean {
        const status = this.updater.state.status
        return status === 'available' || status === 'downloading' || status === 'downloaded'
    }

    get updateStatusText(): string {
        const state = this.updater.state
        switch (state.status) {
            case 'unsupported':
                return 'Updates are only available in the installed app.'
            case 'checking':
                return 'Checking for updates…'
            case 'not-available':
                return "You're on the latest version."
            case 'available':
                return `Version ${state.update.version} is available.`
            case 'downloading':
                return `Downloading version ${state.update.version} (${Math.round(state.percent)}%).`
            case 'downloaded':
                return `Version ${state.update.version} is ready to install.`
            case 'error':
                return `Couldn't update: ${state.message}`
            default:
                return ''
        }
    }

    /** UpdaterService opens the update dialog on top of Settings if one turns up. */
    checkForUpdates(): void {
        void this.updater.checkNow()
    }

    viewUpdate(): void {
        void this.updater.showUpdateDialog()
    }

    close(): void {
        void this.$dialog.ok()
    }
}
