import { DI } from 'aurelia'
import type { DetectedBoardInfo } from '../../../types/ipc'
import type { SavedConfiguration } from './saved-configuration'

export const IInstallerState = DI.createInterface<InstallerState>('IInstallerState')

/**
 * InstallerState — shared singleton holding wizard state.
 * Registered as a singleton in the DI container so all views share it.
 */
export class InstallerState {
    /** App version */
    readonly appVersion = '0.1.0'

    /** Bundled PlatformIO build toolchain unpacked and ready */
    toolchainReady = false

    /** Selected Arduino device */
    selectedDevice: DetectedBoardInfo | null = null

    /** Selected product key (e.g. 'ex_commandstation') */
    selectedProduct: string | null = null

    /** Selected version tag (e.g. 'v5.2.80-Prod') */
    selectedVersion: string | null = null

    /** Path to the cloned repo on disk (git source) */
    repoPath: string | null = null

    /** Path to the per-device scratch/build directory */
    scratchPath: string | null = null

    /**
     * Original user folder path when loaded via "Load from Folder" without a .ino.
     * When set, saveFiles() in the workspace also writes config files back here.
     */
    sourceFolder: string | null = null

    /** Whether to use existing config files from disk */
    useExistingConfig = false

    /** Whether advanced config editing is enabled */
    advancedConfig = false

    /** Generated config file contents before write */
    configFiles: Array<{ name: string; content: string }> = []

    /** Error message for display */
    lastError: string | null = null

    /** All detected boards from the last scan */
    detectedBoards: DetectedBoardInfo[] = []

    /** Persisted device configurations shown on the home screen */
    savedConfigurations: SavedConfiguration[] = []

    /** ID of the configuration currently loaded in the workspace */
    activeConfigId: string | null = null

    /**
     * One-shot signal set by Home's loadFromFolder() when it detected a managed
     * file authored outside EX-Installer (missing the generator header) — the
     * upcoming workspace bind should treat that normalization as a pending
     * change so Save surfaces it, rather than only a genuine user edit doing
     * so. Consumed (and cleared) by workspace.ts's binding() the first time it
     * runs, so it never leaks into a later switchToConfig()/reload.
     */
    pendingMigrationOnLoad = false

    reset(): void {
        this.toolchainReady = false
        this.selectedDevice = null
        this.selectedProduct = null
        this.selectedVersion = null
        this.repoPath = null
        this.scratchPath = null
        this.sourceFolder = null
        this.useExistingConfig = false
        this.advancedConfig = false
        this.configFiles = []
        this.lastError = null
        this.detectedBoards = []
        this.activeConfigId = null
        this.pendingMigrationOnLoad = false
        // NOTE: savedConfigurations is intentionally NOT reset — it persists across wizard runs
    }
}
