import { describe, it, expect, vi } from 'vitest'

// Workspace pulls in dccex-validators.ts (strict-compile's error-marker check), which imports
// the real monaco-editor package — that package touches `window` at module scope and crashes
// under vitest's node environment, same reason exrail-block-registry.test.ts and
// dccex-validators.test.ts mock it.
vi.mock('monaco-editor', () => ({
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
        setModelMarkers: vi.fn(),
        getModels: () => [],
        getModelMarkers: () => [],
        onDidCreateModel: vi.fn(),
        onDidChangeMarkers: vi.fn(() => ({ dispose: vi.fn() })),
    },
}))

import { Workspace } from '../../src/renderer/src/views/workspace'
import type { DetectedBoardInfo, SerialDeviceInfo } from '../../src/types/ipc'

// ── Factory ───────────────────────────────────────────────────────────────────
// Built like tests/renderer/servo-calibration-dialog.test.ts and
// tests/renderer/device-picker-dialog.test.ts: a bare prototype instance with
// fields assigned manually, avoiding a full Aurelia DI bootstrap.

const DEVICE: DetectedBoardInfo = {
    name: 'Arduino Mega 2560',
    port: '/dev/ttyACM0',
    fqbn: 'arduino:avr:mega',
    protocol: 'serial',
}

function makeWorkspace(opts: {
    device?: DetectedBoardInfo | null
    serialPorts?: SerialDeviceInfo[]
    cliBoards?: DetectedBoardInfo[]
    listBoardsError?: boolean
    showMonitor?: boolean
    portConnected?: boolean
    autoConnectMonitor?: boolean
    showMonitorOnConnect?: boolean
    openPortError?: string
    repoPath?: string | null
    selectedVersion?: string | null
    tags?: string[]
    useLatestProdVersion?: boolean
    strictCompile?: boolean
    hasBlockingErrors?: boolean
    filesWithErrors?: Set<string>
    configFiles?: { name: string; content: string }[]
} = {}) {
    const workspace = Object.create(Workspace.prototype) as Workspace

    const uploadFn = vi.fn().mockResolvedValue({ success: true, output: 'Flash written successfully.' })
    const openPortFn = opts.openPortError
        ? vi.fn().mockRejectedValue(new Error(opts.openPortError))
        : vi.fn().mockResolvedValue(undefined)
    const closePortFn = vi.fn().mockResolvedValue(undefined)
    const isPortOpenFn = vi.fn().mockResolvedValue(false)
    const preferencesSetFn = vi.fn().mockResolvedValue(undefined)
    const toastShowFn = vi.fn()
    const listTagsFn = vi.fn().mockResolvedValue(opts.tags ?? [])

    Object.assign(workspace, {
        state: {
            selectedDevice: opts.device === undefined ? { ...DEVICE } : opts.device,
            configFiles: opts.configFiles ?? [{ name: 'config.h', content: '' }],
            scratchPath: '/scratch',
            sourceFolder: null,
            savedConfigurations: [],
            activeConfigId: null,
            repoPath: opts.repoPath === undefined ? '/repo' : opts.repoPath,
            selectedVersion: opts.selectedVersion ?? null,
        },
        configEditorState: { configHContent: '', syncAll: vi.fn(), clearChanges: vi.fn(), strictAliases: true },
        toastService: { show: toastShowFn },
        preferences: { get: vi.fn().mockResolvedValue(undefined), set: preferencesSetFn },
        files: { writeFile: vi.fn().mockResolvedValue(undefined), exists: vi.fn().mockResolvedValue(false) },
        git: { pull: vi.fn().mockResolvedValue(undefined), listTags: listTagsFn },
        useLatestProdVersion: opts.useLatestProdVersion ?? true,
        pio: {
            listBoards: opts.listBoardsError
                ? vi.fn().mockRejectedValue(new Error('board scan failed'))
                : vi.fn().mockResolvedValue(opts.cliBoards ?? []),
            upload: uploadFn,
            subscribeToProgress: vi.fn().mockReturnValue(() => { /* unsub */ }),
        },
        usb: {
            initialize: vi.fn().mockResolvedValue(undefined),
            refresh: vi.fn().mockResolvedValue(undefined),
            serialPorts: opts.serialPorts ?? [],
            openPort: openPortFn,
            isPortOpen: isPortOpenFn,
            closePort: closePortFn,
        },
        deviceConnectionStatus: 'unknown',
        showMonitor: opts.showMonitor ?? false,
        portConnected: opts.portConnected ?? false,
        autoConnectMonitor: opts.autoConnectMonitor ?? true,
        showMonitorOnConnect: opts.showMonitorOnConnect ?? true,
        strictCompile: opts.strictCompile ?? false,
        hasBlockingErrors: opts.hasBlockingErrors ?? false,
        filesWithErrors: opts.filesWithErrors ?? new Set<string>(),
        activeSection: 'config',
        activeBottomTab: 'output',
        isCompiling: false,
        compileError: null,
        compileSuccess: null,
        progressPercent: 0,
        compileLog: '',
        splitterObj: null,
    })

    return { workspace, uploadFn, openPortFn, closePortFn, isPortOpenFn, preferencesSetFn, toastShowFn, listTagsFn }
}

// ── connect() / disconnect() / toggleConnect() ───────────────────────────────

describe('Workspace.connect', () => {
    it('opens the port and sets portConnected', async () => {
        const { workspace, openPortFn } = makeWorkspace()

        const ok = await workspace.connect()

        expect(ok).toBe(true)
        expect(openPortFn).toHaveBeenCalledWith('/dev/ttyACM0', 115200)
        expect(workspace.portConnected).toBe(true)
    })

    it('is a no-op that reports success if already connected', async () => {
        const { workspace, openPortFn } = makeWorkspace({ portConnected: true })

        const ok = await workspace.connect()

        expect(ok).toBe(true)
        expect(openPortFn).not.toHaveBeenCalled()
    })

    it('does not open the Monitor unless explicitly asked to', async () => {
        const { workspace } = makeWorkspace({ showMonitor: false })

        await workspace.connect()

        expect(workspace.showMonitor).toBe(false)
    })

    it('opens the Monitor when openMonitor is passed', async () => {
        const { workspace } = makeWorkspace({ showMonitor: false })

        await workspace.connect({ openMonitor: true })

        expect(workspace.showMonitor).toBe(true)
        expect(workspace.activeBottomTab).toBe('monitor')
    })

    it('treats "already open" as a successful attach rather than a failure', async () => {
        const { workspace, toastShowFn } = makeWorkspace({ openPortError: 'Port already open elsewhere' })

        const ok = await workspace.connect()

        expect(ok).toBe(true)
        expect(workspace.portConnected).toBe(true)
        expect(toastShowFn).not.toHaveBeenCalled()
    })

    it('reports failure and toasts on a genuine open error', async () => {
        const { workspace, toastShowFn } = makeWorkspace({ openPortError: 'Access denied' })

        const ok = await workspace.connect()

        expect(ok).toBe(false)
        expect(workspace.portConnected).toBe(false)
        expect(toastShowFn).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connect Failed' }))
    })

    it('does nothing when there is no selected device port', async () => {
        const { workspace, openPortFn } = makeWorkspace({ device: { ...DEVICE, port: '' } })

        const ok = await workspace.connect()

        expect(ok).toBe(false)
        expect(openPortFn).not.toHaveBeenCalled()
    })
})

describe('Workspace.disconnect', () => {
    it('closes an open port and clears portConnected', async () => {
        const { workspace, closePortFn, isPortOpenFn } = makeWorkspace({ portConnected: true })
        isPortOpenFn.mockResolvedValue(true)

        await workspace.disconnect()

        expect(closePortFn).toHaveBeenCalledWith('/dev/ttyACM0')
        expect(workspace.portConnected).toBe(false)
    })

    it('does not open the Monitor or otherwise touch it', async () => {
        const { workspace } = makeWorkspace({ portConnected: true, showMonitor: true })

        await workspace.disconnect()

        expect(workspace.showMonitor).toBe(true)
    })
})

describe('Workspace.toggleConnect', () => {
    it('connects when not connected', async () => {
        const { workspace, openPortFn } = makeWorkspace({ portConnected: false })

        await workspace.toggleConnect()

        expect(openPortFn).toHaveBeenCalled()
        expect(workspace.portConnected).toBe(true)
    })

    it('disconnects when connected', async () => {
        const { workspace, closePortFn, isPortOpenFn } = makeWorkspace({ portConnected: true })
        isPortOpenFn.mockResolvedValue(true)

        await workspace.toggleConnect()

        expect(closePortFn).toHaveBeenCalled()
        expect(workspace.portConnected).toBe(false)
    })
})

// ── selectThrottleSection() ──────────────────────────────────────────────────

describe('Workspace.selectThrottleSection', () => {
    it('auto-connects before switching to the Throttle section when not already connected', async () => {
        const { workspace, openPortFn } = makeWorkspace({ portConnected: false })

        await workspace.selectThrottleSection()

        expect(openPortFn).toHaveBeenCalled()
        expect(workspace.portConnected).toBe(true)
        expect(workspace.activeSection).toBe('throttle')
    })

    it('does not open the Monitor as a side effect of the auto-connect', async () => {
        const { workspace } = makeWorkspace({ portConnected: false, showMonitor: false })

        await workspace.selectThrottleSection()

        expect(workspace.showMonitor).toBe(false)
    })

    it('switches straight to Throttle without reconnecting if already connected', async () => {
        const { workspace, openPortFn } = makeWorkspace({ portConnected: true })

        await workspace.selectThrottleSection()

        expect(openPortFn).not.toHaveBeenCalled()
        expect(workspace.activeSection).toBe('throttle')
    })

    it('stays out of the Throttle section if the auto-connect fails', async () => {
        const { workspace } = makeWorkspace({ portConnected: false, openPortError: 'Access denied' })

        await workspace.selectThrottleSection()

        expect(workspace.activeSection).toBe('config')
    })
})

// ── checkDeviceConnection() ──────────────────────────────────────────────────

describe('Workspace.checkDeviceConnection', () => {
    it('sets disconnected when the selected device has no port', async () => {
        const { workspace } = makeWorkspace({ device: { ...DEVICE, port: '' } })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('disconnected')
    })

    it('sets connected when a live board matches the recorded port', async () => {
        const { workspace } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
        })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('connected')
    })

    it('sets disconnected when no live board matches the recorded port', async () => {
        const { workspace } = makeWorkspace({ serialPorts: [], cliBoards: [] })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('disconnected')
    })

    it('still resolves connected via the raw serial-port fallback when the CLI call fails', async () => {
        const { workspace } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            listBoardsError: true,
        })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('connected')
    })

    it('auto-connects (and opens the Monitor) on a fresh transition into connected', async () => {
        const { workspace, openPortFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
        })

        await workspace.checkDeviceConnection()

        expect(openPortFn).toHaveBeenCalled()
        expect(workspace.portConnected).toBe(true)
        expect(workspace.showMonitor).toBe(true)
        expect(workspace.activeBottomTab).toBe('monitor')
    })

    it('does not force the Monitor open if the user already closed it while staying connected', async () => {
        const { workspace } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
        })
        // First check: fresh connect, opens the Monitor (matches the test above).
        await workspace.checkDeviceConnection()
        expect(workspace.showMonitor).toBe(true)

        // User closes it manually — the connection itself is untouched.
        workspace.showMonitor = false

        // An unrelated re-check (e.g. a hotplug event for some other device)
        // must not reopen it — status stays 'connected' -> 'connected', no transition.
        await workspace.checkDeviceConnection()

        expect(workspace.showMonitor).toBe(false)
        expect(workspace.portConnected).toBe(true)
    })

    it('does not auto-connect on a fresh detect when autoConnectMonitor is off', async () => {
        const { workspace, openPortFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
            autoConnectMonitor: false,
        })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('connected')
        expect(openPortFn).not.toHaveBeenCalled()
        expect(workspace.portConnected).toBe(false)
        expect(workspace.showMonitor).toBe(false)
    })

    it('auto-connects without opening the Monitor when showMonitorOnConnect is off', async () => {
        const { workspace, openPortFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
            showMonitorOnConnect: false,
        })

        await workspace.checkDeviceConnection()

        expect(openPortFn).toHaveBeenCalled()
        expect(workspace.portConnected).toBe(true)
        expect(workspace.showMonitor).toBe(false)
    })

    it('drops portConnected when the device stops being live', async () => {
        const { workspace } = makeWorkspace({
            serialPorts: [],
            cliBoards: [],
            portConnected: true,
        })
        workspace.deviceConnectionStatus = 'connected'

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('disconnected')
        expect(workspace.portConnected).toBe(false)
    })

    it('does not touch the Monitor when the device is not connected', async () => {
        const { workspace } = makeWorkspace({ serialPorts: [], cliBoards: [], showMonitor: false })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('disconnected')
        expect(workspace.showMonitor).toBe(false)
    })
})

// ── loadVersions() — useLatestProdVersion preference ─────────────────────────

describe('Workspace.loadVersions', () => {
    it('overrides the selected version with the latest Prod tag when useLatestProdVersion is on', async () => {
        const { workspace } = makeWorkspace({
            selectedVersion: 'v5.3.0-Prod',
            tags: ['v5.3.0-Prod', 'v5.4.0-Prod', 'v5.5.0-Devel'],
            useLatestProdVersion: true,
        })

        await workspace.loadVersions()

        expect(workspace.state.selectedVersion).toBe('v5.4.0-Prod')
    })

    it('keeps a manually chosen version when useLatestProdVersion is off', async () => {
        const { workspace } = makeWorkspace({
            selectedVersion: 'v5.3.0-Prod',
            tags: ['v5.3.0-Prod', 'v5.4.0-Prod'],
            useLatestProdVersion: false,
        })

        await workspace.loadVersions()

        expect(workspace.state.selectedVersion).toBe('v5.3.0-Prod')
    })

    it('still picks the latest Prod tag when useLatestProdVersion is off but nothing is selected yet', async () => {
        const { workspace } = makeWorkspace({
            selectedVersion: null,
            tags: ['v5.3.0-Prod', 'v5.4.0-Prod'],
            useLatestProdVersion: false,
        })

        await workspace.loadVersions()

        expect(workspace.state.selectedVersion).toBe('v5.4.0-Prod')
    })

    it('keeps a manually chosen version selectable even when it is not among the fetched tags', async () => {
        const { workspace } = makeWorkspace({
            selectedVersion: 'v5.2.0-Prod',
            tags: ['v5.4.0-Prod'],
            useLatestProdVersion: false,
        })

        await workspace.loadVersions()

        expect(workspace.state.selectedVersion).toBe('v5.2.0-Prod')
        expect(workspace.versions).toContain('v5.2.0-Prod')
    })
})

// ── setAutoConnectMonitor() — persisted app-wide preference ─────────────────

describe('Workspace.setAutoConnectMonitor', () => {
    it('updates the field and persists it to preferences', () => {
        const { workspace, preferencesSetFn } = makeWorkspace({ autoConnectMonitor: true })

        workspace.setAutoConnectMonitor(false)

        expect(workspace.autoConnectMonitor).toBe(false)
        expect(preferencesSetFn).toHaveBeenCalledWith('autoConnectMonitor', false)
    })
})

// ── setShowMonitorOnConnect() / setVerboseCompile() / setUseLatestProdVersion() ──
// Same "persisted app-wide preference" shape as setAutoConnectMonitor, now
// surfaced from the Settings dialog rather than a toolbar checkbox.

describe('Workspace.setShowMonitorOnConnect', () => {
    it('updates the field and persists it to preferences', () => {
        const { workspace, preferencesSetFn } = makeWorkspace({ showMonitorOnConnect: true })

        workspace.setShowMonitorOnConnect(false)

        expect(workspace.showMonitorOnConnect).toBe(false)
        expect(preferencesSetFn).toHaveBeenCalledWith('showMonitorOnConnect', false)
    })
})

describe('Workspace.setVerboseCompile', () => {
    it('updates the field and persists it to preferences', () => {
        const { workspace, preferencesSetFn } = makeWorkspace()
        workspace.verboseCompile = false

        workspace.setVerboseCompile(true)

        expect(workspace.verboseCompile).toBe(true)
        expect(preferencesSetFn).toHaveBeenCalledWith('verboseCompile', true)
    })
})

describe('Workspace.setUseLatestProdVersion', () => {
    it('updates the field and persists it to preferences', () => {
        const { workspace, preferencesSetFn } = makeWorkspace()
        workspace.useLatestProdVersion = true

        workspace.setUseLatestProdVersion(false)

        expect(workspace.useLatestProdVersion).toBe(false)
        expect(preferencesSetFn).toHaveBeenCalledWith('useLatestProdVersion', false)
    })
})

describe('Workspace.setStrictCompile', () => {
    it('updates the field and persists it to preferences', () => {
        const { workspace, preferencesSetFn } = makeWorkspace()
        workspace.strictCompile = false

        workspace.setStrictCompile(true)

        expect(workspace.strictCompile).toBe(true)
        expect(preferencesSetFn).toHaveBeenCalledWith('strictCompile', true)
    })
})

describe('Workspace.setStrictAliases', () => {
    it('updates the field, mirrors it onto configEditorState, and persists it to preferences', () => {
        const { workspace, preferencesSetFn } = makeWorkspace()
        workspace.strictAliases = true

        workspace.setStrictAliases(false)

        expect(workspace.strictAliases).toBe(false)
        expect(workspace.configEditorState.strictAliases).toBe(false)
        expect(preferencesSetFn).toHaveBeenCalledWith('strictAliases', false)
    })
})

// ── canCompile — device gating plus, when strictCompile is on, the error-marker gate ──

describe('Workspace.canCompile', () => {
    it('is true for a fully-selected device when strictCompile is off, even with blocking errors', () => {
        const { workspace } = makeWorkspace({ strictCompile: false, hasBlockingErrors: true })
        expect(workspace.canCompile).toBe(true)
    })

    it('is true when strictCompile is on but there are no blocking errors', () => {
        const { workspace } = makeWorkspace({ strictCompile: true, hasBlockingErrors: false })
        expect(workspace.canCompile).toBe(true)
    })

    it('is false when strictCompile is on and there are blocking errors', () => {
        const { workspace } = makeWorkspace({ strictCompile: true, hasBlockingErrors: true })
        expect(workspace.canCompile).toBe(false)
    })

    it('stays false for an incomplete device selection regardless of strictCompile', () => {
        const { workspace } = makeWorkspace({ device: null, strictCompile: false, hasBlockingErrors: false })
        expect(workspace.canCompile).toBe(false)
    })
})

// ── fileHasError() and the Device Settings row *HasError getters — the file-list error dot ──

describe('Workspace.fileHasError', () => {
    it('is false for a filename not present in filesWithErrors', () => {
        const { workspace } = makeWorkspace({ filesWithErrors: new Set(['myRoster.h']) })
        expect(workspace.fileHasError('mySensors.h')).toBe(false)
    })

    it('is true for a filename present in filesWithErrors', () => {
        const { workspace } = makeWorkspace({ filesWithErrors: new Set(['myRoster.h']) })
        expect(workspace.fileHasError('myRoster.h')).toBe(true)
    })
})

describe('Workspace Device Settings row *HasError getters', () => {
    it('generalWifiHasError is true when either config.h or myConfig.h has an error', () => {
        const { workspace: a } = makeWorkspace({ filesWithErrors: new Set(['config.h']) })
        expect(a.generalWifiHasError).toBe(true)

        const { workspace: b } = makeWorkspace({ filesWithErrors: new Set(['myConfig.h']) })
        expect(b.generalWifiHasError).toBe(true)

        const { workspace: c } = makeWorkspace({ filesWithErrors: new Set(['myRoster.h']) })
        expect(c.generalWifiHasError).toBe(false)
    })

    it('startupHasError tracks myStartup.h', () => {
        const { workspace } = makeWorkspace({ filesWithErrors: new Set(['myStartup.h']) })
        expect(workspace.startupHasError).toBe(true)
    })

    it('accessoriesHasError and automationHasError both track myAutomation.h, since Accessories is a slice of it', () => {
        const { workspace } = makeWorkspace({ filesWithErrors: new Set(['myAutomation.h']) })
        expect(workspace.accessoriesHasError).toBe(true)
        expect(workspace.automationHasError).toBe(true)
    })

    it('all *HasError getters are false when filesWithErrors is empty', () => {
        const { workspace } = makeWorkspace({ filesWithErrors: new Set() })
        expect(workspace.generalWifiHasError).toBe(false)
        expect(workspace.startupHasError).toBe(false)
        expect(workspace.accessoriesHasError).toBe(false)
        expect(workspace.automationHasError).toBe(false)
    })
})

// ── upload() — connect/disconnect around the port-exclusive upload ──────────
// Monitor visibility is deliberately never touched here — it's just a view.

describe('Workspace.upload connection handling', () => {
    it('disconnects before uploading and reconnects afterwards on success, leaving Monitor visibility untouched', async () => {
        const { workspace, uploadFn, openPortFn, closePortFn, isPortOpenFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: true,
            portConnected: true,
        })
        workspace.activeBottomTab = 'monitor'
        isPortOpenFn.mockResolvedValue(true)

        let wasDisconnectedDuringUpload = false
        uploadFn.mockImplementation(async () => {
            wasDisconnectedDuringUpload = workspace.portConnected === false
            return { success: true, output: 'Flash written successfully.' }
        })

        await workspace.upload()

        expect(closePortFn).toHaveBeenCalledWith('/dev/ttyACM0')
        // close must be awaited before pio.upload() runs, and open must follow it.
        expect(closePortFn.mock.invocationCallOrder[0]).toBeLessThan(uploadFn.mock.invocationCallOrder[0])
        expect(openPortFn.mock.invocationCallOrder[0]).toBeGreaterThan(uploadFn.mock.invocationCallOrder[0])
        expect(wasDisconnectedDuringUpload).toBe(true)
        expect(workspace.portConnected).toBe(true)
        // Monitor was already showing and stays showing — upload never touches it.
        expect(workspace.showMonitor).toBe(true)
        expect(workspace.activeBottomTab).toBe('monitor')
        expect(workspace.compileSuccess).toBe(true)
    })

    it('reconnects even when the upload fails', async () => {
        const { workspace, uploadFn, openPortFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            portConnected: true,
        })
        uploadFn.mockResolvedValue({ success: false, output: '', error: 'esptool: port busy' })

        await workspace.upload()

        expect(workspace.compileSuccess).toBe(false)
        expect(openPortFn).toHaveBeenCalled()
        expect(workspace.portConnected).toBe(true)
    })

    it('does not attempt to reconnect after upload when not connected beforehand', async () => {
        const { workspace, openPortFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            portConnected: false,
        })

        await workspace.upload()

        expect(openPortFn).not.toHaveBeenCalled()
        expect(workspace.portConnected).toBe(false)
    })

    it('does not attempt to disconnect when not connected beforehand', async () => {
        const { workspace, closePortFn, isPortOpenFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            portConnected: false,
        })

        await workspace.upload()

        expect(isPortOpenFn).not.toHaveBeenCalled()
        expect(closePortFn).not.toHaveBeenCalled()
    })
})

// ── removeCustomFile() ────────────────────────────────────────────────────────

describe('Workspace.removeCustomFile', () => {
    function makeRemovableWorkspace(sourceFolder: string | null, confirmed = true) {
        const { workspace, preferencesSetFn } = makeWorkspace()
        workspace.state.configFiles = [{ name: 'config.h', content: '' }, { name: 'myFile.h', content: 'x' }]
        workspace.state.scratchPath = '/scratch'
        workspace.state.sourceFolder = sourceFolder
        workspace.activeFileIndex = 1
        const deleteFilesFn = vi.fn().mockResolvedValue(undefined)
        Object.assign(workspace.files, { deleteFiles: deleteFilesFn })
        const removeCustomFileFn = vi.fn()
        Object.assign(workspace.configEditorState, {
            isCustomFile: vi.fn().mockReturnValue(true),
            removeCustomFile: removeCustomFileFn,
        })
        Object.assign(workspace, {
            dialogService: {
                open: vi.fn().mockResolvedValue({
                    dialog: { closed: Promise.resolve({ status: confirmed ? 'ok' : 'cancel' }) },
                }),
            },
        })
        return { workspace, deleteFilesFn, removeCustomFileFn, preferencesSetFn }
    }

    it('deletes the file from the scratch dir on disk', async () => {
        const { workspace, deleteFilesFn, removeCustomFileFn } = makeRemovableWorkspace(null)

        await workspace.removeCustomFile(1, new Event('click'))

        expect(deleteFilesFn).toHaveBeenCalledWith('/scratch/myFile.h')
        expect(deleteFilesFn).toHaveBeenCalledTimes(1)
        expect(removeCustomFileFn).toHaveBeenCalledWith('myFile.h')
    })

    it('also deletes from sourceFolder when the config was loaded from a folder without a .ino', async () => {
        const { workspace, deleteFilesFn } = makeRemovableWorkspace('/source')

        await workspace.removeCustomFile(1, new Event('click'))

        expect(deleteFilesFn).toHaveBeenCalledWith('/scratch/myFile.h')
        expect(deleteFilesFn).toHaveBeenCalledWith('/source/myFile.h')
        expect(deleteFilesFn).toHaveBeenCalledTimes(2)
    })

    it('does not touch disk when the user cancels the confirmation', async () => {
        const { workspace, deleteFilesFn, removeCustomFileFn } = makeRemovableWorkspace(null, false)

        await workspace.removeCustomFile(1, new Event('click'))

        expect(deleteFilesFn).not.toHaveBeenCalled()
        expect(removeCustomFileFn).not.toHaveBeenCalled()
    })
})
