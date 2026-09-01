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
import {
    type CommandStationConfigOptions,
    parseCommandStationConfig,
    generateCommandStationConfig,
} from '../config/commandstation'
import type { DetectedBoardInfo } from '../../../types/ipc'
import type { SavedConfiguration } from '../models/saved-configuration'
import { STARTER_TEMPLATES } from '../../../types/starter-templates'
import { copyProductSourceFiles } from '../utils/product-source-files'
import { mergeDetectedBoards } from '../utils/device-scan'
import { buildScratchPath } from '../utils/board-key'

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

    // ── Wizard step (0–6) ────────────────────────────────────────────────────
    // Product is fixed to EX-CommandStation (the only product this version
    // supports), so there is no separate product-selection step. Steps 3–6
    // (WiFi/OLED/Track Power/Roster) only apply to EX-CSB1 boards — see
    // isCsb1Board — and are simply never visited for any other board.
    step = 0
    readonly STEP_LABELS: StepModel[] = [
        { label: 'Select Device', iconCss: 'sf-icon-cart' },
        { label: 'Select Version', iconCss: 'sf-icon-cart' },
        { label: 'Confirm', iconCss: 'sf-icon-cart' },
        { label: 'WiFi', iconCss: 'sf-icon-cart' },
        { label: 'OLED Display', iconCss: 'sf-icon-cart' },
        { label: 'Track Power', iconCss: 'sf-icon-cart' },
        { label: 'Roster', iconCss: 'sf-icon-cart' },
    ];

    // ── Step 0: Device ───────────────────────────────────────────────────────
    boards: DetectedBoardInfo[] = []
    selectedBoard: DetectedBoardInfo | null = null
    scanning = false
    scanError: string | null = null

    // ── Product (fixed) ──────────────────────────────────────────────────────
    readonly selectedProduct: string = 'ex_commandstation'
    get productName(): string {
        return productDetails[this.selectedProduct]?.productName ?? ''
    }

    // ── Step 1: Version ──────────────────────────────────────────────────────
    versions: string[] = []
    selectedVersion: string | null = null
    recommendedVersion: string | null = null
    versionBusy = false
    versionStatus = ''
    versionError: string | null = null

    // ── Step 2: Confirm ──────────────────────────────────────────────────────
    deviceNickname = ''
    deviceNicknameEl?: HTMLInputElement
    hasStackedMotorShield = false

    // ── Step 3: WiFi (EX-CSB1 only) ──────────────────────────────────────────
    wifiMode: 'ap' | 'sta' = 'ap'
    wifiHostname = 'dccex'
    wifiSsid = ''
    wifiPassword = ''
    wifiChannel = 1

    // ── Step 4: OLED Display (EX-CSB1 only) ──────────────────────────────────
    // EX-CSB1's onboard panel is a 132x64 OLED — suggested as the default.
    oledDisplay = 'OLED_132x64'
    oledScrollMode = 1
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

    // ── Step 5: Track Power (EX-CSB1 only) ───────────────────────────────────
    // Mirrors track-manager-form.ts's fields/options exactly (same DCC/DC/
    // Mixed modes, per-track type, and PROG support), but with plain HTML
    // controls instead of that component's Syncfusion DropDownLists — a
    // Syncfusion popup portals to document.body, which renders BEHIND a
    // native <dialog> shown via showModal() (the browser's top-layer always
    // wins over regular body content, no matter the z-index), making those
    // dropdowns unclickable inside this wizard. Applied on Finish via
    // InstallerState.pendingWizardSetup, same as the roster prompt.
    trackManagerMode: 'dcc-only' | 'dc-only' | 'mixed' = 'dcc-only'
    trackAMode = 'MAIN'
    trackAType: 'dcc' | 'dc' = 'dcc'
    trackALocoId = 0
    trackBMode = 'PROG'
    trackBType: 'dcc' | 'dc' = 'dcc'
    trackBLocoId = 0
    trackCMode = 'MAIN'
    trackCType: 'dcc' | 'dc' = 'dcc'
    trackCLocoId = 0
    trackDMode = 'MAIN'
    trackDType: 'dcc' | 'dc' = 'dcc'
    trackDLocoId = 0
    trackPowerMode: 'all' | 'individual' = 'all'
    trackAPower: 'ON' | 'OFF' = 'ON'
    trackBPower: 'ON' | 'OFF' = 'ON'
    trackCPower: 'ON' | 'OFF' = 'ON'
    trackDPower: 'ON' | 'OFF' = 'ON'
    readonly dccModes = ['MAIN', 'MAIN_INV', 'MAIN_AUTO', 'PROG', 'NONE']
    readonly dcModes = ['DC', 'DC_INV', 'DCX', 'NONE']

    get trackManagerModeMixed(): boolean {
        return this.trackManagerMode === 'mixed'
    }

    getTrackModeOptions(trackType: 'dcc' | 'dc'): string[] {
        if (this.trackManagerMode === 'dcc-only') return this.dccModes
        if (this.trackManagerMode === 'dc-only') return this.dcModes
        return trackType === 'dcc' ? this.dccModes : this.dcModes
    }

    /** Switching Track Configuration mode resets every track to a valid type/mode for it. */
    onTrackManagerModeChange(): void {
        const type: 'dcc' | 'dc' = this.trackManagerMode === 'dc-only' ? 'dc' : 'dcc'
        if (this.trackManagerMode !== 'mixed') {
            this.trackAType = type
            this.trackBType = type
            this.trackCType = type
            this.trackDType = type
        }
        this.trackAMode = this.getTrackModeOptions(this.trackAType)[0]
        this.trackBMode = this.getTrackModeOptions(this.trackBType)[0]
        this.trackCMode = this.getTrackModeOptions(this.trackCType)[0]
        this.trackDMode = this.getTrackModeOptions(this.trackDType)[0]
    }

    /** Switching a track's type (mixed mode only) resets its mode to something valid for the new type. */
    onTrackTypeChange(track: 'A' | 'B' | 'C' | 'D'): void {
        if (track === 'A') this.trackAMode = this.getTrackModeOptions(this.trackAType)[0]
        else if (track === 'B') this.trackBMode = this.getTrackModeOptions(this.trackBType)[0]
        else if (track === 'C') this.trackCMode = this.getTrackModeOptions(this.trackCType)[0]
        else this.trackDMode = this.getTrackModeOptions(this.trackDType)[0]
    }

    // ── Step 6: Roster (EX-CSB1 only) ────────────────────────────────────────
    addFirstRosterEntry = true

    // ── Finishing ────────────────────────────────────────────────────────────
    finishing = false
    finishError: string | null = null
    /** Set by provision() once the device is created — carried through steps 3–6 to completeWizard(). */
    private provisionedId: string | null = null

    isMock = false

    get isCsb1Board(): boolean {
        if (!this.selectedBoard) return false
        const boardName = this.selectedBoard.name.toUpperCase()
        return boardName.includes('EX-CSB1') || boardName.includes('EXCSB1')
    }

    get showStackedMotorShieldOption(): boolean {
        return this.selectedProduct === 'ex_commandstation' && this.isCsb1Board
    }

    /** The last step in this board's flow — CSB1 continues past Confirm, others stop there. */
    get isLastStep(): boolean {
        return this.isCsb1Board ? this.step === 6 : this.step === 2
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
                this.versionStatus = 'Pulling latest changes...'
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
            this.recommendedVersion = pickLatestVersion(this.versions)
            this.selectedVersion = this.recommendedVersion
            this.versionStatus = ''
        } catch (err) {
            this.versionError = (err as Error).message
        } finally {
            this.versionBusy = false
        }
    }

    // ── Navigation ───────────────────────────────────────────────────────────
    get canGoNext(): boolean {
        if (this.step === 0) return this.selectedBoard !== null && this.isDeviceSupported(this.selectedProduct)
        if (this.step === 1) return this.selectedVersion !== null && !this.versionBusy
        if (this.step === 2) return this.deviceNickname.trim().length > 0
        if (this.step === 3) return this.wifiMode !== 'sta' || this.wifiSsid.trim().length > 0
        if (this.step === 4 || this.step === 5) return true
        if (this.step === 6) return true
        return false
    }

    async goNext(): Promise<void> {
        if (!this.canGoNext) return

        if (this.step === 2) {
            const id = await this.provision()
            if (!id) return
            if (this.isCsb1Board) {
                this.step++
                this.sfStepper?.nextStep();
            } else {
                await this.completeWizard(id)
            }
            return
        }

        if (this.isLastStep) {
            if (this.provisionedId) await this.completeWizard(this.provisionedId)
            return
        }

        this.step++
        this.sfStepper?.nextStep();
        if (this.step === 1) await this.loadVersions()
        if (this.step === 2) this.enterConfirmStep()
    }

    goBack(): void {
        if (this.step > 0) {
            this.step--
            this.sfStepper?.previousStep();
            if (this.step === 2) this.enterConfirmStep()
        }
    }

    private enterConfirmStep(): void {
        if (this.isCsb1Board) this.deviceNickname ||= 'CSB1'
        // Wait a tick — if.bind hasn't committed the step-2 DOM yet.
        setTimeout(() => this.deviceNicknameEl?.focus(), 0)
    }

    cancel(): void {
        this.$dialog.cancel()
    }

    // ── Provision: create the device's repo/scratch dir + saved config ────────
    // Returns the new config's id on success, or null on failure (finishError
    // is set). Does not close the dialog — EX-CSB1 boards continue on to the
    // WiFi/OLED/Track Power/Roster steps; completeWizard() closes it.
    private async provision(): Promise<string | null> {
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

            // ── Clear scratch dir and create fresh ───────────────────────────
            // Every "Setup New Device" run is a distinct, independent
            // configuration — it never seeds config.h/myRoster.h/etc. from any
            // other saved configuration, even one for the same physical board,
            // so multiple separate configurations for one board stay possible
            // and a new device never inherits another one's roster/turnouts/etc.
            try { await this.files.deleteFiles(scratchPath) } catch { /* ignore */ }
            await this.files.mkdir(scratchPath)

            // ── Selectively copy source files from repo (no examples/templates) ──
            await copyProductSourceFiles(this.files, product, repoPath, scratchPath)

            // ── Resolve user config files ────────────────────────────────────
            // Priority: 1) bundled starter template (curated, known-good default)
            //           2) file in source repo
            //           3) example file in source repo ("config.h.example")
            //           4) example file in source repo ("config.example.h")
            const configFiles: Array<{ name: string; content: string }> = []
            for (const fileName of product.minimumConfigFiles) {
                // 1) bundled starter template
                let content = STARTER_TEMPLATES[repoFolder]?.[fileName] ?? ''
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

            this.provisionedId = id
            return id
        } catch (err) {
            this.finishError = (err as Error).message
            return null
        } finally {
            this.finishing = false
        }
    }

    // ── Complete: apply extended-step answers (if any), persist, close ────────
    private async completeWizard(id: string): Promise<void> {
        this.finishing = true
        this.finishError = null
        try {
            if (this.isCsb1Board) {
                // config.h has no managed-block wrapping (unlike myStartup.h) —
                // it's safe to reparse/regenerate directly here, the same way
                // commandstation-config-form.ts's onFieldChange() does.
                const idx = this.state.configFiles.findIndex((f) => f.name === 'config.h')
                if (idx !== -1 && this.state.scratchPath) {
                    const opts: CommandStationConfigOptions = parseCommandStationConfig(this.state.configFiles[idx].content)
                    opts.enableWifi = true
                    opts.wifiMode = this.wifiMode
                    opts.wifiHostname = this.wifiHostname.trim() || 'dccex'
                    opts.wifiSsid = this.wifiSsid.trim()
                    opts.wifiPassword = this.wifiPassword
                    opts.wifiChannel = this.wifiChannel
                    opts.display = this.oledDisplay
                    opts.scrollMode = this.oledScrollMode

                    const newContent = generateCommandStationConfig(opts)
                    this.state.configFiles[idx] = { name: 'config.h', content: newContent }
                    await this.files.writeFile(`${this.state.scratchPath}/config.h`, newContent)

                    const savedIdx = this.state.savedConfigurations.findIndex((c) => c.id === id)
                    if (savedIdx !== -1) {
                        this.state.savedConfigurations[savedIdx] = {
                            ...this.state.savedConfigurations[savedIdx],
                            configFiles: this.state.configFiles.map((f) => ({ ...f })),
                            lastModified: new Date().toISOString(),
                        }
                        await this.preferences.set('savedConfigurations', this.state.savedConfigurations)
                    }
                }

                this.state.pendingWizardSetup = {
                    trackPower: {
                        hasStackedMotorShield: this.hasStackedMotorShield,
                        startupPowerMode: this.trackPowerMode,
                        trackAMode: this.trackAMode,
                        trackALocoId: this.trackALocoId,
                        trackAPower: this.trackAPower,
                        trackBMode: this.trackBMode,
                        trackBLocoId: this.trackBLocoId,
                        trackBPower: this.trackBPower,
                        trackCMode: this.trackCMode,
                        trackCLocoId: this.trackCLocoId,
                        trackCPower: this.trackCPower,
                        trackDMode: this.trackDMode,
                        trackDLocoId: this.trackDLocoId,
                        trackDPower: this.trackDPower,
                    },
                    addFirstRosterEntry: this.addFirstRosterEntry,
                }
            }

            await this.$dialog.ok({ id })
        } catch (err) {
            this.finishError = (err as Error).message
        } finally {
            this.finishing = false
        }
    }
}
