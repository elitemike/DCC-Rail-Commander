import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Workspace } from '../views/workspace'
import type { InstallerState } from '../models/installer-state'
import type { ArduinoCliService } from '../services/arduino-cli.service'
import type { FileService } from '../services/file.service'

// ── Factory ───────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: {
    state?: Partial<InstallerState>
    cli?: Partial<ArduinoCliService>
    files?: Partial<FileService>
} = {}): Workspace {
    const ws = Object.create(Workspace.prototype) as Workspace

    const state = {
        selectedDevice: null,
        repoPath: null,
        configFiles: [],
        savedConfigurations: [],
        activeConfigId: null,
        selectedProduct: null,
        selectedVersion: null,
        ...overrides.state,
    } as InstallerState

    const files = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(''),
        exists: vi.fn().mockResolvedValue(true),
        ...overrides.files,
    } as unknown as FileService

    const cli = {
        compile: vi.fn().mockResolvedValue({ success: true, output: '' }),
        upload: vi.fn().mockResolvedValue({ success: true, output: '' }),
        ...overrides.cli,
    } as unknown as ArduinoCliService

    Object.assign(ws, {
        state,
        cli,
        files,
        router: { load: vi.fn() },
        dialogService: {},
        preferences: { get: vi.fn(), set: vi.fn() },
        isCompiling: false,
        compileLog: '',
        compileError: null,
        compileSuccess: null,
        progressPercent: 0,
        showDeviceMenu: false,
        savedConfigs: [],
        activeFileIndex: 0,
    })

    return ws
}

const REPO = '/home/user/ex-installer/repos/CommandStation-EX'

const megaDevice = {
    name: 'Arduino Mega 2560',
    port: '/dev/ttyACM0',
    fqbn: 'arduino:avr:mega',
    protocol: 'serial' as const,
    serialNumber: undefined,
}

// ── upload() — guard conditions ───────────────────────────────────────────────

describe('Workspace.upload — guard conditions', () => {
    it('returns immediately when selectedDevice is null', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: null, repoPath: REPO } })
        await ws.upload()
        expect(ws.isCompiling).toBe(false)
        expect((ws as any).cli.upload).not.toHaveBeenCalled()
    })

    it('returns immediately when repoPath is null', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: null } })
        await ws.upload()
        expect((ws as any).cli.upload).not.toHaveBeenCalled()
    })

    it('sets compileSuccess=false when FQBN is empty', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: { ...megaDevice, fqbn: '' }, repoPath: REPO } })
        await ws.upload()
        expect(ws.compileSuccess).toBe(false)
        expect(ws.compileError).toMatch(/fqbn/i)
    })
})

// ── upload() — invocation ──────────────────────────────────────────────────────

describe('Workspace.upload — cli.upload invocation', () => {
    it('calls upload with repoPath, fqbn, and port', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: REPO } })
        await ws.upload()
        expect((ws as any).cli.upload).toHaveBeenCalledWith(REPO, 'arduino:avr:mega', '/dev/ttyACM0')
    })

    it('does not call cli.compile', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: REPO } })
        await ws.upload()
        expect((ws as any).cli.compile).not.toHaveBeenCalled()
    })
})

// ── upload() — success outcome ────────────────────────────────────────────────

describe('Workspace.upload — success outcome', () => {
    it('sets compileSuccess=true', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: REPO } })
        await ws.upload()
        expect(ws.compileSuccess).toBe(true)
    })

    it('progressPercent reaches 100', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: REPO } })
        await ws.upload()
        expect(ws.progressPercent).toBe(100)
    })

    it('log contains upload output', async () => {
        const ws = makeWorkspace({
            state: { selectedDevice: megaDevice, repoPath: REPO },
            cli: { upload: vi.fn().mockResolvedValue({ success: true, output: 'avrdude done.' }) },
        })
        await ws.upload()
        expect(ws.compileLog).toContain('avrdude done.')
    })

    it('log contains upload complete marker', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: REPO } })
        await ws.upload()
        expect(ws.compileLog).toContain('✓ Upload complete!')
    })

    it('isCompiling is false when done', async () => {
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: REPO } })
        await ws.upload()
        expect(ws.isCompiling).toBe(false)
    })
})

// ── upload() — failure outcomes ───────────────────────────────────────────────

describe('Workspace.upload — failure outcomes', () => {
    it('sets compileSuccess=false', async () => {
        const ws = makeWorkspace({
            state: { selectedDevice: megaDevice, repoPath: REPO },
            cli: { upload: vi.fn().mockResolvedValue({ success: false, output: '', error: 'port busy' }) },
        })
        await ws.upload()
        expect(ws.compileSuccess).toBe(false)
    })

    it('surfaces the upload error string', async () => {
        const ws = makeWorkspace({
            state: { selectedDevice: megaDevice, repoPath: REPO },
            cli: { upload: vi.fn().mockResolvedValue({ success: false, output: '', error: 'port busy' }) },
        })
        await ws.upload()
        expect(ws.compileError).toBe('port busy')
    })

    it("falls back to 'Upload failed' when no error string is provided", async () => {
        const ws = makeWorkspace({
            state: { selectedDevice: megaDevice, repoPath: REPO },
            cli: { upload: vi.fn().mockResolvedValue({ success: false, output: '' }) },
        })
        await ws.upload()
        expect(ws.compileError).toBe('Upload failed')
    })

    it('isCompiling is false after failure', async () => {
        const ws = makeWorkspace({
            state: { selectedDevice: megaDevice, repoPath: REPO },
            cli: { upload: vi.fn().mockResolvedValue({ success: false, output: '', error: 'err' }) },
        })
        await ws.upload()
        expect(ws.isCompiling).toBe(false)
    })

    it('isCompiling is false when cli.upload throws unexpectedly', async () => {
        const ws = makeWorkspace({
            state: { selectedDevice: megaDevice, repoPath: REPO },
            cli: { upload: vi.fn().mockRejectedValue(new Error('IPC channel closed')) },
        })
        await ws.upload()
        expect(ws.isCompiling).toBe(false)
        expect(ws.compileSuccess).toBe(false)
    })
})

// ── compileAndUpload() — orchestration ────────────────────────────────────────

describe('Workspace.compileAndUpload — orchestration', () => {
    it('calls compile then upload on success', async () => {
        const callOrder: string[] = []
        const cli = {
            compile: vi.fn().mockImplementation(async () => { callOrder.push('compile'); return { success: true, output: '' } }),
            upload: vi.fn().mockImplementation(async () => { callOrder.push('upload'); return { success: true, output: '' } }),
        } as unknown as ArduinoCliService
        const ws = makeWorkspace({ state: { selectedDevice: megaDevice, repoPath: REPO, configFiles: [] }, cli })
        await ws.compileAndUpload()
        expect(callOrder).toEqual(['compile', 'upload'])
    })

    it('does not call upload when compile fails', async () => {
        const uploadMock = vi.fn()
        const ws = makeWorkspace({
            state: { selectedDevice: megaDevice, repoPath: REPO, configFiles: [] },
            cli: {
                compile: vi.fn().mockResolvedValue({ success: false, output: '', error: 'compile error' }),
                upload: uploadMock,
            },
        })
        await ws.compileAndUpload()
        expect(uploadMock).not.toHaveBeenCalled()
    })

    it('does not call upload when device is null', async () => {
        const uploadMock = vi.fn()
        const ws = makeWorkspace({ state: { selectedDevice: null, repoPath: REPO }, cli: { upload: uploadMock } })
        await ws.compileAndUpload()
        expect(uploadMock).not.toHaveBeenCalled()
    })

    describe('full happy path', () => {
        let ws: Workspace

        beforeEach(async () => {
            const configFiles = [{ name: 'config.h', content: '#define MOTOR_SHIELD_TYPE STANDARD_MOTOR_SHIELD\n' }]
            ws = makeWorkspace({
                state: { selectedDevice: megaDevice, repoPath: REPO, configFiles },
                cli: {
                    compile: vi.fn().mockResolvedValue({ success: true, output: 'Sketch uses 12345 bytes' }),
                    upload: vi.fn().mockResolvedValue({ success: true, output: 'avrdude done.' }),
                },
            })
            await ws.compileAndUpload()
        })

        it('compileSuccess=true', () => { expect(ws.compileSuccess).toBe(true) })
        it('compileError is null', () => { expect(ws.compileError).toBeNull() })
        it('isCompiling is false', () => { expect(ws.isCompiling).toBe(false) })
        it('progressPercent is 100', () => { expect(ws.progressPercent).toBe(100) })
        it('log contains compile output', () => { expect(ws.compileLog).toContain('Sketch uses 12345 bytes') })
        it('log contains upload output', () => { expect(ws.compileLog).toContain('avrdude done.') })
        it('log contains upload complete marker', () => { expect(ws.compileLog).toContain('✓ Upload complete!') })
    })
})

// ── compile() — EX-CSB1 full configuration ────────────────────────────────────
//
// Flow: commandstation-config.goNext()
//         → generateCommandStationConfig() → state.configFiles
//       workspace.compile()
//         → saveFiles() → files.writeFile(repoPath/config.h, content)
//         → cli.compile(repoPath, fqbn)
//
// CSB1 device: VID:PID 303a:1001, FQBN 'esp32:esp32:esp32s3'
// Config generated for: EXCSB1 motor driver, SH1106 OLED (132×64),
//   WiFi AP mode, wifiHostname 'dccex', EEPROM disabled.

const CSB1_REPO = '/home/user/ex-installer/repos/CommandStation-EX'

const csb1Device = {
    name: 'EX-CSB1 (DCC-EX CommandStation Board 1)',
    port: 'MOCK_COM3',
    fqbn: 'esp32:esp32:esp32s3',
    protocol: 'serial' as const,
    serialNumber: 'DCCEX-CSB1-0001',
}

// Exact output of generateCommandStationConfig() for a CSB1 with all defaults:
//   motorDriver='EXCSB1', display='OLED_132x64', enableWifi=true, wifiMode='ap',
//   wifiHostname='dccex', wifiChannel=1, disableEeprom=true
const CSB1_CONFIG_H = `// config.h - Generated by EX-Installer

#define IP_PORT 2560
#define SCROLLMODE 1

#define MOTOR_SHIELD_TYPE EXCSB1
#define OLED_DRIVER 132,64
#define WIFI_HOSTNAME "dccex"
#define WIFI_SSID "Your network name"
#define WIFI_PASSWORD "Your network passwd"
#define ENABLE_WIFI true
#define WIFI_CHANNEL 1
#define DISABLE_EEPROM
`

describe('Workspace.compile() — EX-CSB1 full configuration', () => {
    let ws: Workspace
    let mockWriteFile: ReturnType<typeof vi.fn>
    let mockCompile: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        mockWriteFile = vi.fn().mockResolvedValue(undefined)
        mockCompile = vi.fn().mockResolvedValue({
            success: true,
            output: '{"compiler_out":"","compiler_err":"","success":true}',
        })

        ws = makeWorkspace({
            state: {
                selectedDevice: csb1Device,
                repoPath: CSB1_REPO,
                configFiles: [{ name: 'config.h', content: CSB1_CONFIG_H }],
            },
            cli: { compile: mockCompile as unknown as (sketchPath: string, fqbn: string) => Promise<any> },
            files: { writeFile: mockWriteFile as unknown as (filePath: string, content: string) => Promise<void> },
        })

        await ws.compile()
    })

    it('calls cli.compile with the CSB1 sketch path and FQBN', () => {
        expect(mockCompile).toHaveBeenCalledWith(CSB1_REPO, 'esp32:esp32:esp32s3')
    })

    it('writes config.h to the correct path before compiling', () => {
        expect(mockWriteFile).toHaveBeenCalledWith(
            `${CSB1_REPO}/config.h`,
            CSB1_CONFIG_H,
        )
        // writeFile must be called before compile
        const writeOrder = mockWriteFile.mock.invocationCallOrder[0]
        const compileOrder = mockCompile.mock.invocationCallOrder[0]
        expect(writeOrder).toBeLessThan(compileOrder)
    })

    it('written config.h contains MOTOR_SHIELD_TYPE EXCSB1', () => {
        const written: string = mockWriteFile.mock.calls[0][1]
        expect(written).toContain('#define MOTOR_SHIELD_TYPE EXCSB1')
    })

    it('written config.h contains OLED_DRIVER 132,64 (SH1106)', () => {
        const written: string = mockWriteFile.mock.calls[0][1]
        expect(written).toContain('#define OLED_DRIVER 132,64')
    })

    it('written config.h contains WIFI_HOSTNAME (required by WifiInterface.cpp)', () => {
        const written: string = mockWriteFile.mock.calls[0][1]
        expect(written).toContain('#define WIFI_HOSTNAME "dccex"')
    })

    it('written config.h contains all required always-present defines', () => {
        const written: string = mockWriteFile.mock.calls[0][1]
        expect(written).toContain('#define IP_PORT 2560')
        expect(written).toContain('#define SCROLLMODE 1')
        expect(written).toContain('#define ENABLE_WIFI true')
        expect(written).toContain('#define WIFI_CHANNEL 1')
        expect(written).toContain('#define DISABLE_EEPROM')
    })

    it('compileSuccess is true', () => {
        expect(ws.compileSuccess).toBe(true)
    })

    it('compileError is null', () => {
        expect(ws.compileError).toBeNull()
    })

    it('isCompiling is false after completion', () => {
        expect(ws.isCompiling).toBe(false)
    })

    it('progressPercent reaches 70 after compile', () => {
        expect(ws.progressPercent).toBe(70)
    })
})
