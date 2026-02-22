import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { FileService } from '../services/file.service'
import { productDetails } from '../models/product-details'

export class AdvancedConfig {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly files = resolve(FileService)

    productName = ''
    configFiles: Array<{ name: string; content: string }> = []
    activeFile = ''
    error: string | null = null

    async binding(): Promise<void> {
        const product = this.state.selectedProduct
        if (!product || !productDetails[product]) {
            this.error = 'No product selected'
            return
        }

        this.productName = productDetails[product].productName

        // If config files already generated (from the config page), use them
        if (this.state.configFiles.length > 0) {
            this.configFiles = this.state.configFiles.map((f) => ({ ...f }))
        } else if (this.state.repoPath) {
            // "Use existing config" path — load config files from disk
            const detail = productDetails[product]
            for (const fileName of detail.minimumConfigFiles) {
                const filePath = `${this.state.repoPath}/${fileName}`
                try {
                    const exists = await this.files.exists(filePath)
                    if (exists) {
                        const content = await this.files.readFile(filePath)
                        this.configFiles.push({ name: fileName, content })
                    }
                } catch {
                    // skip files that can't be read
                }
            }

            // Also look for myAutomation.h etc via patterns
            if (detail.otherConfigFilePatterns && this.state.repoPath) {
                try {
                    const allFiles = await this.files.listDir(this.state.repoPath)
                    for (const pattern of detail.otherConfigFilePatterns) {
                        const re = new RegExp(pattern)
                        for (const f of allFiles) {
                            if (re.test(f) && !this.configFiles.some((c) => c.name === f)) {
                                try {
                                    const content = await this.files.readFile(`${this.state.repoPath}/${f}`)
                                    this.configFiles.push({ name: f, content })
                                } catch {
                                    // skip
                                }
                            }
                        }
                    }
                } catch {
                    // ignore dir listing failures
                }
            }
        }

        if (this.configFiles.length > 0) {
            this.activeFile = this.configFiles[0].name
        }
    }

    goBack(): void {
        const product = this.state.selectedProduct
        if (this.state.useExistingConfig) {
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

    async goNext(): Promise<void> {
        this.error = null

        // Save edited content back to state
        this.state.configFiles = this.configFiles.map((f) => ({ ...f }))

        // Write files to disk
        if (this.state.repoPath) {
            for (const f of this.configFiles) {
                try {
                    await this.files.writeFile(`${this.state.repoPath}/${f.name}`, f.content)
                } catch (err) {
                    this.error = `Could not write ${f.name}: ${(err as Error).message}`
                    return
                }
            }
        }

        this.router.load('compile-upload')
    }
}
