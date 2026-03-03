import { DI } from 'aurelia'
import type { ArduinoCliBoardInfo } from '../../../types/ipc'
import type { SavedConfiguration } from './saved-configuration'

export const IInstallerState = DI.createInterface<InstallerState>('IInstallerState')

/**
 * InstallerState — shared singleton holding wizard state.
 * Registered as a singleton in the DI container so all views share it.
 */
export class InstallerState {
    /** App version */
    readonly appVersion = '0.1.0'

    /** Arduino CLI installed and ready */
    cliReady = false

    /** Selected Arduino device */
    selectedDevice: ArduinoCliBoardInfo | null = null

    /** Selected product key (e.g. 'ex_commandstation') */
    selectedProduct: string | null = null

    /** Selected version tag (e.g. 'v5.2.80-Prod') */
    selectedVersion: string | null = null

    /** Path to the cloned repo on disk (git source) */
    repoPath: string | null = null

    /** Path to the per-device scratch/build directory */
    scratchPath: string | null = null

    /** Whether to use existing config files from disk */
    useExistingConfig = false

    /** Whether advanced config editing is enabled */
    advancedConfig = false

    /** Generated config file contents before write */
    configFiles: Array<{ name: string; content: string }> = []

    /** Error message for display */
    lastError: string | null = null

    /** All detected boards from the last scan */
    detectedBoards: ArduinoCliBoardInfo[] = []

    /** Persisted device configurations shown on the home screen */
    savedConfigurations: SavedConfiguration[] = []

    /** ID of the configuration currently loaded in the workspace */
    activeConfigId: string | null = null

    reset(): void {
        this.cliReady = false
        this.selectedDevice = null
        this.selectedProduct = null
        this.selectedVersion = null
        this.repoPath = null
        this.scratchPath = null
        this.useExistingConfig = false
        this.advancedConfig = false
        this.configFiles = []
        this.lastError = null
        this.detectedBoards = []
        this.activeConfigId = null
        // NOTE: savedConfigurations is intentionally NOT reset — it persists across wizard runs
    }
}
