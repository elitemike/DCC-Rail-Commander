import { resolve } from 'aurelia'
import { UsbService } from '../services/usb.service'

export class DeviceList {
    private readonly usbService = resolve(UsbService)

    get serialPorts() {
        return this.usbService.serialPorts
    }

    get log() {
        return this.usbService.log
    }

    async openPort(path: string): Promise<void> {
        await this.usbService.openPort(path)
    }

    async closePort(path: string): Promise<void> {
        await this.usbService.closePort(path)
    }

    async refresh(): Promise<void> {
        await this.usbService.refresh()
    }
}
