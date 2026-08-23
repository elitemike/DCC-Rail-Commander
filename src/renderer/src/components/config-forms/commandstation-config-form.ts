import { resolve, observable } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'
import { FileService } from '../../services/file.service'
import {
    type CommandStationConfigOptions,
    defaultCommandStationConfig,
    parseCommandStationConfig,
    generateCommandStationConfig,
    reconcileTrackManagerContent,
} from '../../config/commandstation'
import { TextBox, NumericTextBox } from '@syncfusion/ej2-inputs'
import { CheckBox, RadioButton, Button } from '@syncfusion/ej2-buttons'
import { DropDownList } from '@syncfusion/ej2-dropdowns'

type ConfigTab = 'general' | 'wifi'

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

    // Element refs set by Aurelia template ref binding
    motorDriverEl!: HTMLInputElement
    displayEl!: HTMLInputElement
    scrollModeEl!: HTMLInputElement
    enableWifiEl?: HTMLInputElement         // conditional: if.bind="!isCsb1"
    enableEthernetEl?: HTMLInputElement     // conditional: if.bind="!isEsp32"
    disableEepromEl?: HTMLInputElement      // conditional: if.bind="!isCsb1"
    disableProgEl!: HTMLInputElement
    wifiModeApEl!: HTMLInputElement
    wifiModeStaEl!: HTMLInputElement
    wifiHostnameEl!: HTMLInputElement
    wifiSsidEl!: HTMLInputElement
    wifiPasswordEl!: HTMLInputElement
    wifiChannelEl!: HTMLInputElement
    resetWifiBtnEl!: HTMLButtonElement

    // SF instances
    private sfMotorDriver?: DropDownList
    private sfDisplay?: DropDownList
    private sfScrollMode?: DropDownList
    private sfEnableWifi?: CheckBox
    private sfEnableEthernet?: CheckBox
    private sfDisableEeprom?: CheckBox
    private sfDisableProg?: CheckBox
    private sfWifiModeAp?: RadioButton
    private sfWifiModeSta?: RadioButton
    private sfWifiHostname?: TextBox
    private sfWifiSsid?: TextBox
    private sfWifiPassword?: TextBox
    private sfWifiChannel?: NumericTextBox
    private sfResetWifiBtn?: Button
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

    binding(): void {
        Object.assign(this.opts, parseCommandStationConfig(this.editorState.configHContent))
        if (this.isEsp32) {
            this.opts.enableWifi = true
            this.opts.disableEeprom = true
        }
        this.syncCsb1MotorShieldDriver()
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
        this.sfDisableEeprom?.destroy()
        this.sfDisableProg?.destroy()
        this.sfWifiModeAp?.destroy()
        this.sfWifiModeSta?.destroy()
        this.sfWifiHostname?.destroy()
        this.sfWifiSsid?.destroy()
        this.sfWifiPassword?.destroy()
        this.sfWifiChannel?.destroy()
        this.sfResetWifiBtn?.destroy()
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
    }

    private syncSfWifiValues(): void {
        if (this.sfWifiHostname) this.sfWifiHostname.value = this.opts.wifiHostname
        if (this.sfWifiSsid) this.sfWifiSsid.value = this.opts.wifiSsid
        if (this.sfWifiPassword) this.sfWifiPassword.value = this.opts.wifiPassword
        if (this.sfWifiChannel) this.sfWifiChannel.value = this.opts.wifiChannel
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
        if (this.opts.wifiChannel < 1) this.opts.wifiChannel = 1
        if (this.opts.wifiChannel > 11) this.opts.wifiChannel = 11

        this.editorState.configHContent = generateCommandStationConfig(this.opts)
        this.editorState.syncConfigH()

        // Keep myStartup.h's TrackManager block (Track C/D) in sync with the
        // motor driver here — the Startup row's TrackManager form is a
        // separate, independently-mounted component and won't otherwise learn
        // that the driver (and therefore hasStackedMotorShield) changed.
        const startupFile = this.installerState.configFiles.find(f => f.name === 'myStartup.h')
        this.editorState.syncTrackManager(
            reconcileTrackManagerContent(this.editorState.configHContent, startupFile?.content ?? ''),
        )
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
