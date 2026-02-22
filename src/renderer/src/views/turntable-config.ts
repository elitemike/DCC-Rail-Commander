import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { FileService } from '../services/file.service'
import { generateTurntableConfig } from '../config/turntable'

export class TurntableConfig {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly files = resolve(FileService)

    tabs = ['General', 'Stepper Options', 'Advanced']
    activeTab = 'General'

    // General
    i2cAddress = 0x60
    mode: 'TURNTABLE' | 'TRAVERSER' = 'TURNTABLE'
    phaseSwitching: 'AUTO' | 'MANUAL' = 'AUTO'
    phaseSwitchAngle = 45
    homeSensorActiveState: 'LOW' | 'HIGH' = 'LOW'
    limitSensorActiveState: 'LOW' | 'HIGH' = 'LOW'
    relayActiveState: 'HIGH' | 'LOW' = 'HIGH'
    sensorTesting = false

    // Stepper
    stepperDriver = ''
    stepperDrivers: string[] = []
    maxSpeed = 200
    acceleration = 25
    gearingFactor = 1
    disableOutputsIdle = true
    invertDirection = false
    invertStep = false
    invertEnable = false
    forwardOnly = false
    reverseOnly = false

    // Advanced
    enableDebug = false
    ledFast = 100
    ledSlow = 500
    sanitySteps: number | null = null
    homeSensitivity: number | null = null
    fullStepCount: number | null = null
    debounceDelay: number | null = null

    enableAdvancedConfig = false
    error: string | null = null

    get i2cAddressHex(): string {
        return '0x' + this.i2cAddress.toString(16).toUpperCase()
    }

    decrementAddress(): void {
        if (this.i2cAddress > 0x08) this.i2cAddress--
    }

    incrementAddress(): void {
        if (this.i2cAddress < 0x77) this.i2cAddress++
    }

    async binding(): Promise<void> {
        await this.loadStepperDrivers()
    }

    private async loadStepperDrivers(): Promise<void> {
        try {
            if (!this.state.repoPath) return
            const filePath = `${this.state.repoPath}/standard_steppers.h`
            const exists = await this.files.exists(filePath)
            if (!exists) {
                this.stepperDrivers = this.defaultStepperDrivers()
                return
            }
            const content = await this.files.readFile(filePath)
            const regex = /^#define\s+(\S+)\s+AccelStepper/gm
            const drivers: string[] = []
            let match: RegExpExecArray | null
            while ((match = regex.exec(content)) !== null) {
                drivers.push(match[1])
            }
            this.stepperDrivers = drivers.length > 0 ? drivers : this.defaultStepperDrivers()
        } catch {
            this.stepperDrivers = this.defaultStepperDrivers()
        }
    }

    private defaultStepperDrivers(): string[] {
        return [
            'ULN2003_HALF_CW',
            'ULN2003_HALF_CCW',
            'ULN2003_FULL_CW',
            'ULN2003_FULL_CCW',
            'A4988',
            'A4988_INV',
            'DRV8825',
            'TMC2208',
        ]
    }

    goBack(): void {
        this.router.load('select-version')
    }

    async goNext(): Promise<void> {
        const errors: string[] = []

        if (this.i2cAddress < 0x08 || this.i2cAddress > 0x77) {
            errors.push('I\u00B2C address must be between 0x08 and 0x77')
        }
        if (!this.stepperDriver) {
            errors.push('You must select a stepper driver')
        }
        if (this.maxSpeed < 10 || this.maxSpeed > 20000) {
            errors.push('Speed must be between 10 and 20000')
        }
        if (this.acceleration < 1 || this.acceleration > 1000) {
            errors.push('Acceleration must be between 1 and 1000')
        }
        if (this.gearingFactor < 1 || this.gearingFactor > 10) {
            errors.push('Gearing factor must be between 1 and 10')
        }
        if (this.phaseSwitching === 'AUTO' && (this.phaseSwitchAngle < 0 || this.phaseSwitchAngle > 180)) {
            errors.push('Phase switch angle must be between 0 and 180')
        }
        if (this.forwardOnly && this.mode === 'TRAVERSER') {
            errors.push('Traverser mode is incompatible with forward only rotation')
        }
        if (this.reverseOnly && this.mode === 'TRAVERSER') {
            errors.push('Traverser mode is incompatible with reverse only rotation')
        }

        if (errors.length > 0) {
            this.error = errors.join(', ')
            return
        }

        this.error = null

        const content = generateTurntableConfig({
            i2cAddress: this.i2cAddress,
            mode: this.mode,
            sensorTesting: this.sensorTesting,
            homeSensorActiveState: this.homeSensorActiveState,
            limitSensorActiveState: this.limitSensorActiveState,
            relayActiveState: this.relayActiveState,
            phaseSwitching: this.phaseSwitching,
            phaseSwitchAngle: this.phaseSwitchAngle,
            stepperDriver: this.stepperDriver,
            disableOutputsIdle: this.disableOutputsIdle,
            maxSpeed: this.maxSpeed,
            acceleration: this.acceleration,
            gearingFactor: this.gearingFactor,
            invertDirection: this.invertDirection,
            invertStep: this.invertStep,
            invertEnable: this.invertEnable,
            forwardOnly: this.forwardOnly,
            reverseOnly: this.reverseOnly,
            ledFast: this.ledFast,
            ledSlow: this.ledSlow,
            enableDebug: this.enableDebug,
            sanitySteps: this.sanitySteps,
            homeSensitivity: this.homeSensitivity,
            fullStepCount: this.fullStepCount,
            debounceDelay: this.debounceDelay,
        })

        this.state.configFiles = [
            { name: 'config.h', content },
        ]
        this.state.advancedConfig = this.enableAdvancedConfig

        if (this.enableAdvancedConfig) {
            this.router.load('advanced-config')
        } else {
            this.router.load('compile-upload')
        }
    }
}
