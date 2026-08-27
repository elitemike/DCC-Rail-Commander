/**
 * Represents a saved device configuration that can be reloaded from the home screen.
 */
export interface SavedConfiguration {
    /** Unique identifier (timestamp string) */
    id: string
    /** Human-readable label shown in the recent-items list */
    name: string
    /** Board display name (e.g. "Arduino Mega 2560") */
    deviceName: string
    /** Serial port path (e.g. "/dev/ttyACM0" or "COM3") */
    devicePort: string
    /** Arduino FQBN string – empty if the board wasn't identified */
    deviceFqbn: string
    /**
     * USB serial number of the specific board, when it reports one. Together
     * with the FQBN this distinguishes two identical boards, which is what
     * keeps their build dirs and saved settings from colliding.
     */
    deviceSerialNumber?: string
    /** Product key (e.g. "ex_commandstation") */
    product: string
    /** Product display name (e.g. "EX-CommandStation") */
    productName: string
    /** Selected version tag (e.g. "v5.2.80-Prod") */
    version: string
    /** Absolute path to the cloned repository on disk (git source) */
    repoPath: string
    /** Absolute path to the per-device scratch/build directory */
    scratchPath: string
    /** Editable config file contents at the time of last save */
    configFiles: Array<{ name: string; content: string }>
    /** ISO 8601 date string of when this config was last modified */
    lastModified: string
    /**
     * Original user folder path when loaded via "Load from Folder" without a .ino file.
     * When set, config files are written back to this folder on every Save so the
     * user's source folder stays in sync with edits made in the workspace.
     */
    sourceFolder?: string
    /**
     * Per-project override for the "Strict aliases" enforcement setting — undefined means "use
     * the app-wide preference" (Settings dialog / PreferencesService's own 'strictAliases' key),
     * same as every project before this field existed. Set explicitly by the existing-project
     * importer's summary dialog (which defaults it off — a hand-rolled project rarely has full
     * alias coverage yet) so that choice sticks to just this project rather than silently
     * overwriting the app-wide default new/other projects also use. Once set, workspace.ts's
     * Settings dialog toggle updates this field instead of the app-wide preference for as long as
     * this project stays open — see workspace.ts's binding()/setStrictAliases().
     */
    strictAliases?: boolean
}
