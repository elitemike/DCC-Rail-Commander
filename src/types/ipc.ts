/**
 * Shared IPC type contracts — imported by main, preload, and renderer.
 * Keep this file free of Node.js / browser-only dependencies so it is
 * safe to import from every process.
 */

// ── USB / Serial ─────────────────────────────────────────────────────────────

export interface SerialDeviceInfo {
    path: string
    manufacturer?: string
    serialNumber?: string
    vendorId?: string
    productId?: string
}

export interface UsbDeviceInfo {
    vendorId: number
    productId: number
    deviceAddress: number
    busNumber: number
    deviceDescriptor: {
        idVendor: number
        idProduct: number
        iManufacturer: number
        iProduct: number
        iSerialNumber: number
    }
}

// ── Python ───────────────────────────────────────────────────────────────────

export interface PythonJobOptions {
    script: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    mode?: 'text' | 'json' | 'binary'
}

export interface PythonJobResult {
    jobId: string
    exitCode: number | null
    output: string[]
    error?: string
}

// ── Window-level API surfaces exposed through contextBridge ──────────────────

export interface UsbElectronApi {
    listSerialPorts: () => Promise<SerialDeviceInfo[]>
    listUsbDevices: () => Promise<UsbDeviceInfo[]>
    openPort: (path: string, baudRate?: number) => Promise<void>
    writeToPort: (path: string, data: string) => Promise<void>
    closePort: (path: string) => Promise<void>
    isPortOpen: (path: string) => Promise<boolean>
    onData: (cb: (payload: { path: string; data: string }) => void) => () => void
    onError: (cb: (payload: { path: string; message: string }) => void) => () => void
    onClosed: (cb: (payload: { path: string }) => void) => () => void
    onAttached: (cb: (payload: { vendorId: number; productId: number }) => void) => () => void
    onDetached: (cb: (payload: { vendorId: number; productId: number }) => void) => () => void
}

export interface PythonElectronApi {
    run: (options: PythonJobOptions) => Promise<PythonJobResult>
    send: (jobId: string, message: string) => Promise<void>
    kill: (jobId: string) => Promise<void>
    onStdout: (cb: (payload: { jobId: string; line: string }) => void) => () => void
    onStderr: (cb: (payload: { jobId: string; line: string }) => void) => () => void
    onDone: (cb: (result: PythonJobResult) => void) => () => void
    onError: (cb: (payload: { jobId: string; message: string }) => void) => () => void
}

// ── Augment Window global ─────────────────────────────────────────────────────

// ── PlatformIO build backend ─────────────────────────────────────────────────

export interface PioPlatformInfo {
    id: string
    installed: string
    latest: string
    name: string
}

/**
 * A connected board. The FQBN stays the app-wide board identity — it is
 * persisted in saved configurations and embedded in config.h — and the main
 * process translates it into a PlatformIO target when building.
 */
export interface DetectedBoardInfo {
    name: string
    fqbn: string
    port: string
    protocol: string
    serialNumber?: string
}

export interface CompileResult {
    success: boolean
    output: string
    error?: string
}

export interface UploadResult {
    success: boolean
    output: string
    error?: string
}

export interface PlatformIoElectronApi {
    /** True once the bundled runtime is present and its toolchains are seeded. */
    isRuntimeReady: () => Promise<boolean>
    /** Copies the bundled platform packs into the writable core dir (once). */
    seedRuntime: () => Promise<{ success: boolean; error?: string }>
    getVersion: () => Promise<string | null>
    getBundledVersion: () => Promise<string>
    getPlatforms: () => Promise<PioPlatformInfo[]>
    /** Whether the toolchain for a board's FQBN is available locally. */
    checkToolchain: (fqbn: string) => Promise<{ installed: boolean; version: string | null }>
    listBoards: () => Promise<DetectedBoardInfo[]>
    compile: (sketchPath: string, fqbn: string) => Promise<CompileResult>
    upload: (sketchPath: string, fqbn: string, port: string) => Promise<UploadResult>
    browseToolchainPack: () => Promise<string | null>
    importToolchainPack: (archivePath: string) => Promise<{ success: boolean; error?: string }>
    onProgress: (cb: (payload: { phase: string; message: string }) => void) => () => void
}

// ── Git ──────────────────────────────────────────────────────────────────────

export interface GitVersionInfo {
    tag: string
    major: number
    minor: number
    patch: number
    type: 'Prod' | 'Devel' | 'unknown'
}

export interface GitElectronApi {
    clone: (url: string, dest: string, branch?: string) => Promise<{ success: boolean; error?: string }>
    pull: (repoPath: string) => Promise<{ success: boolean; error?: string }>
    listTags: (repoPath: string) => Promise<string[]>
    checkout: (repoPath: string, ref: string) => Promise<{ success: boolean; error?: string }>
    checkLocalChanges: (repoPath: string) => Promise<{ hasChanges: boolean; files: string[] }>
    hardReset: (repoPath: string) => Promise<{ success: boolean; error?: string }>
}

// ── File System ──────────────────────────────────────────────────────────────

export interface FileElectronApi {
    readFile: (filePath: string) => Promise<string>
    writeFile: (filePath: string, content: string) => Promise<void>
    listDir: (dirPath: string) => Promise<string[]>
    exists: (filePath: string) => Promise<boolean>
    mkdir: (dirPath: string) => Promise<void>
    copyFiles: (src: string, dest: string) => Promise<void>
    deleteFiles: (filePath: string) => Promise<void>
    getInstallDir: (subdir?: string) => Promise<string>
    selectDirectory: () => Promise<string | null>
}

// ── Preferences ──────────────────────────────────────────────────────────────

export interface PreferencesElectronApi {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    getAll: () => Promise<Record<string, unknown>>
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface ConfigElectronApi {
    getMock: () => Promise<boolean>
    getSkipStartup: () => Promise<boolean>
}

// ── Window ───────────────────────────────────────────────────────────────────

export interface WindowElectronApi {
    /** Subscribe to a close-requested event pushed from the main process. */
    onCloseRequested: (cb: () => void) => () => void
    /** Tell the main process to forcefully destroy the window. */
    forceClose: () => Promise<void>
    /** Puts the OS window into (or out of) native full screen — hides the title bar entirely. */
    setFullScreen: (value: boolean) => Promise<void>
    isFullScreen: () => Promise<boolean>
    /** Fires when native full screen is entered/exited by any means (in-app toggle or an OS-level shortcut). */
    onFullScreenChanged: (cb: (value: boolean) => void) => () => void
}

declare global {
    interface Window {
        usb: UsbElectronApi
        python: PythonElectronApi
        platformio: PlatformIoElectronApi
        git: GitElectronApi
        files: FileElectronApi
        preferences: PreferencesElectronApi
        config: ConfigElectronApi
        electronWindow: WindowElectronApi
    }
}
