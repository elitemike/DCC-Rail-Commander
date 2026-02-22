import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'
import { productDetails } from '../models/product-details'

export class SelectProduct {
    private readonly router = resolve(Router)
    readonly state = resolve(InstallerState)

    isDeviceSupported(productKey: string): boolean {
        const product = productDetails[productKey]
        const device = this.state.selectedDevice
        if (!product || !device) return false
        if (!device.fqbn) return true // unknown board — allow all
        return product.supportedDevices.some((d) =>
            device.fqbn.startsWith(d) || d.startsWith(device.fqbn)
        )
    }

    selectProduct(productKey: string): void {
        if (this.isDeviceSupported(productKey)) {
            this.state.selectedProduct = productKey
        }
    }

    goBack(): void {
        this.router.load('select-device')
    }

    goNext(): void {
        if (this.state.selectedProduct) {
            this.router.load('select-version')
        }
    }
}
