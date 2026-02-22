import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { generateIOExpanderConfig } from '../config/ioexpander'

export class IoexpanderConfig {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)

    i2cAddress = 0x65
    disableI2cPullups = false

    diagAnalogue = false
    diagInput = false
    diagOutput = false
    diagPullup = false

    error: string | null = null

    get i2cAddressHex(): string {
        return '0x' + this.i2cAddress.toString(16).toUpperCase()
    }

    decrementAddress(): void {
        if (this.i2cAddress > 0x08) {
            this.i2cAddress--
        }
    }

    incrementAddress(): void {
        if (this.i2cAddress < 0x77) {
            this.i2cAddress++
        }
    }

    /** Only one test mode can be active */
    diagAnalogueChanged(): void {
        if (this.diagAnalogue) {
            this.diagInput = false
            this.diagOutput = false
            this.diagPullup = false
        }
    }

    diagInputChanged(): void {
        if (this.diagInput) {
            this.diagAnalogue = false
            this.diagOutput = false
            this.diagPullup = false
        }
    }

    diagOutputChanged(): void {
        if (this.diagOutput) {
            this.diagAnalogue = false
            this.diagInput = false
            this.diagPullup = false
        }
    }

    diagPullupChanged(): void {
        if (this.diagPullup) {
            this.diagAnalogue = false
            this.diagInput = false
            this.diagOutput = false
        }
    }

    goBack(): void {
        this.router.load('select-version')
    }

    goNext(): void {
        if (this.i2cAddress < 0x08 || this.i2cAddress > 0x77) {
            this.error = 'I\u00B2C address must be between 0x08 and 0x77'
            return
        }
        this.error = null

        let testMode: string | null = null
        if (this.diagAnalogue) testMode = 'ANALOGUE_TEST'
        else if (this.diagInput) testMode = 'INPUT_TEST'
        else if (this.diagOutput) testMode = 'OUTPUT_TEST'
        else if (this.diagPullup) testMode = 'PULLUP_TEST'

        const content = generateIOExpanderConfig({
            i2cAddress: this.i2cAddress,
            disablePullups: this.disableI2cPullups,
            testMode,
        })

        this.state.configFiles = [
            { name: 'myConfig.h', content },
        ]

        this.router.load('compile-upload')
    }
}
