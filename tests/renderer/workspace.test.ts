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
    autoConnectMonitor?: boolean
} = {}) {
    const workspace = Object.create(Workspace.prototype) as Workspace

    const uploadFn = vi.fn().mockResolvedValue({ success: true, output: 'Flash written successfully.' })
    const closePortFn = vi.fn().mockResolvedValue(undefined)
    const isPortOpenFn = vi.fn().mockResolvedValue(false)
    const preferencesSetFn = vi.fn().mockResolvedValue(undefined)

    Object.assign(workspace, {
        state: {
            selectedDevice: opts.device === undefined ? { ...DEVICE } : opts.device,
            configFiles: [{ name: 'config.h', content: '' }],
            scratchPath: '/scratch',
            sourceFolder: null,
            savedConfigurations: [],
            activeConfigId: null,
        },
        configEditorState: { configHContent: '', syncAll: vi.fn(), clearChanges: vi.fn() },
        toastService: { show: vi.fn() },
        preferences: { get: vi.fn().mockResolvedValue(undefined), set: preferencesSetFn },
        files: { writeFile: vi.fn().mockResolvedValue(undefined), exists: vi.fn().mockResolvedValue(false) },
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
            isPortOpen: isPortOpenFn,
            closePort: closePortFn,
        },
        deviceConnectionStatus: 'unknown',
        showMonitor: opts.showMonitor ?? false,
        autoConnectMonitor: opts.autoConnectMonitor ?? true,
        activeBottomTab: 'output',
        isCompiling: false,
        compileError: null,
        compileSuccess: null,
        progressPercent: 0,
        compileLog: '',
        splitterObj: null,
    })

    return { workspace, uploadFn, closePortFn, isPortOpenFn, preferencesSetFn }
}

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

    it('auto-opens the Monitor on a fresh transition into connected', async () => {
        const { workspace } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
        })

        await workspace.checkDeviceConnection()

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

        // User closes it manually.
        workspace.showMonitor = false

        // An unrelated re-check (e.g. a hotplug event for some other device)
        // must not reopen it — status stays 'connected' -> 'connected', no transition.
        await workspace.checkDeviceConnection()

        expect(workspace.showMonitor).toBe(false)
    })

    it('does not auto-open the Monitor on a fresh connect when autoConnectMonitor is off', async () => {
        const { workspace } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
            autoConnectMonitor: false,
        })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('connected')
        expect(workspace.showMonitor).toBe(false)
    })

    it('does not touch the Monitor when the device is not connected', async () => {
        const { workspace } = makeWorkspace({ serialPorts: [], cliBoards: [], showMonitor: false })

        await workspace.checkDeviceConnection()

        expect(workspace.deviceConnectionStatus).toBe('disconnected')
        expect(workspace.showMonitor).toBe(false)
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

// ── upload() — Monitor pause/resume around the port-exclusive upload ────────

describe('Workspace.upload monitor handling', () => {
    it('closes an open Monitor connection before uploading and reopens it afterwards on success', async () => {
        const { workspace, uploadFn, closePortFn, isPortOpenFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: true,
        })
        workspace.activeBottomTab = 'monitor'
        isPortOpenFn.mockResolvedValue(true)

        let monitorWasHiddenDuringUpload = false
        uploadFn.mockImplementation(async () => {
            monitorWasHiddenDuringUpload = workspace.showMonitor === false
            return { success: true, output: 'Flash written successfully.' }
        })

        await workspace.upload()

        expect(closePortFn).toHaveBeenCalledWith('/dev/ttyACM0')
        // closePort() must have been awaited before pio.upload() ran.
        expect(closePortFn.mock.invocationCallOrder[0]).toBeLessThan(uploadFn.mock.invocationCallOrder[0])
        expect(monitorWasHiddenDuringUpload).toBe(true)
        expect(workspace.showMonitor).toBe(true)
        expect(workspace.activeBottomTab).toBe('monitor')
        expect(workspace.compileSuccess).toBe(true)
    })

    it('reopens the Monitor even when the upload fails', async () => {
        const { workspace, uploadFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: true,
        })
        uploadFn.mockResolvedValue({ success: false, output: '', error: 'esptool: port busy' })

        await workspace.upload()

        expect(workspace.compileSuccess).toBe(false)
        expect(workspace.showMonitor).toBe(true)
    })

    it('does not force the Monitor open after upload when it was not open beforehand', async () => {
        const { workspace } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
        })

        await workspace.upload()

        expect(workspace.showMonitor).toBe(false)
    })

    it('does not attempt to close the port when the Monitor is not open and nothing has it open', async () => {
        const { workspace, closePortFn, isPortOpenFn } = makeWorkspace({
            serialPorts: [{ path: '/dev/ttyACM0', manufacturer: 'Arduino', serialNumber: 'X', vendorId: '2341', productId: '0042' }],
            cliBoards: [DEVICE],
            showMonitor: false,
        })
        isPortOpenFn.mockResolvedValue(false)

        await workspace.upload()

        expect(closePortFn).not.toHaveBeenCalled()
    })
})
