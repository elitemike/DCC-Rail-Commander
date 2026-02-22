import { bindable, resolve } from 'aurelia'
import { UsbService } from '../services/usb.service'
import { InstallerState } from '../models/installer-state'

export class SerialMonitor {
    @bindable visible = false
    output: string[] = []
    command = ''
    private outputEl!: HTMLElement
    private unsubData?: () => void

    private readonly usb = resolve(UsbService)
    private readonly state = resolve(InstallerState)

    attached(): void {
        if (window.usb) {
            this.unsubData = window.usb.onData(({ path, data }) => {
                const lines = data.split('\n').filter((l) => l.length > 0)
                this.output.push(...lines.map((l) => `[${path}] ${l}`))
                this.scrollToBottom()
            })
        }
    }

    detaching(): void {
        this.unsubData?.()
    }

    async send(): Promise<void> {
        if (!this.command.trim()) return
        const device = this.state.selectedDevice
        if (!device) return
        try {
            await this.usb.write(device.port, this.command + '\n')
            this.output.push(`> ${this.command}`)
            this.command = ''
            this.scrollToBottom()
        } catch (err) {
            this.output.push(`[ERROR] ${(err as Error).message}`)
        }
    }

    onKeydown(event: KeyboardEvent): boolean {
        if (event.key === 'Enter') {
            this.send()
            return false
        }
        return true
    }

    close(): void {
        this.visible = false
    }

    private scrollToBottom(): void {
        requestAnimationFrame(() => {
            if (this.outputEl) {
                this.outputEl.scrollTop = this.outputEl.scrollHeight
            }
        })
    }
}
