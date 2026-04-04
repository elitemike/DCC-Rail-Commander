import { resolve, observable } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import { FileService } from '../../services/file.service'
import {
    type CommandStationConfigOptions,
    type MyAutomationOptions,
    defaultCommandStationConfig,
    parseCommandStationConfig,
    generateCommandStationConfig,
    generateMyAutomation,
    parseMyAutomationTrackManager
} from '../../config/commandstation'
import { TextBox, NumericTextBox } from '@syncfusion/ej2-inputs'
import { CheckBox, RadioButton, Button } from '@syncfusion/ej2-buttons'
import { DropDownList } from '@syncfusion/ej2-dropdowns'

type ConfigTab = 'general' | 'wifi' | 'trackmanager'

const FALLBACK_DRIVERS_GENERIC = [
    'STANDARD_MOTOR_SHIELD',
    'EX8874',
    'POLOLU_MOTOR_SHIELD',
    'ARDUINO_MOTOR_SHIELD_REV3',
    'IBT_2_WITH_ARDUINO',
    'FIREBOX_MK1',
    'FIREBOX_MK1S',
    'NOINVERTER',
]

const FALLBACK_DRIVERS_CSB1 = ['EXCSB1', 'EXCSB1_WITH_EX8874', 'EXCSB1_PROG']

export class CommandstationConfigFormCustomElement {
    private readonly editorState = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)
    private readonly fileService = resolve(FileService)

    activeConfigTab: ConfigTab = 'general'
    motorDrivers: string[] = []
    opts: CommandStationConfigOptions = defaultCommandStationConfig()

    readonly trackModes = ['MAIN', 'PROG', 'DC', 'DCX']
    readonly displays = [
        { value: 'NONE', label: 'None' },
        { value: 'LCD_16x2', label: 'LCD 16×2' },
        { value: 'LCD_20x4', label: 'LCD 20×4' },
        { value: 'OLED_128x32', label: 'OLED 128×32' },
        { value: 'OLED_128x64', label: 'OLED 128×64' },
        { value: 'OLED_132x64', label: 'OLED 132×64 (EX-CSB1)' },
    ]
    readonly scrollModes = [
        { value: 0, label: 'Continuous — fill screen, scroll smoothly' },
        { value: 1, label: 'By page — alternate between pages' },
        { value: 2, label: 'By row — move up one row at a time' },
    ]
    readonly dccModes = ['MAIN', 'MAIN_INV', 'MAIN_AUTO', 'PROG', 'NONE']
    readonly dcModes = ['DC', 'DC_INV', 'DCX', 'NONE']
    readonly startupPowerModes = [
        { value: 'all', label: 'All tracks on (POWERON)' },
        { value: 'individual', label: 'Individual tracks (SET_POWER)' },
    ]
    readonly powerOptions = ['ON', 'OFF']

    // Element refs set by Aurelia template ref binding
    motorDriverEl!: HTMLInputElement
    displayEl!: HTMLInputElement
    scrollModeEl!: HTMLInputElement
    enableWifiEl?: HTMLInputElement         // conditional: if.bind="!isCsb1"
    enableEthernetEl?: HTMLInputElement     // conditional: if.bind="!isEsp32"
    enablePowerOnStartEl!: HTMLInputElement
    disableEepromEl?: HTMLInputElement      // conditional: if.bind="!isCsb1"
    disableProgEl!: HTMLInputElement
    wifiModeApEl!: HTMLInputElement
    wifiModeStaEl!: HTMLInputElement
    wifiHostnameEl!: HTMLInputElement
    wifiSsidEl!: HTMLInputElement
    wifiPasswordEl!: HTMLInputElement
    wifiChannelEl!: HTMLInputElement
    resetWifiBtnEl!: HTMLButtonElement
    // TrackManager refs
    hasStackedMotorShieldEl?: HTMLInputElement
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
    private sfMotorDriver?: DropDownList
    private sfDisplay?: DropDownList
    private sfScrollMode?: DropDownList
    private sfEnableWifi?: CheckBox
    private sfEnableEthernet?: CheckBox
    private sfEnablePowerOnStart?: CheckBox
    private sfDisableEeprom?: CheckBox
    private sfDisableProg?: CheckBox
    private sfWifiModeAp?: RadioButton
    private sfWifiModeSta?: RadioButton
    private sfWifiHostname?: TextBox
    private sfWifiSsid?: TextBox
    private sfWifiPassword?: TextBox
    private sfWifiChannel?: NumericTextBox
    private sfResetWifiBtn?: Button
    // TrackManager SF instances
    private sfHasStackedMotorShield?: CheckBox
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
    @observable
    private csbTick = 0

    // Event handler for config switches
    private configSwitchedHandler = async (): Promise<void> => {
        await this.reloadFromConfig()
    }

    get isEsp32(): boolean {
        return this.installerState.selectedDevice?.fqbn === 'esp32:esp32:esp32'
    }

    get isCsb1(): boolean {
        const name = this.installerState.selectedDevice?.name ?? ''
        // Treat as CSB1 when target is ESP32 and either the device name
        // indicates EX-CSB1, the current parsed motor driver is EXCSB1,
        // or the loaded `config.h` contains MOTOR_SHIELD_TYPE EXCSB1.
        const cfgText = this.editorState?.configHContent ?? ''
        const motorFromConfig = (cfgText.match(/^#define\s+MOTOR_SHIELD_TYPE\s+(\S+)$/m) || [])[1]
        return this.isEsp32 && (
            name.includes('EX-CSB1') ||
            name.toUpperCase().includes('EXCSB1') ||
            (this.opts.motorDriver?.toUpperCase().startsWith('EXCSB1') ?? false) ||
            (motorFromConfig?.toUpperCase().startsWith('EXCSB1') ?? false)
        )
    }

    get hasStackedMotorShield(): boolean {
        return this.opts.hasStackedMotorShield
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
        const initialMotorDriver = this.opts.motorDriver
        if (this.isEsp32) {
            this.opts.enableWifi = true
            this.opts.disableEeprom = true
        }
        // Load track manager settings from myAutomation.h if present
        const automationFile = this.installerState.configFiles.find(f => f.name === 'myAutomation.h')
        if (automationFile != null) {
            const trackManagerOpts = parseMyAutomationTrackManager(automationFile.content)
            Object.assign(this.opts, trackManagerOpts)
        }
        this.syncCsb1MotorShieldDriver()

        // If stacked-shield state inferred from myAutomation changes the CSB1 driver,
        // persist the normalized value so dropdown and config.h stay consistent.
        if (this.opts.motorDriver !== initialMotorDriver) {
            this.editorState.configHContent = generateCommandStationConfig(this.opts)
            this.editorState.syncConfigH()
        }
    }

    async attached(): Promise<void> {
        await this.loadMotorDrivers()
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
        this.sfMotorDriver?.destroy()
        this.sfDisplay?.destroy()
        this.sfScrollMode?.destroy()
        this.sfEnableWifi?.destroy()
        this.sfEnableEthernet?.destroy()
        this.sfEnablePowerOnStart?.destroy()
        this.sfDisableEeprom?.destroy()
        this.sfDisableProg?.destroy()
        this.sfWifiModeAp?.destroy()
        this.sfWifiModeSta?.destroy()
        this.sfWifiHostname?.destroy()
        this.sfWifiSsid?.destroy()
        this.sfWifiPassword?.destroy()
        this.sfWifiChannel?.destroy()
        this.sfResetWifiBtn?.destroy()
        // TrackManager
        this.sfHasStackedMotorShield?.destroy()
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
        // Re-parse config.h into current options so `isCsb1` and
        // `motorDrivers` reflect values from the loaded `config.h`.
        try {
            Object.assign(this.opts, parseCommandStationConfig(this.editorState.configHContent))
        } catch {
            // parsing failure -> keep existing opts
        }
        await this.loadMotorDrivers()
        // Destroy existing controls and re-initialise so new motor driver
        // selections and CSB1 detection take effect.
        this.destroySfControls()
        this.initSfControls()
    }

    private initSfControls(): void {
        // ── General tab ──────────────────────────────────────────────────────

        this.sfMotorDriver = new DropDownList({
            dataSource: this.motorDrivers,
            value: this.opts.motorDriver,
            change: (args) => {
                this.opts.motorDriver = args.value as string
                if (this.isCsb1) {
                    this.opts.hasStackedMotorShield = this.opts.motorDriver === 'EXCSB1_WITH_EX8874'
                }
                this.onFieldChange()
                this.csbTick = (this.csbTick || 0) + 1
                void this.reloadFromConfig()
            },
        })
        this.sfMotorDriver.appendTo(this.motorDriverEl)

        this.sfDisplay = new DropDownList({
            dataSource: this.displays.map((d) => ({ text: d.label, value: d.value })),
            fields: { text: 'text', value: 'value' },
            value: this.opts.display,
            change: (args) => {
                this.opts.display = args.value as string
                this.onFieldChange()
            },
        })
        this.sfDisplay.appendTo(this.displayEl)

        this.sfScrollMode = new DropDownList({
            dataSource: this.scrollModes.map((s) => ({ text: s.label, value: s.value })),
            fields: { text: 'text', value: 'value' },
            value: this.opts.scrollMode,
            change: (args) => {
                this.opts.scrollMode = args.value as number
                this.onFieldChange()
            },
        })
        this.sfScrollMode.appendTo(this.scrollModeEl)

        if (this.enableWifiEl) {
            this.sfEnableWifi = new CheckBox({
                label: 'Enable WiFi',
                checked: this.opts.enableWifi,
                change: (args) => {
                    this.opts.enableWifi = args.checked
                    this.onWifiToggle()
                },
            })
            this.sfEnableWifi.appendTo(this.enableWifiEl)
        }

        if (this.enableEthernetEl) {
            this.sfEnableEthernet = new CheckBox({
                label: 'Enable Ethernet',
                checked: this.opts.enableEthernet,
                change: (args) => {
                    this.opts.enableEthernet = args.checked
                    this.onEthernetToggle()
                },
            })
            this.sfEnableEthernet.appendTo(this.enableEthernetEl)
        }

        this.sfEnablePowerOnStart = new CheckBox({
            label: 'Start with power on',
            checked: this.opts.enablePowerOnStart,
            change: (args) => {
                this.opts.enablePowerOnStart = args.checked
                this.onFieldChange()
            },
        })
        this.sfEnablePowerOnStart.appendTo(this.enablePowerOnStartEl)

        if (this.disableEepromEl) {
            this.sfDisableEeprom = new CheckBox({
                label: 'Disable EEPROM support',
                checked: this.opts.disableEeprom,
                change: (args) => {
                    this.opts.disableEeprom = args.checked
                    this.onFieldChange()
                },
            })
            this.sfDisableEeprom.appendTo(this.disableEepromEl)
        }

        this.sfDisableProg = new CheckBox({
            label: 'Disable programming track support',
            checked: this.opts.disableProg,
            change: (args) => {
                this.opts.disableProg = args.checked
                this.onFieldChange()
            },
        })
        this.sfDisableProg.appendTo(this.disableProgEl)

        // ── WiFi tab ─────────────────────────────────────────────────────────

        this.sfWifiModeAp = new RadioButton({
            label: 'Access Point (create network)',
            name: 'wifiMode',
            value: 'ap',
            checked: this.opts.wifiMode === 'ap',
            change: () => {
                this.opts.wifiMode = 'ap'
                this.onFieldChange()
            },
        })
        this.sfWifiModeAp.appendTo(this.wifiModeApEl)

        this.sfWifiModeSta = new RadioButton({
            label: 'Station (join existing network)',
            name: 'wifiMode',
            value: 'sta',
            checked: this.opts.wifiMode === 'sta',
            change: () => {
                this.opts.wifiMode = 'sta'
                this.onFieldChange()
            },
        })
        this.sfWifiModeSta.appendTo(this.wifiModeStaEl)

        this.sfWifiHostname = new TextBox({
            value: this.opts.wifiHostname,
            placeholder: 'dccex',
            change: (args) => {
                this.opts.wifiHostname = args.value ?? ''
                this.onFieldChange()
            },
        })
        this.sfWifiHostname.appendTo(this.wifiHostnameEl)

        this.sfWifiSsid = new TextBox({
            value: this.opts.wifiSsid,
            change: (args) => {
                this.opts.wifiSsid = args.value ?? ''
                this.onFieldChange()
            },
        })
        this.sfWifiSsid.appendTo(this.wifiSsidEl)

        this.sfWifiPassword = new TextBox({
            value: this.opts.wifiPassword,
            type: 'password',
            change: (args) => {
                this.opts.wifiPassword = args.value ?? ''
                this.onFieldChange()
            },
        })
        this.sfWifiPassword.appendTo(this.wifiPasswordEl)

        this.sfWifiChannel = new NumericTextBox({
            min: 1,
            max: 11,
            format: 'n0',
            value: this.opts.wifiChannel,
            change: (args) => {
                if (args.value != null) this.opts.wifiChannel = args.value
                this.onFieldChange()
            },
        })
        this.sfWifiChannel.appendTo(this.wifiChannelEl)

        this.sfResetWifiBtn = new Button({ content: 'Reset to defaults', cssClass: 'e-small' })
        this.sfResetWifiBtn.appendTo(this.resetWifiBtnEl)
        this.resetWifiBtnEl.addEventListener('click', () => this.resetWifiToDefaults())

        // ── TrackManager tab ─────────────────────────────────────────────────

        // Stacked motor shield option (CSB1 only)
        if (this.hasStackedMotorShieldEl) {
            this.sfHasStackedMotorShield = new CheckBox({
                label: 'Has stacked motor shield',
                checked: this.opts.hasStackedMotorShield,
                change: (args) => {
                    this.opts.hasStackedMotorShield = args.checked
                    this.syncCsb1MotorShieldDriver()
                    this.onFieldChange()
                },
            })
            this.sfHasStackedMotorShield.appendTo(this.hasStackedMotorShieldEl)
        }

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

    private syncSfWifiValues(): void {
        if (this.sfWifiHostname) this.sfWifiHostname.value = this.opts.wifiHostname
        if (this.sfWifiSsid) this.sfWifiSsid.value = this.opts.wifiSsid
        if (this.sfWifiPassword) this.sfWifiPassword.value = this.opts.wifiPassword
        if (this.sfWifiChannel) this.sfWifiChannel.value = this.opts.wifiChannel
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

    private async loadMotorDrivers(): Promise<void> {
        const repoPath = this.installerState.repoPath
        if (repoPath) {
            try {
                const content = await this.fileService.readFile(`${repoPath}/MotorDrivers.h`)
                const found: string[] = []
                const re = /^.+?\s(\w+)\s+F\("/gm
                let m: RegExpExecArray | null
                while ((m = re.exec(content)) !== null) {
                    found.push(m[1])
                }
                if (found.length > 0) {
                    this.motorDrivers = this.isCsb1
                        ? found.filter((d) => d.toUpperCase().startsWith('EXCSB1'))
                        : found.filter((d) => !d.toUpperCase().startsWith('EXCSB1'))
                }
            } catch {
                // fall through to defaults below
            }
        }
        if (this.motorDrivers.length === 0) {
            this.motorDrivers = this.isCsb1 ? FALLBACK_DRIVERS_CSB1 : FALLBACK_DRIVERS_GENERIC
        }
        if (!this.motorDrivers.includes(this.opts.motorDriver)) {
            this.motorDrivers = [this.opts.motorDriver, ...this.motorDrivers]
        }
    }

    setConfigTab(tab: ConfigTab): void {
        this.activeConfigTab = tab
    }

    resetWifiToDefaults(): void {
        this.opts.wifiSsid = ''
        this.opts.wifiPassword = ''
        this.opts.wifiChannel = 1
        this.syncSfWifiValues()
        this.onFieldChange()
    }

    private syncCsb1MotorShieldDriver(): void {
        const csb1DriverSelected = this.opts.motorDriver.toUpperCase().startsWith('EXCSB1')
        if (!this.isCsb1 && !csb1DriverSelected && !this.opts.hasStackedMotorShield) return

        if (this.opts.hasStackedMotorShield) {
            this.opts.motorDriver = 'EXCSB1_WITH_EX8874'
        } else if (this.opts.motorDriver === 'EXCSB1_WITH_EX8874') {
            this.opts.motorDriver = 'EXCSB1'
        }

        if (this.sfMotorDriver && this.sfMotorDriver.value !== this.opts.motorDriver) {
            this.sfMotorDriver.value = this.opts.motorDriver
        }
    }

    onFieldChange(): void {
        if (this.opts.enableWifi) this.opts.enableEthernet = false
        if (this.isEsp32) {
            this.opts.enableWifi = true
            this.opts.disableEeprom = true
        }
        this.syncCsb1MotorShieldDriver()
        // Startup power mode drives whether POWERON/SET_POWER should be emitted.
        // If "all" is selected, always generate startup power commands.
        if (this.opts.startupPowerMode === 'all') {
            this.opts.enablePowerOnStart = true
        }
        if (this.opts.wifiChannel < 1) this.opts.wifiChannel = 1
        if (this.opts.wifiChannel > 11) this.opts.wifiChannel = 11

        this.editorState.configHContent = generateCommandStationConfig(this.opts)
        this.editorState.syncConfigH()
        // Generate and sync track manager automation content
        const automationOpts: MyAutomationOptions = {
            enablePowerOnStart: this.opts.enablePowerOnStart,
            hasStackedMotorShield: this.opts.hasStackedMotorShield,
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

    onWifiToggle(): void {
        if (this.opts.enableWifi) this.opts.enableEthernet = false
        this.onFieldChange()
    }

    onEthernetToggle(): void {
        if (this.opts.enableEthernet) this.opts.enableWifi = false
        this.onFieldChange()
    }
}
