import { resolve } from 'aurelia'
import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { CheckBox } from '@syncfusion/ej2-buttons'
import { ThemeService, type ThemeMode } from '../../services/theme.service'
import { BlocklySoundsService } from '../../services/blockly-sounds.service'

export interface SettingsDialogModel {
    autoConnect: boolean
    showMonitorOnConnect: boolean
    verboseCompile: boolean
    useLatestProdVersion: boolean
    onAutoConnectChange: (enabled: boolean) => void
    onShowMonitorOnConnectChange: (enabled: boolean) => void
    onVerboseCompileChange: (enabled: boolean) => void
    onUseLatestProdVersionChange: (enabled: boolean) => void
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

    private model!: SettingsDialogModel

    autoConnect = true
    showMonitorOnConnect = true
    verboseCompile = false
    useLatestProdVersion = true

    autoConnectEl!: HTMLInputElement
    showMonitorOnConnectEl!: HTMLInputElement
    verboseCompileEl!: HTMLInputElement
    useLatestProdVersionEl!: HTMLInputElement
    blocklySoundsEl!: HTMLInputElement

    private sfAutoConnect?: CheckBox
    private sfShowMonitorOnConnect?: CheckBox
    private sfVerboseCompile?: CheckBox
    private sfUseLatestProdVersion?: CheckBox
    private sfBlocklySounds?: CheckBox

    activate(model: SettingsDialogModel): void {
        this.model = model
        this.autoConnect = model.autoConnect
        this.showMonitorOnConnect = model.showMonitorOnConnect
        this.verboseCompile = model.verboseCompile
        this.useLatestProdVersion = model.useLatestProdVersion
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

        this.sfBlocklySounds = new CheckBox({
            checked: this.blocklySounds.enabled,
            change: (args) => void this.blocklySounds.setEnabled(args.checked),
        })
        this.sfBlocklySounds.appendTo(this.blocklySoundsEl)
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
        this.sfBlocklySounds?.destroy()
        this.sfBlocklySounds = undefined
    }

    /** Applies (and persists) the theme immediately — ThemeService is the source of truth, so there's no local mirrored field to keep in sync. */
    setTheme(mode: ThemeMode): void {
        void this.theme.setMode(mode)
    }

    close(): void {
        void this.$dialog.ok()
    }
}
