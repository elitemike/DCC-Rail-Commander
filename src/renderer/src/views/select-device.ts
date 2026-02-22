import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { ArduinoCliService } from '../services/arduino-cli.service'
import { UsbService } from '../services/usb.service'
import type { ArduinoCliBoardInfo } from '../../../types/ipc'

/**
 * Known USB Vendor/Product IDs for common Arduino-compatible boards.
 * Used as a fallback when the Arduino CLI isn't installed or doesn't
 * recognise the board.
 */
const KNOWN_BOARDS: Record<string, string> = {
    '2341:0042': 'Arduino Mega 2560',
    '2341:0010': 'Arduino Mega 2560',
    '2341:0242': 'Arduino Mega 2560 (DFU)',
    '2341:0043': 'Arduino Uno',
    '2341:0001': 'Arduino Uno',
    '2341:0243': 'Arduino Uno (DFU)',
    '2341:0058': 'Arduino Nano',
    '2341:0037': 'Arduino Nano Every',
    '1a86:7523': 'CH340 Serial (Nano/Mega clone)',
    '10c4:ea60': 'CP2102 Serial (ESP32)',
    '0403:6001': 'FTDI Serial Adapter',
    '0403:6015': 'FTDI Serial Adapter',
    '0483:374b': 'STM32 Nucleo (ST-Link)',
    '0483:3748': 'STM32 ST-Link V2',
    '303a:1001': 'Espressif ESP32-S3',
}

export class SelectDevice {
    private readonly router = resolve(Router)
    private readonly state = resolve(InstallerState)
    private readonly cli = resolve(ArduinoCliService)
    private readonly usb = resolve(UsbService)

    boards: ArduinoCliBoardInfo[] = []
    selectedBoard: ArduinoCliBoardInfo | null = null
    scanning = false
    hasScanned = false
    cliAvailable = false
    error: string | null = null

    async binding(): Promise<void> {
        await this.usb.initialize()
        await this.scanDevices()
    }

    async scanDevices(): Promise<void> {
        this.scanning = true
        this.error = null
        try {
            // 1. Always detect serial ports via the serialport package
            await this.usb.refresh()
            const serialPorts = this.usb.serialPorts

            // 2. If Arduino CLI is installed, get enriched board info
            let cliBoardMap = new Map<string, ArduinoCliBoardInfo>()
            try {
                this.cliAvailable = await this.cli.isInstalled()
                if (this.cliAvailable) {
                    const cliBoards = await this.cli.listBoards()
                    for (const b of cliBoards) {
                        cliBoardMap.set(b.port, b)
                    }
                }
            } catch {
                // CLI not available – that's fine, we still have serial ports
            }

            // 3. Build unified board list: serial ports enriched with CLI data
            this.boards = serialPorts.map((sp) => {
                const cliMatch = cliBoardMap.get(sp.path)
                if (cliMatch) {
                    // Arduino CLI recognised this board – use its data
                    return {
                        ...cliMatch,
                        serialNumber: cliMatch.serialNumber ?? sp.serialNumber,
                    }
                }

                // Fallback: identify by VID:PID
                const vidPid =
                    sp.vendorId && sp.productId
                        ? `${sp.vendorId.toLowerCase()}:${sp.productId.toLowerCase()}`
                        : ''
                const boardName =
                    KNOWN_BOARDS[vidPid] ??
                    sp.manufacturer ??
                    'Unknown device'

                return {
                    name: boardName,
                    fqbn: '',
                    port: sp.path,
                    protocol: 'serial',
                    serialNumber: sp.serialNumber,
                } as ArduinoCliBoardInfo
            })

            // Remove the CLI-only entries that have no matching serial port
            // (they might be network-protocol boards we don't care about)

            this.state.detectedBoards = this.boards

            // Re-select previously selected device if still present
            if (this.state.selectedDevice) {
                const match = this.boards.find(
                    (b) => b.port === this.state.selectedDevice!.port,
                )
                if (match) this.selectedBoard = match
            }
        } catch (err) {
            this.error = (err as Error).message
        } finally {
            this.scanning = false
            this.hasScanned = true
        }
    }

    selectBoard(board: ArduinoCliBoardInfo): void {
        this.selectedBoard = board
    }

    goBack(): void {
        this.router.load('manage-cli')
    }

    goNext(): void {
        if (this.selectedBoard) {
            this.state.selectedDevice = this.selectedBoard
            this.router.load('select-product')
        }
    }
}
