import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { GitService } from '../services/git.service'
import { FileService } from '../services/file.service'
import { productDetails, extractVersionDetails } from '../models/product-details'

export class SelectVersion {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly git = resolve(GitService)
    private readonly files = resolve(FileService)

    versions: string[] = []
    latestProd: string | null = null
    latestDevel: string | null = null
    versionChoice = 'prod'
    selectedTag = ''
    configSource = 'new'
    configDir = ''
    busy = false
    statusMessage = ''
    error: string | null = null

    get productName(): string {
        const key = this.state.selectedProduct
        return key ? (productDetails[key]?.productName ?? key) : ''
    }

    get selectedVersion(): string | null {
        if (this.versionChoice === 'prod') return this.latestProd
        if (this.versionChoice === 'devel') return this.latestDevel
        return this.selectedTag || null
    }

    async binding(): Promise<void> {
        await this.setupRepo()
    }

    private async setupRepo(): Promise<void> {
        const product = productDetails[this.state.selectedProduct ?? '']
        if (!product) return

        this.busy = true
        this.error = null

        try {
            const reposDir = await this.files.getInstallDir('repos')
            const repoPath = `${reposDir}/${product.repoName.split('/')[1]}`
            this.state.repoPath = repoPath

            const repoExists = await this.files.exists(`${repoPath}/.git`)

            if (repoExists) {
                this.statusMessage = 'Pulling latest changes...'
                await this.git.pull(repoPath)
            } else {
                this.statusMessage = 'Cloning repository...'
                await this.git.clone(product.repoUrl, repoPath, product.defaultBranch)
            }

            this.statusMessage = 'Loading versions...'
            const tags = await this.git.listTags(repoPath)

            // Sort versions: newest first
            this.versions = tags.sort((a, b) => {
                const va = extractVersionDetails(a)
                const vb = extractVersionDetails(b)
                if (va.major !== vb.major) return vb.major - va.major
                if (va.minor !== vb.minor) return vb.minor - va.minor
                return vb.patch - va.patch
            })

            // Find latest prod and devel
            this.latestProd = this.versions.find((t) => extractVersionDetails(t).type === 'Prod') ?? null
            this.latestDevel = this.versions.find((t) => extractVersionDetails(t).type === 'Devel') ?? null

            if (!this.latestProd && this.versions.length > 0) {
                this.latestProd = this.versions[0]
            }
        } catch (err) {
            this.error = (err as Error).message
        } finally {
            this.busy = false
        }
    }

    async browseConfigDir(): Promise<void> {
        const dir = await this.files.selectDirectory()
        if (dir) this.configDir = dir
    }

    goBack(): void {
        this.router.load('select-product')
    }

    async goNext(): Promise<void> {
        if (!this.selectedVersion || !this.state.repoPath) return

        this.state.selectedVersion = this.selectedVersion
        this.state.useExistingConfig = this.configSource === 'existing'

        // Checkout selected version
        this.busy = true
        this.statusMessage = 'Checking out version...'
        try {
            await this.git.checkout(this.state.repoPath, this.selectedVersion)
        } catch {
            // If checkout fails (detached head etc), try with tag
            await this.git.checkout(this.state.repoPath, `tags/${this.selectedVersion}`)
        }
        this.busy = false

        // Navigate to product-specific config
        const product = this.state.selectedProduct
        if (product === 'ex_commandstation') {
            this.router.load('commandstation-config')
        } else if (product === 'ex_ioexpander') {
            this.router.load('ioexpander-config')
        } else if (product === 'ex_turntable') {
            this.router.load('turntable-config')
        }
    }
}
