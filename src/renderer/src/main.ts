import Aurelia, { Registration } from 'aurelia'
import { RouterConfiguration } from '@aurelia/router'
import { DialogConfigurationStandard } from '@aurelia/dialog'
import { App } from './app'
import '../../types/ipc' // Window.python / Window.usb type augmentation
import { registerLicense } from '@syncfusion/ej2-base'
import syncfusionLicense from '../../../syncfusion-license.txt?raw'
import './styles.css'

// Services
import { PlatformIoService } from './services/platformio.service'
import { GitService } from './services/git.service'
import { FileService } from './services/file.service'
import { PreferencesService } from './services/preferences.service'
import { PythonService } from './services/python.service'
import { UsbService } from './services/usb.service'
import { ToastService } from './services/toast.service'
import { ThrottleService } from './services/throttle.service'
import { ThemeService } from './services/theme.service'
import { BlocklySoundsService } from './services/blockly-sounds.service'
import { EditorDefaultViewService } from './services/editor-default-view.service'

// State
import { InstallerState } from './models/installer-state'
import { ConfigEditorState } from './models/config-editor-state'

// Config editor components
import { MonacoEditorCustomElement } from './components/monaco-editor'
import { VpinPickerCustomElement } from './components/vpin-picker'
import { AliasPickerCustomElement } from './components/alias-picker'
import { RosterEditorCustomElement } from './components/visual-editors/roster-editor'
import { TurnoutEditorCustomElement } from './components/visual-editors/turnout-editor'
import { ConfigHEditorCustomElement } from './components/visual-editors/config-h-editor'
import { AutomationEditorCustomElement } from './components/visual-editors/automation-editor'
import { StartupEditorCustomElement } from './components/visual-editors/startup-editor'
import { AccessoriesEditorCustomElement } from './components/visual-editors/accessories-editor'
import { FileEditorPanelCustomElement } from './components/visual-editors/file-editor-panel'
import { CompileProgressCustomElement } from './components/compile-progress'
import { CompileOutputTerminalCustomElement } from './components/compile-output-terminal'
import { SensorsEditorCustomElement } from './components/visual-editors/sensors-editor'
import { SignalsEditorCustomElement } from './components/visual-editors/signals-editor'
import { RoutesEditorCustomElement } from './components/visual-editors/routes-editor'
import { SequencesEditorCustomElement } from './components/visual-editors/sequences-editor'
import { AliasesEditorCustomElement } from './components/visual-editors/aliases-editor'
import { ExrailBlockCanvasCustomElement } from './components/visual-editors/exrail-block-canvas'

// Per-product visual config forms
import { SerialMonitorCustomElement } from './components/serial-monitor'
import { CommandstationConfigFormCustomElement } from './components/config-forms/commandstation-config-form'
import { TrackManagerFormCustomElement } from './components/config-forms/track-manager-form'
import { TurnoutDefaultsSummaryCustomElement } from './components/config-forms/turnout-defaults-summary'
import { HalDevicesFormCustomElement } from './components/config-forms/hal-devices-form'
import { IOExpanderConfigFormCustomElement } from './components/config-forms/ioexpander-config-form'
import { ThrottlePanelCustomElement } from './components/throttle/throttle-panel'
import { ThrottleCardCustomElement } from './components/throttle/throttle-card'
import { TurnoutsViewCustomElement } from './components/throttle/turnouts-view'
import { RoutesViewCustomElement } from './components/throttle/routes-view'

registerLicense(syncfusionLicense)

// Suppress mouse-click focus rings on non-SF buttons.
// preventDefault on mousedown prevents focus being applied on click while
// leaving keyboard Tab navigation unaffected. SF buttons (.e-btn) are
// excluded so they retain their own focus styling.
document.addEventListener(
    'mousedown',
    (e) => {
        const btn = (e.target as Element).closest?.('button')
        if (btn && !btn.classList.contains('e-btn')) {
            e.preventDefault()
        }
    },
    { capture: true },
)

new Aurelia()
    .register(
        RouterConfiguration.customize({ useUrlFragmentHash: true }),
        DialogConfigurationStandard.customize((settings) => {
            settings.options.modal = true
        }),
        // Register services as singletons
        Registration.singleton(PlatformIoService, PlatformIoService),
        Registration.singleton(GitService, GitService),
        Registration.singleton(FileService, FileService),
        Registration.singleton(PreferencesService, PreferencesService),
        Registration.singleton(PythonService, PythonService),
        Registration.singleton(UsbService, UsbService),
        Registration.singleton(ToastService, ToastService),
        Registration.singleton(ThrottleService, ThrottleService),
        Registration.singleton(ThemeService, ThemeService),
        Registration.singleton(BlocklySoundsService, BlocklySoundsService),
        Registration.singleton(EditorDefaultViewService, EditorDefaultViewService),
        Registration.singleton(InstallerState, InstallerState),
        Registration.singleton(ConfigEditorState, ConfigEditorState),
        // Config editor custom elements
        MonacoEditorCustomElement,
        VpinPickerCustomElement,
        AliasPickerCustomElement,
        RosterEditorCustomElement,
        TurnoutEditorCustomElement,
        ConfigHEditorCustomElement,
        AutomationEditorCustomElement,
        StartupEditorCustomElement,
        AccessoriesEditorCustomElement,
        FileEditorPanelCustomElement,
        SensorsEditorCustomElement,
        SignalsEditorCustomElement,
        RoutesEditorCustomElement,
        SequencesEditorCustomElement,
        AliasesEditorCustomElement,
        ExrailBlockCanvasCustomElement,
        CompileProgressCustomElement,
        CompileOutputTerminalCustomElement,
        SerialMonitorCustomElement,
        CommandstationConfigFormCustomElement,
        TrackManagerFormCustomElement,
        TurnoutDefaultsSummaryCustomElement,
        HalDevicesFormCustomElement,
        IOExpanderConfigFormCustomElement,
        ThrottlePanelCustomElement,
        ThrottleCardCustomElement,
        TurnoutsViewCustomElement,
        RoutesViewCustomElement,
    )
    .app(App)
    .start()
