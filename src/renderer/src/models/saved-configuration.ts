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
    /** Arduino FQBN string – empty if board wasn't identified by CLI */
    deviceFqbn: string
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
}
