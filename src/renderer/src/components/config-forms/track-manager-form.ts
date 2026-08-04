import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import {
    type CommandStationConfigOptions,
    type MyAutomationOptions,
    defaultCommandStationConfig,
    parseCommandStationConfig,
    generateMyAutomation,
    parseMyAutomationTrackManager,
    STACKED_MOTOR_DRIVER,
} from '../../config/commandstation'
import { NumericTextBox } from '@syncfusion/ej2-inputs'
import { RadioButton } from '@syncfusion/ej2-buttons'
import { DropDownList } from '@syncfusion/ej2-dropdowns'

/**
 * track-manager-form — the Visual pane of the Automation editor for
 * EX-CommandStation. Generates the managed TrackManager block inside
 * myAutomation.h (see MANAGED_TRACK_MANAGER_TAG in config-editor-state.ts).
 *
 * Moved out of commandstation-config-form: TrackManager doesn't configure
 * config.h device hardware, it configures myAutomation.h's AUTOSTART block,
 * so it belongs alongside Automation rather than Device Settings.
 *
 * Whether a stacked motor shield is present is read-only here — it's derived
 * from the motor driver selected on the Device Settings (config.h) side, not
 * settable from this form. Selecting EXCSB1_WITH_EX8874 in Device Settings is
 * the only way to enable Track C/D.
 */
export class TrackManagerFormCustomElement {
    private readonly editorState = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)

    opts: CommandStationConfigOptions = defaultCommandStationConfig()

    readonly trackModes = ['MAIN', 'PROG', 'DC', 'DCX']
    readonly dccModes = ['MAIN', 'MAIN_INV', 'MAIN_AUTO', 'PROG', 'NONE']
    readonly dcModes = ['DC', 'DC_INV', 'DCX', 'NONE']
    readonly startupPowerModes = [
        { value: 'all', label: 'All tracks on (POWERON)' },
        { value: 'individual', label: 'Individual tracks (SET_POWER)' },
    ]
    readonly powerOptions = ['ON', 'OFF']

    // Element refs set by Aurelia template ref binding
    trackManagerModeDccOnlyEl!: HTMLInputElement
    trackManagerModeDcOnlyEl!: HTMLInputElement
    trackManagerModeMixedEl!: HTMLInputElement
    startupPowerModeEl!: HTMLInputElement
    trackAModeEl!: HTMLInputElement
    trackAPowerEl!: HTMLInputElement
    trackATypeDccEl?: HTMLInputElement
    trackATypeDcEl?: HTMLInputElement
    trackALocoIdEl!: HTMLInputElement
    trackBModeEl!: HTMLInputElement
    trackBPowerEl!: HTMLInputElement
    trackBTypeDccEl?: HTMLInputElement
    trackBTypeDcEl?: HTMLInputElement
    trackBLocoIdEl!: HTMLInputElement
    trackCModeEl?: HTMLInputElement
    trackCPowerEl?: HTMLInputElement
    trackCTypeDccEl?: HTMLInputElement
    trackCTypeDcEl?: HTMLInputElement
    trackCLocoIdEl?: HTMLInputElement
    trackDModeEl?: HTMLInputElement
    trackDPowerEl?: HTMLInputElement
    trackDTypeDccEl?: HTMLInputElement
    trackDTypeDcEl?: HTMLInputElement
    trackDLocoIdEl?: HTMLInputElement

    // SF instances
    private sfTrackManagerModeDccOnly?: RadioButton
    private sfTrackManagerModeDcOnly?: RadioButton
    private sfTrackManagerModeMixed?: RadioButton
    private sfStartupPowerMode?: DropDownList
    private sfTrackAMode?: DropDownList
    private sfTrackAPower?: DropDownList
    private sfTrackATypeDcc?: RadioButton
    private sfTrackATypeDc?: RadioButton
    private sfTrackALocoId?: NumericTextBox
    private sfTrackBMode?: DropDownList
    private sfTrackBPower?: DropDownList
    private sfTrackBTypeDcc?: RadioButton
    private sfTrackBTypeDc?: RadioButton
    private sfTrackBLocoId?: NumericTextBox
    private sfTrackCMode?: DropDownList
    private sfTrackCPower?: DropDownList
    private sfTrackCTypeDcc?: RadioButton
    private sfTrackCTypeDc?: RadioButton
    private sfTrackCLocoId?: NumericTextBox
    private sfTrackDMode?: DropDownList
    private sfTrackDPower?: DropDownList
    private sfTrackDTypeDcc?: RadioButton
    private sfTrackDTypeDc?: RadioButton
    private sfTrackDLocoId?: NumericTextBox

    // Event handler for config switches
    private configSwitchedHandler = async (): Promise<void> => {
        await this.reloadFromConfig()
    }

    /** Derived purely from the motor driver selected in Device Settings (config.h). */
    get hasStackedMotorShield(): boolean {
        return this.opts.motorDriver?.toUpperCase() === STACKED_MOTOR_DRIVER
    }

    get trackManagerModeMixed(): boolean {
        return this.opts.trackManagerMode === 'mixed'
    }

    get trackAIsDc(): boolean {
        return this.opts.trackAType === 'dc'
    }

    get trackBIsDc(): boolean {
        return this.opts.trackBType === 'dc'
    }

    get trackCIsDc(): boolean {
        return this.opts.trackCType === 'dc'
    }

    get trackDIsDc(): boolean {
        return this.opts.trackDType === 'dc'
    }

    binding(): void {
        Object.assign(this.opts, parseCommandStationConfig(this.editorState.configHContent))
        // Load track manager settings (modes/power/loco IDs) from myAutomation.h
        // if present. hasStackedMotorShield is NOT taken from here — it's
        // derived purely from the motor driver parsed above.
        const automationFile = this.installerState.configFiles.find(f => f.name === 'myAutomation.h')
        if (automationFile != null) {
            const trackManagerOpts = parseMyAutomationTrackManager(automationFile.content)
            delete trackManagerOpts.hasStackedMotorShield
            Object.assign(this.opts, trackManagerOpts)
        }
        // The motor driver may have changed on the Device Settings side since
        // myAutomation.h was last generated — reconcile Track C/D content now.
        this.syncAutomationContent()
    }

    attached(): void {
        this.initSfControls()
        // Listen for config switches so the form can refresh without a
        // full reattach. The workspace dispatches `exinst:config-switched`.
        try {
            window.addEventListener('exinst:config-switched', this.configSwitchedHandler as EventListener)
        } catch {
            // noop in non-browser contexts
        }
    }

    detaching(): void {
        this.destroySfControls()
        try {
            window.removeEventListener('exinst:config-switched', this.configSwitchedHandler as EventListener)
        } catch {
            // noop
        }
    }

    private destroySfControls(): void {
        this.sfTrackManagerModeDccOnly?.destroy()
        this.sfTrackManagerModeDcOnly?.destroy()
        this.sfTrackManagerModeMixed?.destroy()
        this.sfStartupPowerMode?.destroy()
        this.sfTrackAMode?.destroy()
        this.sfTrackAPower?.destroy()
        this.sfTrackATypeDcc?.destroy()
        this.sfTrackATypeDc?.destroy()
        this.sfTrackALocoId?.destroy()
        this.sfTrackBMode?.destroy()
        this.sfTrackBPower?.destroy()
        this.sfTrackBTypeDcc?.destroy()
        this.sfTrackBTypeDc?.destroy()
        this.sfTrackBLocoId?.destroy()
        this.sfTrackCMode?.destroy()
        this.sfTrackCPower?.destroy()
        this.sfTrackCTypeDcc?.destroy()
        this.sfTrackCTypeDc?.destroy()
        this.sfTrackCLocoId?.destroy()
        this.sfTrackDMode?.destroy()
        this.sfTrackDPower?.destroy()
        this.sfTrackDTypeDcc?.destroy()
        this.sfTrackDTypeDc?.destroy()
        this.sfTrackDLocoId?.destroy()
    }

    private async reloadFromConfig(): Promise<void> {
        // Re-parse config.h into current options so `hasStackedMotorShield`
        // reflects the motor driver from the loaded `config.h`.
        try {
            Object.assign(this.opts, parseCommandStationConfig(this.editorState.configHContent))
            const automationFile = this.installerState.configFiles.find(f => f.name === 'myAutomation.h')
            if (automationFile != null) {
                const trackManagerOpts = parseMyAutomationTrackManager(automationFile.content)
                delete trackManagerOpts.hasStackedMotorShield
                Object.assign(this.opts, trackManagerOpts)
            }
        } catch {
            // parsing failure -> keep existing opts
        }
        // Reconcile Track C/D content against the (possibly changed) motor driver.
        this.syncAutomationContent()
        // Destroy existing controls and re-initialise so the motor-driver-derived
        // stacked-shield state takes effect.
        this.destroySfControls()
        this.initSfControls()
    }

    private initSfControls(): void {
        // Track manager mode selector
        this.sfTrackManagerModeDccOnly = new RadioButton({
            label: 'DCC only',
            name: 'trackManagerMode',
            value: 'dcc-only',
            checked: this.opts.trackManagerMode === 'dcc-only',
            change: () => {
                this.opts.trackManagerMode = 'dcc-only'
                this.opts.trackAType = 'dcc'
                this.opts.trackBType = 'dcc'
                this.opts.trackCType = 'dcc'
                this.opts.trackDType = 'dcc'
                this.updateTrackModeOptions()
                this.onFieldChange()
            },
        })
        this.sfTrackManagerModeDccOnly.appendTo(this.trackManagerModeDccOnlyEl)

        this.sfTrackManagerModeDcOnly = new RadioButton({
            label: 'DC only',
            name: 'trackManagerMode',
            value: 'dc-only',
            checked: this.opts.trackManagerMode === 'dc-only',
            change: () => {
                this.opts.trackManagerMode = 'dc-only'
                this.opts.trackAType = 'dc'
                this.opts.trackBType = 'dc'
                this.opts.trackCType = 'dc'
                this.opts.trackDType = 'dc'
                this.updateTrackModeOptions()
                this.onFieldChange()
            },
        })
        this.sfTrackManagerModeDcOnly.appendTo(this.trackManagerModeDcOnlyEl)

        this.sfTrackManagerModeMixed = new RadioButton({
            label: 'Mixed (DCC and DC)',
            name: 'trackManagerMode',
            value: 'mixed',
            checked: this.opts.trackManagerMode === 'mixed',
            change: () => {
                this.opts.trackManagerMode = 'mixed'
                this.updateTrackModeOptions()
                this.onFieldChange()
            },
        })
        this.sfTrackManagerModeMixed.appendTo(this.trackManagerModeMixedEl)

        this.sfStartupPowerMode = new DropDownList({
            dataSource: this.startupPowerModes.map((p) => ({ text: p.label, value: p.value })),
            fields: { text: 'text', value: 'value' },
            value: this.opts.startupPowerMode,
            change: (args) => {
                this.opts.startupPowerMode = args.value as 'all' | 'individual'
                this.opts.enablePowerOnStart = true
                this.onFieldChange()
            },
        })
        this.sfStartupPowerMode.appendTo(this.startupPowerModeEl)

        // Track A
        this.initTrackAControls()

        // Track B
        this.initTrackBControls()

        // Track C (only with stacked motor shield)
        if (this.trackCModeEl) {
            this.initTrackCControls()
        }

        // Track D (only with stacked motor shield)
        if (this.trackDModeEl) {
            this.initTrackDControls()
        }
    }

    private initTrackAControls(): void {
        // Type selector (mixed mode only)
        if (this.trackATypeDccEl && this.trackATypeDcEl) {
            this.sfTrackATypeDcc = new RadioButton({
                label: 'DCC',
                name: 'trackAType',
                value: 'dcc',
                checked: this.opts.trackAType === 'dcc',
                change: () => {
                    this.opts.trackAType = 'dcc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackATypeDcc.appendTo(this.trackATypeDccEl)

            this.sfTrackATypeDc = new RadioButton({
                label: 'DC',
                name: 'trackAType',
                value: 'dc',
                checked: this.opts.trackAType === 'dc',
                change: () => {
                    this.opts.trackAType = 'dc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackATypeDc.appendTo(this.trackATypeDcEl)
        }

        // Mode dropdown
        this.sfTrackAMode = new DropDownList({
            dataSource: this.getTrackModeOptions(this.opts.trackAType),
            value: this.opts.trackAMode,
            change: (args) => {
                this.opts.trackAMode = args.value as string
                this.onFieldChange()
            },
        })
        this.sfTrackAMode.appendTo(this.trackAModeEl)

        this.sfTrackAPower = new DropDownList({
            dataSource: this.powerOptions,
            value: this.opts.trackAPower,
            change: (args) => {
                this.opts.trackAPower = args.value as 'ON' | 'OFF'
                this.opts.enablePowerOnStart = true
                this.onFieldChange()
            },
        })
        this.sfTrackAPower.appendTo(this.trackAPowerEl)

        // Loco ID (DC mode only)
        this.sfTrackALocoId = new NumericTextBox({
            min: 1,
            format: 'n0',
            value: this.opts.trackALocoId || 1,
            change: (args) => {
                if (args.value != null) this.opts.trackALocoId = args.value
                this.onFieldChange()
            },
        })
        this.sfTrackALocoId.appendTo(this.trackALocoIdEl)
    }

    private initTrackBControls(): void {
        // Type selector (mixed mode only)
        if (this.trackBTypeDccEl && this.trackBTypeDcEl) {
            this.sfTrackBTypeDcc = new RadioButton({
                label: 'DCC',
                name: 'trackBType',
                value: 'dcc',
                checked: this.opts.trackBType === 'dcc',
                change: () => {
                    this.opts.trackBType = 'dcc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackBTypeDcc.appendTo(this.trackBTypeDccEl)

            this.sfTrackBTypeDc = new RadioButton({
                label: 'DC',
                name: 'trackBType',
                value: 'dc',
                checked: this.opts.trackBType === 'dc',
                change: () => {
                    this.opts.trackBType = 'dc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackBTypeDc.appendTo(this.trackBTypeDcEl)
        }

        // Mode dropdown
        this.sfTrackBMode = new DropDownList({
            dataSource: this.getTrackModeOptions(this.opts.trackBType),
            value: this.opts.trackBMode,
            change: (args) => {
                this.opts.trackBMode = args.value as string
                this.onFieldChange()
            },
        })
        this.sfTrackBMode.appendTo(this.trackBModeEl)

        this.sfTrackBPower = new DropDownList({
            dataSource: this.powerOptions,
            value: this.opts.trackBPower,
            change: (args) => {
                this.opts.trackBPower = args.value as 'ON' | 'OFF'
                this.opts.enablePowerOnStart = true
                this.onFieldChange()
            },
        })
        this.sfTrackBPower.appendTo(this.trackBPowerEl)

        // Loco ID (DC mode only)
        this.sfTrackBLocoId = new NumericTextBox({
            min: 1,
            format: 'n0',
            value: this.opts.trackBLocoId || 1,
            change: (args) => {
                if (args.value != null) this.opts.trackBLocoId = args.value
                this.onFieldChange()
            },
        })
        this.sfTrackBLocoId.appendTo(this.trackBLocoIdEl)
    }

    private initTrackCControls(): void {
        // Type selector (mixed mode only)
        if (this.trackCTypeDccEl && this.trackCTypeDcEl) {
            this.sfTrackCTypeDcc = new RadioButton({
                label: 'DCC',
                name: 'trackCType',
                value: 'dcc',
                checked: this.opts.trackCType === 'dcc',
                change: () => {
                    this.opts.trackCType = 'dcc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackCTypeDcc.appendTo(this.trackCTypeDccEl)

            this.sfTrackCTypeDc = new RadioButton({
                label: 'DC',
                name: 'trackCType',
                value: 'dc',
                checked: this.opts.trackCType === 'dc',
                change: () => {
                    this.opts.trackCType = 'dc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackCTypeDc.appendTo(this.trackCTypeDcEl)
        }

        // Mode dropdown
        this.sfTrackCMode = new DropDownList({
            dataSource: this.getTrackModeOptions(this.opts.trackCType),
            value: this.opts.trackCMode,
            change: (args) => {
                this.opts.trackCMode = args.value as string
                this.onFieldChange()
            },
        })
        this.sfTrackCMode.appendTo(this.trackCModeEl!)

        if (this.trackCPowerEl) {
            this.sfTrackCPower = new DropDownList({
                dataSource: this.powerOptions,
                value: this.opts.trackCPower,
                change: (args) => {
                    this.opts.trackCPower = args.value as 'ON' | 'OFF'
                    this.opts.enablePowerOnStart = true
                    this.onFieldChange()
                },
            })
            this.sfTrackCPower.appendTo(this.trackCPowerEl)
        }

        // Loco ID (DC mode only)
        this.sfTrackCLocoId = new NumericTextBox({
            min: 1,
            format: 'n0',
            value: this.opts.trackCLocoId || 1,
            change: (args) => {
                if (args.value != null) this.opts.trackCLocoId = args.value
                this.onFieldChange()
            },
        })
        this.sfTrackCLocoId.appendTo(this.trackCLocoIdEl!)
    }

    private initTrackDControls(): void {
        // Type selector (mixed mode only)
        if (this.trackDTypeDccEl && this.trackDTypeDcEl) {
            this.sfTrackDTypeDcc = new RadioButton({
                label: 'DCC',
                name: 'trackDType',
                value: 'dcc',
                checked: this.opts.trackDType === 'dcc',
                change: () => {
                    this.opts.trackDType = 'dcc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackDTypeDcc.appendTo(this.trackDTypeDccEl)

            this.sfTrackDTypeDc = new RadioButton({
                label: 'DC',
                name: 'trackDType',
                value: 'dc',
                checked: this.opts.trackDType === 'dc',
                change: () => {
                    this.opts.trackDType = 'dc'
                    this.updateTrackModeOptions()
                    this.onFieldChange()
                },
            })
            this.sfTrackDTypeDc.appendTo(this.trackDTypeDcEl)
        }

        // Mode dropdown
        this.sfTrackDMode = new DropDownList({
            dataSource: this.getTrackModeOptions(this.opts.trackDType),
            value: this.opts.trackDMode,
            change: (args) => {
                this.opts.trackDMode = args.value as string
                this.onFieldChange()
            },
        })
        this.sfTrackDMode.appendTo(this.trackDModeEl!)

        if (this.trackDPowerEl) {
            this.sfTrackDPower = new DropDownList({
                dataSource: this.powerOptions,
                value: this.opts.trackDPower,
                change: (args) => {
                    this.opts.trackDPower = args.value as 'ON' | 'OFF'
                    this.opts.enablePowerOnStart = true
                    this.onFieldChange()
                },
            })
            this.sfTrackDPower.appendTo(this.trackDPowerEl)
        }

        // Loco ID (DC mode only)
        this.sfTrackDLocoId = new NumericTextBox({
            min: 1,
            format: 'n0',
            value: this.opts.trackDLocoId || 1,
            change: (args) => {
                if (args.value != null) this.opts.trackDLocoId = args.value
                this.onFieldChange()
            },
        })
        this.sfTrackDLocoId.appendTo(this.trackDLocoIdEl!)
    }

    private getTrackModeOptions(trackType: 'dcc' | 'dc'): string[] {
        if (this.opts.trackManagerMode === 'dcc-only') {
            return this.dccModes
        } else if (this.opts.trackManagerMode === 'dc-only') {
            return this.dcModes
        } else {
            // Mixed mode - return options based on track type
            return trackType === 'dcc' ? this.dccModes : this.dcModes
        }
    }

    private updateTrackModeOptions(): void {
        // Update dropdowns based on track type
        if (this.sfTrackAMode) {
            this.sfTrackAMode.dataSource = this.getTrackModeOptions(this.opts.trackAType)
            this.sfTrackAMode.refresh()
        }
        if (this.sfTrackBMode) {
            this.sfTrackBMode.dataSource = this.getTrackModeOptions(this.opts.trackBType)
            this.sfTrackBMode.refresh()
        }
        if (this.sfTrackCMode) {
            this.sfTrackCMode.dataSource = this.getTrackModeOptions(this.opts.trackCType)
            this.sfTrackCMode.refresh()
        }
        if (this.sfTrackDMode) {
            this.sfTrackDMode.dataSource = this.getTrackModeOptions(this.opts.trackDType)
            this.sfTrackDMode.refresh()
        }
    }

    onFieldChange(): void {
        // Startup power mode drives whether POWERON/SET_POWER should be emitted.
        // If "all" is selected, always generate startup power commands.
        if (this.opts.startupPowerMode === 'all') {
            this.opts.enablePowerOnStart = true
        }
        this.syncAutomationContent()
    }

    /**
     * Regenerate myAutomation.h's TrackManager block from the current opts.
     * Called on every field edit AND on bind/reload, since hasStackedMotorShield
     * can change on the Device Settings side without this form being mounted —
     * without this, switching motor drivers there would leave stale Track C/D
     * content behind until some field here happened to be touched.
     */
    private syncAutomationContent(): void {
        const automationOpts: MyAutomationOptions = {
            enablePowerOnStart: this.opts.enablePowerOnStart,
            hasStackedMotorShield: this.hasStackedMotorShield,
            startupPowerMode: this.opts.startupPowerMode,
            trackAMode: this.opts.trackAMode,
            trackALocoId: this.opts.trackALocoId,
            trackAPower: this.opts.trackAPower,
            trackBMode: this.opts.trackBMode,
            trackBLocoId: this.opts.trackBLocoId,
            trackBPower: this.opts.trackBPower,
            trackCMode: this.opts.trackCMode,
            trackCLocoId: this.opts.trackCLocoId,
            trackCPower: this.opts.trackCPower,
            trackDMode: this.opts.trackDMode,
            trackDLocoId: this.opts.trackDLocoId,
            trackDPower: this.opts.trackDPower,
        }
        const automationContent = generateMyAutomation(automationOpts)
        this.editorState.syncTrackManager(automationContent)
    }
}
