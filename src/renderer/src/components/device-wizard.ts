import { resolve } from 'aurelia'
import { IDialogController } from '@aurelia/dialog'
import { StepModel, Stepper } from '@syncfusion/ej2-navigations'
import { InstallerState } from '../models/installer-state'
import { ConfigEditorState } from '../models/config-editor-state'
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
    defaultCommandStationConfig,
    parseMyAutomationTrackManager,
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
    private readonly configEditorState = resolve(ConfigEditorState)
    private readonly pio = resolve(PlatformIoService)
    private readonly usb = resolve(UsbService)
    private readonly git = resolve(GitService)
    private readonly files = resolve(FileService)
    private readonly preferences = resolve(PreferencesService)
    private readonly config = resolve(ConfigService)
    private readonly dialogService = resolve(IDialogService)

    // ── Wizard step (0–5) ────────────────────────────────────────────────────
    // Product is fixed to EX-CommandStation (the only product this version
    // supports), so there is no separate product-selection step. Steps 2–4
    // (WiFi/Hardware/Track Power) only apply to EX-CSB1 boards — see
    // isCsb1Board — and are simply skipped straight to Confirm for any other
    // board (see goNext()'s step===1 handler). Confirm is always the last
    // step: it's where the device gets its name and a final review of every
    // choice made earlier in the flow, for both board types.
    step = 0
    readonly STEP_LABELS: StepModel[] = [
        { label: 'Select Device', iconCss: 'sf-icon-cart' },
        { label: 'Select Version', iconCss: 'sf-icon-cart' },
        { label: 'WiFi', iconCss: 'sf-icon-cart' },
        { label: 'Hardware', iconCss: 'sf-icon-cart' },
        { label: 'Track Power', iconCss: 'sf-icon-cart' },
        { label: 'Confirm', iconCss: 'sf-icon-cart' },
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

    // ── Step 2: WiFi (EX-CSB1 only) ───────────────────────────────────────────
    wifiMode: 'ap' | 'sta' = 'ap'
    wifiHostname = 'dccex'
    wifiSsid = ''
    wifiPassword = ''
    wifiChannel = 1

    // ── Step 3: Hardware (EX-CSB1 only) ───────────────────────────────────────
    // Combines the OLED display type/scroll mode with the stacked motor
    // shield choice — both are config.h device-hardware settings, so they
    // share one pane rather than each getting their own step.
    // EX-CSB1's onboard panel is a 132x64 OLED — suggested as the default.
    oledDisplay = 'OLED_132x64'
    oledScrollMode = 1
    hasStackedMotorShield = false
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
    get selectedDisplayLabel(): string {
        return this.displays.find((d) => d.value === this.oledDisplay)?.label ?? this.oledDisplay
    }

    // ── Step 4: Track Power (EX-CSB1 only) ────────────────────────────────────
    // Rendered live by <track-manager-form>, the same component the Startup
    // section uses — it reads/writes ConfigEditorState directly, so there is
    // no wizard-local state to track here. See goNext()'s step===1 handler,
    // which loads ConfigEditorState from the freshly-provisioned device
    // before this step becomes reachable. The dialog is opened with
    // DialogDomRendererClassic (see home.ts/workspace.ts) specifically so
    // this component's Syncfusion dropdown popups render correctly — they
    // portal to document.body, which paints BEHIND a native <dialog> shown
    // via showModal() no matter the z-index (browser top-layer rules), so
    // the default DialogDomRendererStandard can't host this component.

    // ── Step 5: Confirm ────────────────────────────────────────────────────────
    deviceNickname = ''
    deviceNicknameEl?: HTMLInputElement

    /**
     * Readable summary of the Track Power step's live edits, for the Confirm
     * review — <track-manager-form> writes straight through
     * ConfigEditorState.generatedTrackManagerContent, so this just re-parses
     * that same EXRAIL text the same way the form itself does on reload (see
     * track-manager-form.ts's reloadFromConfig()), starting from the
     * firmware defaults for anything the user never touched.
     */
    get trackPowerSummary(): string {
        const opts = defaultCommandStationConfig()
        Object.assign(opts, parseMyAutomationTrackManager(this.configEditorState.generatedTrackManagerContent))
        const perTrack = opts.startupPowerMode === 'individual'
        const powerModeLabel = {
            all: 'All tracks on at startup',
            off: 'All tracks off at startup',
            individual: 'Individual per-track power',
        }[opts.startupPowerMode]
        const track = (label: string, mode: string, power: 'ON' | 'OFF'): string =>
            `${label}: ${mode}${perTrack ? ` (${power})` : ''}`
        const parts = [
            powerModeLabel,
            track('A', opts.trackAMode, opts.trackAPower),
            track('B', opts.trackBMode, opts.trackBPower),
        ]
        if (this.hasStackedMotorShield) {
            parts.push(track('C', opts.trackCMode, opts.trackCPower))
            parts.push(track('D', opts.trackDMode, opts.trackDPower))
        }
        return parts.join(' · ')
    }

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

    /** Confirm is always the last step, for every board — see goNext()'s step===1 handler. */
    get isLastStep(): boolean {
        return this.step === 5
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
        if (this.step === 2) return this.wifiMode !== 'sta' || this.wifiSsid.trim().length > 0
        if (this.step === 3 || this.step === 4) return true
        if (this.step === 5) return this.deviceNickname.trim().length > 0
        return false
    }

    async goNext(): Promise<void> {
        if (!this.canGoNext) return

        if (this.step === 1) {
            const id = await this.provision()
            if (!id) return
            if (this.isCsb1Board) {
                // Load ConfigEditorState from the config.h/etc. provision()
                // just wrote for THIS device, so the WiFi/Hardware/Track Power
                // steps — track-manager-form in particular — read and write
                // this device's own state, not whatever the previous device
                // left behind in the shared singleton.
                this.configEditorState.loadFromInstallerState()
                this.step = 2
                this.syncStepper()
            } else {
                // Non-CSB1 boards have nothing to configure between Version
                // and Confirm — skip straight there.
                this.step = 5
                this.syncStepper()
                this.enterConfirmStep()
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
        if (this.step === 5) this.enterConfirmStep()
    }

    goBack(): void {
        if (this.step === 0) return

        if (!this.isCsb1Board && this.step === 5) {
            // Mirror goNext()'s skip: non-CSB1 boards jump straight back to
            // Version, since WiFi/Hardware/Track Power were never visited.
            this.step = 1
            this.syncStepper()
            return
        }

        this.step--
        this.sfStepper?.previousStep();
    }

    private enterConfirmStep(): void {
        if (this.isCsb1Board) this.deviceNickname ||= 'CSB1'
        // Wait a tick — if.bind hasn't committed the step-5 DOM yet.
        setTimeout(() => this.deviceNicknameEl?.focus(), 0)
    }

    cancel(): void {
        this.$dialog.cancel()
    }

    // ── Provision: create the device's repo/scratch dir + saved config ────────
    // Returns the new config's id on success, or null on failure (finishError
    // is set). Does not close the dialog — EX-CSB1 boards continue on to the
    // WiFi/Hardware/Track Power/Confirm steps; completeWizard() closes it. Runs
    // right after Version, before the device has a name (Confirm — where the
    // name is collected — is now the last step), so the saved config is
    // created with a blank name and completeWizard() fills it in.
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
            // name is blank here — Confirm (where it's collected) is the last
            // step now, so completeWizard() fills it in once the wizard finishes.
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
                    opts.hasStackedMotorShield = this.hasStackedMotorShield

                    const newContent = generateCommandStationConfig(opts)
                    this.state.configFiles[idx] = { name: 'config.h', content: newContent }
                    await this.files.writeFile(`${this.state.scratchPath}/config.h`, newContent)
                }
                // Track Power was already written live to ConfigEditorState by
                // <track-manager-form> during the wizard (see goNext()'s
                // step===1 handler) — it's picked up below along with config.h
                // when the saved configuration's configFiles snapshot is refreshed.
            }

            // Device name is only known now (Confirm is the last step) — fill
            // it in, along with whatever config.h/myStartup.h changes were
            // just made, before persisting.
            const savedIdx = this.state.savedConfigurations.findIndex((c) => c.id === id)
            if (savedIdx !== -1) {
                this.state.savedConfigurations[savedIdx] = {
                    ...this.state.savedConfigurations[savedIdx],
                    name: this.deviceNickname.trim(),
                    configFiles: this.state.configFiles.map((f) => ({ ...f })),
                    lastModified: new Date().toISOString(),
                }
                await this.preferences.set('savedConfigurations', this.state.savedConfigurations)
            }

            // Roster isn't a wizard step — land the workspace there once it
            // opens, for a future onboarding tutorial to hook into.
            this.state.pendingWizardOpenRoster = true

            await this.$dialog.ok({ id })
        } catch (err) {
            this.finishError = (err as Error).message
        } finally {
            this.finishing = false
        }
    }
}
