import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { ArduinoCliService } from '../services/arduino-cli.service'
import { basePlatforms, extraPlatforms, requiredLibraries } from '../models/product-details'

export class ManageCli {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly cli = resolve(ArduinoCliService)

    cliInstalled = false
    cliVersion = ''
    busy = false
    statusMessage = ''
    progressPercent = 0
    error: string | null = null
    installEsp32 = false
    installStm32 = false

    async binding(): Promise<void> {
        await this.checkCli()
    }

    private async checkCli(): Promise<void> {
        try {
            this.cliInstalled = await this.cli.isInstalled()
            if (this.cliInstalled) {
                const ver = await this.cli.getVersion()
                this.cliVersion = ver ?? 'unknown'
                this.state.cliReady = true
            }
        } catch {
            this.cliInstalled = false
        }
    }

    async installOrRefresh(): Promise<void> {
        this.busy = true
        this.error = null
        this.progressPercent = 0

        try {
            if (!this.cliInstalled) {
                this.statusMessage = 'Downloading Arduino CLI...'
                this.progressPercent = 10
                const dlResult = await this.cli.downloadCli()
                if (!dlResult.success) throw new Error(dlResult.error)
                this.progressPercent = 30
            }

            // Init config
            this.statusMessage = 'Initializing configuration...'
            this.progressPercent = 40
            const initResult = await this.cli.initConfig()
            if (!initResult.success) throw new Error(initResult.error)

            // Update index
            this.statusMessage = 'Updating board index...'
            this.progressPercent = 50
            const updateResult = await this.cli.updateIndex()
            if (!updateResult.success) throw new Error(updateResult.error)

            // Install base platforms
            let progress = 55
            for (const [platform, version] of Object.entries(basePlatforms)) {
                this.statusMessage = `Installing ${platform}...`
                this.progressPercent = progress
                await this.cli.installPlatform(platform, version)
                progress += 10
            }

            // Install extra platforms
            if (this.installEsp32) {
                this.statusMessage = 'Installing ESP32 platform...'
                this.progressPercent = progress
                await this.cli.installPlatform('esp32:esp32', extraPlatforms['esp32:esp32'])
                progress += 10
            }
            if (this.installStm32) {
                this.statusMessage = 'Installing STM32 platform...'
                this.progressPercent = progress
                await this.cli.installPlatform('STMicroelectronics:stm32', extraPlatforms['STMicroelectronics:stm32'])
                progress += 10
            }

            // Install libraries
            for (const [lib, version] of Object.entries(requiredLibraries)) {
                this.statusMessage = `Installing library ${lib}...`
                this.progressPercent = Math.min(progress, 90)
                await this.cli.installLibrary(lib, version)
                progress += 5
            }

            this.progressPercent = 100
            this.statusMessage = 'Setup complete!'
            await this.checkCli()
        } catch (err) {
            this.error = (err as Error).message
        } finally {
            this.busy = false
        }
    }

    goBack(): void {
        this.router.load('welcome')
    }

    goNext(): void {
        this.router.load('select-device')
    }
}
