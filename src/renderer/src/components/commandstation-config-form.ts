import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import { InstallerState } from '../models/installer-state'
import { FileService } from '../services/file.service'
import {
    type CommandStationConfigOptions,
    defaultCommandStationConfig,
    parseCommandStationConfig,
    generateCommandStationConfig,
} from '../config/commandstation'

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

const FALLBACK_DRIVERS_CSB1 = ['EXCSB1', 'EXCSB1_PROG']

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

    get isEsp32(): boolean {
        return this.installerState.selectedDevice?.fqbn === 'esp32:esp32:esp32'
    }

    get isCsb1(): boolean {
        const name = this.installerState.selectedDevice?.name ?? ''
        return this.isEsp32 && (name.includes('EX-CSB1') || name.toUpperCase().includes('EXCSB1'))
    }

    async attached(): Promise<void> {
        this.opts = parseCommandStationConfig(this.editorState.configHContent)
        if (this.isEsp32) {
            this.opts.enableWifi = true
            this.opts.disableEeprom = true
        }
        await this.loadMotorDrivers()
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
                        ? found.filter(d => d.toUpperCase().startsWith('EXCSB1'))
                        : found.filter(d => !d.toUpperCase().startsWith('EXCSB1'))
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

    onFieldChange(): void {
        if (this.opts.enableWifi) this.opts.enableEthernet = false
        if (this.isEsp32) {
            this.opts.enableWifi = true
            this.opts.disableEeprom = true
        }
        if (this.opts.wifiChannel < 1) this.opts.wifiChannel = 1
        if (this.opts.wifiChannel > 11) this.opts.wifiChannel = 11

        this.editorState.configHContent = generateCommandStationConfig(this.opts)
        this.editorState.syncConfigH()
    }

    onWifiToggle(): void {
        if (this.opts.enableWifi) this.opts.enableEthernet = false
        this.onFieldChange()
    }

    onEthernetToggle(): void {
        if (this.opts.enableEthernet) this.opts.enableWifi = false
        this.onFieldChange()
    }

    get trackAIsDc(): boolean { return this.opts.trackAMode.startsWith('DC') }
    get trackBIsDc(): boolean { return this.opts.trackBMode.startsWith('DC') }
}
