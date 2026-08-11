import { describe, it, expect } from 'vitest'

import { mergeDetectedBoards, KNOWN_BOARDS } from '../../src/renderer/src/utils/device-scan'
import type { SerialDeviceInfo, DetectedBoardInfo } from '../../src/types/ipc'

const megaPort: SerialDeviceInfo = {
    path: '/dev/ttyACM1',
    manufacturer: 'Arduino (www.arduino.cc)',
    serialNumber: 'DEV-MEGA-0001',
    vendorId: '2341',
    productId: '0042',
}

const unrecognizedPort: SerialDeviceInfo = {
    path: '/dev/ttyUSB0',
    manufacturer: 'Some Clone Board',
    serialNumber: 'CLONE-0001',
    vendorId: 'dead',
    productId: 'beef',
}

describe('mergeDetectedBoards', () => {
    it('returns an entry for every serial port even when Arduino CLI finds nothing', () => {
        const result = mergeDetectedBoards([megaPort], [])
        expect(result).toHaveLength(1)
        expect(result[0].port).toBe('/dev/ttyACM1')
    })

    it('uses the CLI-identified board when the CLI recognises the port', () => {
        const cliBoard: DetectedBoardInfo = {
            name: 'Arduino Mega 2560',
            fqbn: 'arduino:avr:mega',
            port: '/dev/ttyACM1',
            protocol: 'serial',
        }
        const result = mergeDetectedBoards([megaPort], [cliBoard])
        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({ name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' })
    })

    it('falls back to the known VID/PID table when the CLI does not recognise the port', () => {
        const result = mergeDetectedBoards([megaPort], [])
        expect(result[0]).toMatchObject({ name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' })
    })

    it('labels a port as an unknown device when neither the CLI nor the known table recognise it', () => {
        const result = mergeDetectedBoards([unrecognizedPort], [])
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe('Some Clone Board')
        expect(result[0].fqbn).toBe('')
    })

    it('falls back to "Unknown device" when there is no manufacturer string either', () => {
        const bare: SerialDeviceInfo = { path: '/dev/ttyUSB1' }
        const result = mergeDetectedBoards([bare], [])
        expect(result[0].name).toBe('Unknown device')
    })

    it('never drops a physically connected port just because the CLI found nothing at all', () => {
        // Regression: the picker previously used ONLY the CLI's board list, so any
        // board the CLI hadn't indexed yet (still installing, generic clone chip,
        // momentary lag right after a replug) would vanish from the dialog entirely.
        const result = mergeDetectedBoards([megaPort, unrecognizedPort], [])
        expect(result.map(b => b.port)).toEqual(['/dev/ttyACM1', '/dev/ttyUSB0'])
    })

    it('preserves the CLI serial number when the raw port info lacks one', () => {
        const cliBoard: DetectedBoardInfo = {
            name: 'Arduino Mega 2560',
            fqbn: 'arduino:avr:mega',
            port: '/dev/ttyACM1',
            protocol: 'serial',
            serialNumber: 'FROM-CLI',
        }
        const portWithoutSerial: SerialDeviceInfo = { ...megaPort, serialNumber: undefined }
        const result = mergeDetectedBoards([portWithoutSerial], [cliBoard])
        expect(result[0].serialNumber).toBe('FROM-CLI')
    })

    it('has known entries for the DCC-EX EX-CSB1 board VID/PID', () => {
        expect(KNOWN_BOARDS['303a:1001']).toMatchObject({ fqbn: 'esp32:esp32:esp32' })
    })
})
