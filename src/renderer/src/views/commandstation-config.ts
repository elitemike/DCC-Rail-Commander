import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { FileService } from '../services/file.service'
import { generateCommandStationConfig, generateMyAutomation } from '../config/commandstation'

export class CommandstationConfig {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly files = resolve(FileService)

    motorDriver = ''
    motorDrivers: string[] = []
    display = 'NONE'
    displayOptions = [
        { label: 'None', value: 'NONE' },
        { label: 'OLED 128x32', value: 'OLED_128x32' },
        { label: 'OLED 128x64', value: 'OLED_128x64' },
        { label: 'LCD 16x2', value: 'LCD_16x2' },
        { label: 'LCD 20x4', value: 'LCD_20x4' },
    ]

    enableWifi = false
    wifiMode = 'ap'
    wifiSsid = ''
    wifiPassword = ''
    wifiChannel = 1

    trackModes = [
        { label: 'MAIN (DCC)', value: 'MAIN' },
        { label: 'PROG (Programming)', value: 'PROG' },
        { label: 'DC', value: 'DC' },
        { label: 'DC reversed (DCX)', value: 'DCX' },
        { label: 'NONE', value: 'NONE' },
    ]
    trackAMode = 'MAIN'
    trackBMode = 'PROG'
    trackALocoId = 3
    trackBLocoId = 3

    enablePowerOnStart = false
    disableEeprom = false
    enableAdvancedConfig = false

    error: string | null = null

    async binding(): Promise<void> {
        await this.loadMotorDrivers()

        // Auto-configure based on device
        const fqbn = this.state.selectedDevice?.fqbn ?? ''
        if (fqbn.includes('esp32')) {
            this.enableWifi = true
            this.disableEeprom = true
        } else if (fqbn.includes('stm32')) {
            this.disableEeprom = true
        }
    }

    private async loadMotorDrivers(): Promise<void> {
        try {
            if (!this.state.repoPath) return
            const filePath = `${this.state.repoPath}/MotorDrivers.h`
            const exists = await this.files.exists(filePath)
            if (!exists) {
                this.motorDrivers = ['STANDARD_MOTOR_SHIELD', 'POLOLU_MOTOR_SHIELD', 'FIREBOX_MK1', 'FIREBOX_MK1S', 'IBT_2_WITH_ARDUINO', 'EX8874_SHIELD']
                return
            }
            const content = await this.files.readFile(filePath)
            const regex = /^#define\s+(\w+)\s+F\(\s*"/gm
            const drivers: string[] = []
            let match: RegExpExecArray | null
            while ((match = regex.exec(content)) !== null) {
                if (!match[1].startsWith('__') && !match[1].includes('ACTIVE'))
                    drivers.push(match[1])
            }
            this.motorDrivers = drivers.length > 0 ? drivers
                : ['STANDARD_MOTOR_SHIELD', 'POLOLU_MOTOR_SHIELD', 'FIREBOX_MK1', 'FIREBOX_MK1S', 'IBT_2_WITH_ARDUINO', 'EX8874_SHIELD']
        } catch {
            this.motorDrivers = ['STANDARD_MOTOR_SHIELD', 'POLOLU_MOTOR_SHIELD']
        }
    }

    goBack(): void {
        this.router.load('select-version')
    }

    async goNext(): Promise<void> {
        if (!this.motorDriver) {
            this.error = 'Please select a motor driver.'
            return
        }
        this.error = null

        const configContent = generateCommandStationConfig({
            motorDriver: this.motorDriver,
            display: this.display,
            enableWifi: this.enableWifi,
            wifiMode: this.wifiMode,
            wifiSsid: this.wifiSsid,
            wifiPassword: this.wifiPassword,
            wifiChannel: this.wifiChannel,
            trackAMode: this.trackAMode,
            trackBMode: this.trackBMode,
            trackALocoId: this.trackALocoId,
            trackBLocoId: this.trackBLocoId,
            enablePowerOnStart: this.enablePowerOnStart,
            disableEeprom: this.disableEeprom,
        })

        const myAutoContent = generateMyAutomation({
            enablePowerOnStart: this.enablePowerOnStart,
            trackAMode: this.trackAMode,
            trackBMode: this.trackBMode,
            trackALocoId: this.trackALocoId,
            trackBLocoId: this.trackBLocoId,
        })

        this.state.configFiles = [
            { name: 'config.h', content: configContent },
            { name: 'myAutomation.h', content: myAutoContent },
        ]
        this.state.advancedConfig = this.enableAdvancedConfig

        if (this.enableAdvancedConfig) {
            this.router.load('advanced-config')
        } else {
            this.router.load('compile-upload')
        }
    }
}
