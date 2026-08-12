import type { SerialDeviceInfo } from '../types/ipc'

export const MOCK_SERIAL_PORTS: SerialDeviceInfo[] = [
    {
        // EX-CSB1 — ESP32-S3 with native USB (Espressif VID)
        path: '/dev/ttyACM0',
        manufacturer: 'DCC-EX',
        serialNumber: 'DCCEX-CSB1-0001',
        vendorId: '303a',
        productId: '1001',
    },
    {
        // Arduino Mega 2560
        path: '/dev/ttyACM1',
        manufacturer: 'Arduino (www.arduino.cc)',
        serialNumber: 'DEV-MEGA-0001',
        vendorId: '2341',
        productId: '0042',
    },
    {
        // Arduino Uno
        path: '/dev/ttyACM2',
        manufacturer: 'Arduino (www.arduino.cc)',
        serialNumber: 'DEV-UNO-0001',
        vendorId: '2341',
        productId: '0043',
    },
    {
        // Arduino Nano
        path: '/dev/ttyUSB0',
        manufacturer: 'Arduino (www.arduino.cc)',
        serialNumber: 'DEV-NANO-0001',
        vendorId: '2341',
        productId: '0058',
    },
    {
        // Arduino Nano Every
        path: '/dev/ttyACM3',
        manufacturer: 'Arduino (www.arduino.cc)',
        serialNumber: 'DEV-NANO-EVERY-0001',
        vendorId: '2341',
        productId: '0037',
    },
    {
        // ESP32 via CP2102 USB-UART bridge
        path: '/dev/ttyUSB1',
        manufacturer: 'Silicon Labs',
        serialNumber: 'DEV-ESP32-0001',
        vendorId: '10c4',
        productId: 'ea60',
    },
    {
        // Generic CH340 clone (Nano/Mega)
        path: '/dev/ttyUSB2',
        manufacturer: 'QinHeng Electronics',
        serialNumber: undefined,
        vendorId: '1a86',
        productId: '7523',
    },
    {
        // FTDI USB-Serial adapter
        path: '/dev/ttyUSB3',
        manufacturer: 'FTDI',
        serialNumber: 'DEV-FTDI-0001',
        vendorId: '0403',
        productId: '6001',
    },
]
