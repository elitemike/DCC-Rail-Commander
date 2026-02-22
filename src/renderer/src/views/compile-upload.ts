import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { ArduinoCliService } from '../services/arduino-cli.service'
import { FileService } from '../services/file.service'
import { productDetails } from '../models/product-details'

export class CompileUpload {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly cli = resolve(ArduinoCliService)
    private readonly files = resolve(FileService)

    statusMessage = ''
    successMessage = ''
    successDetail = ''
    progressPhase = ''
    progressPercent = 0
    logOutput = ''
    error: string | null = null
    isRunning = false
    uploadDone = false
    showMonitor = false

    logContainer!: HTMLElement

    binding(): void {
        const product = this.state.selectedProduct
        const device = this.state.selectedDevice
        if (product && device && productDetails[product]) {
            this.statusMessage = `${productDetails[product].productName} is ready to be loaded on to your ${device.name} attached to ${device.port}`
        } else {
            this.statusMessage = 'Ready to compile and upload.'
        }
    }

    async startCompileUpload(): Promise<void> {
        const device = this.state.selectedDevice
        const product = this.state.selectedProduct
        if (!device || !product || !this.state.repoPath) {
            this.error = 'Missing device, product, or repo path.'
            return
        }

        this.error = null
        this.isRunning = true
        this.uploadDone = false
        this.successMessage = ''
        this.successDetail = ''
        this.logOutput = ''

        const fqbn = device.fqbn
        const port = device.port
        const sketchPath = this.state.repoPath
        const productName = productDetails[product].productName

        // Write config files to disk first (if not already written by advanced-config)
        if (!this.state.advancedConfig && this.state.configFiles.length > 0) {
            for (const f of this.state.configFiles) {
                try {
                    await this.files.writeFile(`${sketchPath}/${f.name}`, f.content)
                } catch (err) {
                    this.error = `Failed to write ${f.name}: ${(err as Error).message}`
                    this.isRunning = false
                    return
                }
            }
        }

        // Compile
        this.progressPhase = `Compiling ${productName}...`
        this.progressPercent = 30

        try {
            const compileResult = await this.cli.compile(sketchPath, fqbn)
            if (!compileResult.success) {
                this.logOutput = compileResult.output ?? 'Compilation failed.'
                this.error = 'Compilation failed. Check the output above.'
                this.isRunning = false
                return
            }
            this.logOutput += (compileResult.output ?? 'Compilation successful.\n')
        } catch (err) {
            this.error = `Compilation error: ${(err as Error).message}`
            this.isRunning = false
            return
        }

        // Upload
        this.progressPhase = `Uploading to ${device.name}...`
        this.progressPercent = 70

        try {
            const uploadResult = await this.cli.upload(sketchPath, fqbn, port)
            if (!uploadResult.success) {
                this.logOutput += '\n' + (uploadResult.output ?? 'Upload failed.')
                this.error = 'Upload failed. Check the output above.'
                this.isRunning = false
                return
            }
            this.logOutput += '\n' + (uploadResult.output ?? 'Upload successful.\n')
        } catch (err) {
            this.error = `Upload error: ${(err as Error).message}`
            this.isRunning = false
            return
        }

        this.progressPercent = 100
        this.progressPhase = 'Done!'
        this.isRunning = false
        this.uploadDone = true
        this.successMessage = 'Congratulations!'
        this.successDetail = `${productName} has been successfully loaded on to your ${device.name}.`
    }

    async backupConfig(): Promise<void> {
        if (!this.state.repoPath) return
        try {
            const destDir = await this.files.selectDirectory()
            if (!destDir) return

            for (const f of this.state.configFiles) {
                await this.files.writeFile(`${destDir}/${f.name}`, f.content)
            }
        } catch (err) {
            this.error = `Backup failed: ${(err as Error).message}`
        }
    }

    toggleMonitor(): void {
        this.showMonitor = !this.showMonitor
    }

    goBack(): void {
        const product = this.state.selectedProduct
        if (this.state.advancedConfig) {
            this.router.load('advanced-config')
        } else if (this.state.useExistingConfig) {
            this.router.load('select-version')
        } else if (product === 'ex_commandstation') {
            this.router.load('commandstation-config')
        } else if (product === 'ex_ioexpander') {
            this.router.load('ioexpander-config')
        } else if (product === 'ex_turntable') {
            this.router.load('turntable-config')
        } else {
            this.router.load('select-version')
        }
    }

    closeApp(): void {
        window.close()
    }
}
