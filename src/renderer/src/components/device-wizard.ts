import { resolve } from 'aurelia'
import { IDialogController } from '@aurelia/dialog'
import { StepModel, Stepper } from '@syncfusion/ej2-navigations'
import { InstallerState } from '../models/installer-state'
import { PlatformIoService } from '../services/platformio.service'
import { UsbService } from '../services/usb.service'
import { GitService } from '../services/git.service'
import { FileService } from '../services/file.service'
import { PreferencesService } from '../services/preferences.service'
import { ConfigService } from '../services/config.service'
import { IDialogService } from '@aurelia/dialog'
import { DevicePickerDialog } from './dialogs/device-picker-dialog'
import { productDetails, sortVersionsDescending, pickLatestVersion } from '../models/product-details'
import type { DetectedBoardInfo } from '../../../types/ipc'
import type { SavedConfiguration } from '../models/saved-configuration'
import { STARTER_TEMPLATES } from '../../../types/starter-templates'
import { isProductUserFile, copyProductSourceFiles, collectExampleConfigFiles } from '../utils/product-source-files'
import { mergeDetectedBoards } from '../utils/device-scan'
import { buildScratchPath, findReusableConfig } from '../utils/board-key'

export class DeviceWizard {
    /** Injected automatically by @aurelia/dialog */
    private readonly $dialog = resolve(IDialogController)

    private readonly state = resolve(InstallerState)
    private readonly pio = resolve(PlatformIoService)
    private readonly usb = resolve(UsbService)
    private readonly git = resolve(GitService)
    private readonly files = resolve(FileService)
    private readonly preferences = resolve(PreferencesService)
    private readonly config = resolve(ConfigService)
    private readonly dialogService = resolve(IDialogService)

    // ── Wizard step (0–3) ────────────────────────────────────────────────────
    step = 0
    readonly STEP_LABELS: StepModel[] = [
        { label: 'Select Device', iconCss: 'sf-icon-cart' },
        { label: 'Select Product', iconCss: 'sf-icon-cart' },
        { label: 'Select Version', iconCss: 'sf-icon-cart' },
        { label: 'Confirm', iconCss: 'sf-icon-cart' },
    ];

    // ── Step 0: Device ───────────────────────────────────────────────────────
    boards: DetectedBoardInfo[] = []
    selectedBoard: DetectedBoardInfo | null = null
    scanning = false
    scanError: string | null = null

    // ── Step 2: Product ──────────────────────────────────────────────────────
    selectedProduct: string | null = null
    readonly products = Object.entries(productDetails).map(([key, val]) => ({
        key,
        name: val.productName,
        description: this.productDescription(key),
    }))

    // ── Step 3: Version ──────────────────────────────────────────────────────
    versions: string[] = []
    selectedVersion: string | null = null
    versionBusy = false
    versionStatus = ''
    versionError: string | null = null

    // ── Step 4: Confirm ──────────────────────────────────────────────────────
    deviceNickname = ''
    hasStackedMotorShield = false

    // ── Finishing ────────────────────────────────────────────────────────────
    finishing = false
    finishError: string | null = null

    isMock = false

    get showStackedMotorShieldOption(): boolean {
        if (this.selectedProduct !== 'ex_commandstation' || !this.selectedBoard) return false
        const boardName = this.selectedBoard.name.toUpperCase()
        return boardName.includes('EX-CSB1') || boardName.includes('EXCSB1')
    }

    // ── Syncfusion Stepper ───────────────────────────────────────────────────
    stepperContainer!: HTMLElement
    private sfStepper?: Stepper

    private syncStepper(): void {
        if (this.sfStepper) this.sfStepper.activeStep = this.step
    }

    // ── Lifecycle ────────────────────────────────────────────────────────
    async binding(): Promise<void> {
        await this.config.ready
        this.isMock = this.config.isMock
        this.scanDevices() // background pre-scan
    }

    attached(): void {
        this.sfStepper = new Stepper({
            steps: this.STEP_LABELS,
            activeStep: this.step,
            readOnly: true
        });

        this.sfStepper.appendTo(this.stepperContainer);
        let _this = this as any;

        // TODO fix this settimeout hack
        setTimeout(function () { _this.sfStepper.refresh(); }, 250);
    }

    detaching(): void {
        this.sfStepper?.destroy()
        this.sfStepper = undefined
    }

    // ── Step 0: Device ───────────────────────────────────────────────────────
    async scanDevices(): Promise<void> {
        this.scanning = true
        this.scanError = null
        try {
            await this.usb.initialize()
            await this.usb.refresh()

            // Board detection no longer depends on the build toolchain being
            // ready — it is serial-port enumeration plus a VID/PID lookup — so
            // boards are listed even on an installation that can't compile yet.
            let detected: DetectedBoardInfo[] = []
            try {
                detected = await this.pio.listBoards()
            } catch { /* fall back silently to the raw port list */ }

            this.boards = mergeDetectedBoards(this.usb.serialPorts, detected)
        } catch (err) {
            this.scanError = (err as Error).message
        } finally {
            this.scanning = false
        }
    }

    // ── Step 2: Product ──────────────────────────────────────────────────────
    private productDescription(key: string): string {
        const desc: Record<string, string> = {
            ex_commandstation: 'Full DCC command station for model railroads',
            ex_ioexpander: 'Expands I/O pins via I\u00b2C',
            ex_turntable: 'Controls a turntable or traverser',
        }
        return desc[key] ?? ''
    }

    private applyCsb1MotorShieldType(content: string): string {
        if (!this.showStackedMotorShieldOption) return content

        const motorShieldType = this.hasStackedMotorShield ? 'EXCSB1_WITH_EX8874' : 'EXCSB1'
        const motorShieldPattern = /^#define\s+MOTOR_SHIELD_TYPE\s+\S+$/m

        if (motorShieldPattern.test(content)) {
            return content.replace(motorShieldPattern, `#define MOTOR_SHIELD_TYPE ${motorShieldType}`)
        }

        return `${content.trimEnd()}\n#define MOTOR_SHIELD_TYPE ${motorShieldType}\n`
    }

    isDeviceSupported(productKey: string): boolean {
        const product = productDetails[productKey]
        const board = this.selectedBoard
        if (!product || !board) return false
        if (!board.fqbn) return true // unidentified board — allow any
        return product.supportedDevices.some(
            (d) => board.fqbn.startsWith(d) || d.startsWith(board.fqbn)
        )
    }

    // ── Step 3: Version ──────────────────────────────────────────────────────
    async loadVersions(): Promise<void> {
        const product = productDetails[this.selectedProduct ?? '']
        if (!product) return
        this.versionBusy = true
        this.versionError = null
        try {
            const reposDir = await this.files.getInstallDir('repos')
            const repoFolder = product.repoName.split('/')[1]
            const repoPath = `${reposDir}/${repoFolder}`
            const repoExists = await this.files.exists(`${repoPath}/.git`)

            if (repoExists) {
                // A prior setup may have left this repo checked out to a version tag
                // (detached HEAD), which makes `git pull` fail with "not currently on a
                // branch". Return to the default branch first so pull always has
                // something to fast-forward.
                this.versionStatus = 'Pulling latest changes...'
                const branchCheckout = await this.git.checkout(repoPath, product.defaultBranch)
                if (!branchCheckout.success) {
                    throw new Error(
                        branchCheckout.error ?? `Failed to switch to ${product.defaultBranch} for ${product.productName}.`
                    )
                }
                const result = await this.git.pull(repoPath)
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to pull latest changes for ${product.productName}.`)
                }
            } else {
                this.versionStatus = `Cloning ${product.productName}...`
                const result = await this.git.clone(product.repoUrl, repoPath, product.defaultBranch)
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to clone ${product.productName}.`)
                }
            }

            this.versionStatus = 'Loading version list...'
            const tags = await this.git.listTags(repoPath)
            this.versions = sortVersionsDescending(tags)
            this.selectedVersion = pickLatestVersion(this.versions)
            this.versionStatus = ''
        } catch (err) {
            this.versionError = (err as Error).message
        } finally {
            this.versionBusy = false
        }
    }

    // ── Navigation ───────────────────────────────────────────────────────────
    get canGoNext(): boolean {
        if (this.step === 0) return this.selectedBoard !== null
        if (this.step === 1) return this.selectedProduct !== null
        if (this.step === 2) return this.selectedVersion !== null && !this.versionBusy
        if (this.step === 3) return this.deviceNickname.trim().length > 0
        return false
    }

    async goNext(): Promise<void> {
        if (!this.canGoNext) return
        if (this.step === 3) {
            await this.finish()
            return
        }
        this.step++
        this.sfStepper?.nextStep();
        if (this.step === 2) await this.loadVersions()
    }

    goBack(): void {
        if (this.step > 0) {
            this.step--
            this.sfStepper?.previousStep();
        }
    }

    cancel(): void {
        this.$dialog.cancel()
    }

    // ── Finish: persist state then close dialog ───────────────────────────────
    private async finish(): Promise<void> {
        this.finishing = true
        this.finishError = null
        try {
            // If the selected board lacks an FQBN, attempt to enrich it from
            // a live Arduino CLI scan. If enrichment fails, prompt the user to
            // pick the correct board type so the saved configuration includes
            // a valid FQBN.
            if (this.selectedBoard && !this.selectedBoard.fqbn) {
                try {
                    const cliBoards = await this.pio.listBoards()
                    const match = cliBoards.find(b => b.port === this.selectedBoard!.port || (b.serialNumber && b.serialNumber === this.selectedBoard!.serialNumber))
                    if (match && match.fqbn) {
                        this.selectedBoard.fqbn = match.fqbn
                    }
                } catch {
                    // ignore
                }

                if (!this.selectedBoard.fqbn) {
                    // Ask the user to pick a board type from a live scan so we
                    // can capture its FQBN. This dialog lists detected boards
                    // and will usually include the same port with a populated
                    // `fqbn` if the CLI recognises it.
                    const result = await this.dialogService.open({ component: () => DevicePickerDialog }).whenClosed((r) => r)
                    if ((result as any).status === 'ok' && (result as any).value) {
                        this.selectedBoard = (result as any).value as DetectedBoardInfo
                    } else {
                        throw new Error('Board type is required to continue.');
                    }
                }
            }
            const product = productDetails[this.selectedProduct ?? '']
            if (!product || !this.selectedBoard || !this.selectedVersion) {
                throw new Error('Incomplete selection — cannot finish.')
            }

            // ── Paths ────────────────────────────────────────────────────────
            const reposDir = await this.files.getInstallDir('repos')
            const repoFolder = product.repoName.split('/')[1]
            const repoPath = `${reposDir}/${repoFolder}`         // git source (never cleared)
            const id = String(Date.now())
            // The build dir is keyed on the board itself, so two boards running
            // the same product never share build output or settings.
            const boardIdentity = {
                fqbn: this.selectedBoard.fqbn,
                serialNumber: this.selectedBoard.serialNumber,
                port: this.selectedBoard.port,
            }
            const scratchPath = buildScratchPath(reposDir, repoFolder, boardIdentity, id)

            // ── Checkout requested version in the source repo ────────────────
            const checkout = await this.git.checkout(repoPath, this.selectedVersion)
            if (!checkout.success) throw new Error(checkout.error ?? 'Checkout failed')

            // ── Collect user-tracked file names ──────────────────────────────
            // These are config.h, myAutomation, etc. — preserved across reconfigures.
            const isUserFile = (name: string) => isProductUserFile(product, name)

            // ── Save existing user files from previous scratchPath (if any) ──
            // Prefer this exact board's previous configuration, then any config
            // for the same board type — never another board's.
            const prevConf = findReusableConfig(
                this.state.savedConfigurations,
                this.selectedProduct!,
                boardIdentity,
            )
            const savedUserFiles: Map<string, string> = new Map()
            if (prevConf?.scratchPath) {
                try {
                    const prevFiles = await this.files.listDir(prevConf.scratchPath)
                    for (const name of prevFiles) {
                        if (isUserFile(name)) {
                            const content = await this.files.readFile(`${prevConf.scratchPath}/${name}`)
                            if (content.trim()) savedUserFiles.set(name, content)
                        }
                    }
                } catch { /* previous scratch dir may not exist */ }
            }

            // ── Clear scratch dir and create fresh ───────────────────────────
            try { await this.files.deleteFiles(scratchPath) } catch { /* ignore */ }
            await this.files.mkdir(scratchPath)

            // ── Selectively copy source files from repo (no examples/templates) ──
            await copyProductSourceFiles(this.files, product, repoPath, scratchPath)

            // ── Resolve user config files ────────────────────────────────────
            // Priority: 1) previously-saved user edit
            //           2) bundled starter template (curated, known-good default)
            //           3) file in source repo
            //           4) example file in source repo ("config.h.example")
            //           5) example file in source repo ("config.example.h")
            const configFiles: Array<{ name: string; content: string }> = []
            for (const fileName of product.minimumConfigFiles) {
                let content = savedUserFiles.get(fileName) ?? ''
                if (!content) {
                    // 2) bundled starter template
                    content = STARTER_TEMPLATES[repoFolder]?.[fileName] ?? ''
                }
                if (!content) {
                    const filePath = `${repoPath}/${fileName}`
                    // Repos may name the example file either "config.h.example" or
                    // "config.example.h" — probe both conventions.
                    const examplePathSuffix = `${repoPath}/${fileName}.example`
                    const dotIdx = fileName.lastIndexOf('.')
                    const examplePathInfix = dotIdx !== -1
                        ? `${repoPath}/${fileName.slice(0, dotIdx)}.example${fileName.slice(dotIdx)}`
                        : null
                    if (await this.files.exists(filePath)) {
                        content = await this.files.readFile(filePath)
                    } else if (await this.files.exists(examplePathSuffix)) {
                        content = await this.files.readFile(examplePathSuffix)
                    } else if (examplePathInfix && await this.files.exists(examplePathInfix)) {
                        content = await this.files.readFile(examplePathInfix)
                    }
                }
                if (fileName === 'config.h') {
                    content = this.applyCsb1MotorShieldType(content)
                }
                configFiles.push({ name: fileName, content })
                console.debug('[device-wizard] writing starter config to scratch:', `${scratchPath}/${fileName}`)
                await this.files.writeFile(`${scratchPath}/${fileName}`, content)
            }
            // Restore other tracked user files (myAutomation, etc.)
            for (const [name, content] of savedUserFiles) {
                if (!product.minimumConfigFiles.includes(name)) {
                    configFiles.push({ name, content })
                    console.debug('[device-wizard] restoring user file to scratch:', `${scratchPath}/${name}`)
                    await this.files.writeFile(`${scratchPath}/${name}`, content)
                }
            }

            // The repo's shipped example config files (myAutomation.example.h, etc.)
            // were just copied into scratchPath by copyProductSourceFiles — track
            // them too so they render (grouped under Examples) instead of sitting
            // on disk with no editor entry.
            for (const ex of await collectExampleConfigFiles(this.files, scratchPath)) {
                if (!configFiles.some((f) => f.name === ex.name)) configFiles.push(ex)
            }

            // ── Update state ─────────────────────────────────────────────────
            this.state.repoPath = repoPath
            this.state.scratchPath = scratchPath
            this.state.selectedDevice = this.selectedBoard
            this.state.selectedProduct = this.selectedProduct
            this.state.selectedVersion = this.selectedVersion
            this.state.configFiles = configFiles

            // ── Persist saved configuration ──────────────────────────────────
            const savedConf: SavedConfiguration = {
                id,
                name: this.deviceNickname.trim(),
                deviceName: this.selectedBoard.name,
                devicePort: this.selectedBoard.port,
                deviceFqbn: this.selectedBoard.fqbn,
                deviceSerialNumber: this.selectedBoard.serialNumber,
                product: this.selectedProduct!,
                productName: product.productName,
                version: this.selectedVersion,
                repoPath,
                scratchPath,
                configFiles,
                lastModified: new Date().toISOString(),
            }
            this.state.activeConfigId = id
            const existing = Array.isArray(this.state.savedConfigurations)
                ? this.state.savedConfigurations : []
            this.state.savedConfigurations = [savedConf, ...existing].slice(0, 10)
            await this.preferences.set('savedConfigurations', this.state.savedConfigurations)

            await this.$dialog.ok({ id })
        } catch (err) {
            this.finishError = (err as Error).message
        } finally {
            this.finishing = false
        }
    }
}
