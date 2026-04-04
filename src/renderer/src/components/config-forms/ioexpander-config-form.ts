import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import {
    type IOExpanderConfigOptions,
    defaultIOExpanderConfig,
    parseIOExpanderConfig,
    generateIOExpanderConfig,
} from '../../config/ioexpander'
import { TextBox, NumericTextBox } from '@syncfusion/ej2-inputs'
import { CheckBox } from '@syncfusion/ej2-buttons'
import { DropDownList } from '@syncfusion/ej2-dropdowns'

export class IOExpanderConfigFormCustomElement {
    private readonly editorState = resolve(ConfigEditorState)

    opts: IOExpanderConfigOptions = defaultIOExpanderConfig()

    readonly testModes = [
        { value: null, label: 'None (no testing)' },
        { value: 'ANALOGUE_TEST', label: 'Analogue input testing' },
        { value: 'INPUT_TEST', label: 'Digital input testing (no pullups)' },
        { value: 'OUTPUT_TEST', label: 'Digital output testing' },
        { value: 'PULLUP_TEST', label: 'Digital input testing (with pullups)' },
    ]

    // Element refs set by Aurelia template ref binding
    i2cAddressEl!: HTMLInputElement
    disablePullupsEl!: HTMLInputElement
    enableDiagEl!: HTMLInputElement
    diagDelayEl!: HTMLInputElement
    testModeEl!: HTMLInputElement

    // SF instances
    private sfI2cAddress!: TextBox
    private sfDisablePullups!: CheckBox
    private sfEnableDiag!: CheckBox
    private sfDiagDelay!: NumericTextBox
    private sfTestMode!: DropDownList

    get i2cHex(): string {
        return `0x${this.opts.i2cAddress.toString(16).toUpperCase().padStart(2, '0')}`
    }

    binding(): void {
        Object.assign(this.opts, parseIOExpanderConfig(this.editorState.configHContent))
    }

    attached(): void {
        this.sfI2cAddress = new TextBox({
            value: this.i2cHex,
            placeholder: '0x65',
            change: (args) => this.onI2cAddressChange(args.value ?? ''),
        })
        this.sfI2cAddress.appendTo(this.i2cAddressEl)

        this.sfDisablePullups = new CheckBox({
            label: 'Disable internal I2C pullups',
            checked: this.opts.disablePullups,
            change: (args) => {
                this.opts.disablePullups = args.checked
                this.onFieldChange()
            },
        })
        this.sfDisablePullups.appendTo(this.disablePullupsEl)

        this.sfEnableDiag = new CheckBox({
            label: 'Enable diagnostic output',
            checked: this.opts.enableDiag,
            change: (args) => {
                this.opts.enableDiag = args.checked
                this.onFieldChange()
            },
        })
        this.sfEnableDiag.appendTo(this.enableDiagEl)

        this.sfDiagDelay = new NumericTextBox({
            min: 1,
            value: this.opts.diagConfigDelay,
            format: 'n0',
            change: (args) => {
                if (args.value != null) this.opts.diagConfigDelay = args.value
                this.onFieldChange()
            },
        })
        this.sfDiagDelay.appendTo(this.diagDelayEl)

        const testModeData = this.testModes.map((tm) => ({ text: tm.label, value: tm.value ?? '' }))
        this.sfTestMode = new DropDownList({
            dataSource: testModeData,
            fields: { text: 'text', value: 'value' },
            value: this.opts.testMode ?? '',
            change: (args) => {
                const val = args.value as string
                this.opts.testMode = val === '' ? null : val
                this.onFieldChange()
            },
        })
        this.sfTestMode.appendTo(this.testModeEl)
    }

    detaching(): void {
        this.sfI2cAddress?.destroy()
        this.sfDisablePullups?.destroy()
        this.sfEnableDiag?.destroy()
        this.sfDiagDelay?.destroy()
        this.sfTestMode?.destroy()
    }

    onI2cAddressChange(val: string): void {
        const n = parseInt(val, 16)
        if (!isNaN(n) && n >= 0x08 && n <= 0x77) {
            this.opts.i2cAddress = n
            this.onFieldChange()
        }
    }

    onFieldChange(): void {
        if (this.opts.diagConfigDelay < 1) this.opts.diagConfigDelay = 1
        this.editorState.configHContent = generateIOExpanderConfig(this.opts)
        this.editorState.syncConfigH()
    }
}
