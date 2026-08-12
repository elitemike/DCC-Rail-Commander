import { describe, it, expect, vi } from 'vitest'
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
            configFiles: [{ name: 'config.h', content: '' }],
            scratchPath: '/scratch',
            sourceFolder: null,
            savedConfigurations: [],
            activeConfigId: null,
            repoPath: opts.repoPath === undefined ? '/repo' : opts.repoPath,
            selectedVersion: opts.selectedVersion ?? null,
        },
        configEditorState: { configHContent: '', syncAll: vi.fn(), clearChanges: vi.fn() },
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
