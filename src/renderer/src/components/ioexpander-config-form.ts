import { resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import {
    type IOExpanderConfigOptions,
    defaultIOExpanderConfig,
    parseIOExpanderConfig,
    generateIOExpanderConfig,
} from '../config/ioexpander'

export class IOExpanderConfigFormCustomElement {
    private readonly editorState = resolve(ConfigEditorState)

    opts: IOExpanderConfigOptions = defaultIOExpanderConfig()

    /** Display the I2C address as a hex string in the input */
    get i2cHex(): string {
        return `0x${this.opts.i2cAddress.toString(16).toUpperCase().padStart(2, '0')}`
    }

    set i2cHex(val: string) {
        const n = parseInt(val, 16)
        if (!isNaN(n) && n >= 0x08 && n <= 0x77) {
            this.opts.i2cAddress = n
        }
    }

    readonly testModes = [
        { value: null, label: 'None (no testing)' },
        { value: 'ANALOGUE_TEST', label: 'Analogue input testing' },
        { value: 'INPUT_TEST', label: 'Digital input testing (no pullups)' },
        { value: 'OUTPUT_TEST', label: 'Digital output testing' },
        { value: 'PULLUP_TEST', label: 'Digital input testing (with pullups)' },
    ]

    attached(): void {
        this.opts = parseIOExpanderConfig(this.editorState.configHContent)
    }

    onFieldChange(): void {
        if (this.opts.diagConfigDelay < 1) this.opts.diagConfigDelay = 1
        this.editorState.configHContent = generateIOExpanderConfig(this.opts)
        this.editorState.syncConfigH()
    }

    onI2cAddressChange(val: string): void {
        const n = parseInt(val, 16)
        if (!isNaN(n) && n >= 0x08 && n <= 0x77) {
            this.opts.i2cAddress = n
            this.onFieldChange()
        }
    }
}
