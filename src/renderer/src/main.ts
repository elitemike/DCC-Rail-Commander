import Aurelia, { Registration } from 'aurelia'
import { RouterConfiguration } from '@aurelia/router'
import { DialogConfigurationStandard } from '@aurelia/dialog'
import { App } from './app'
import '../../types/ipc' // Window.python / Window.usb type augmentation
import { registerLicense } from '@syncfusion/ej2/base'
import syncfusionLicense from '../../../syncfusion-license.txt?raw'
import './styles.css'

// Services
import { ArduinoCliService } from './services/arduino-cli.service'
import { GitService } from './services/git.service'
import { FileService } from './services/file.service'
import { PreferencesService } from './services/preferences.service'
import { PythonService } from './services/python.service'
import { UsbService } from './services/usb.service'

// State
import { InstallerState } from './models/installer-state'

registerLicense(syncfusionLicense)

new Aurelia()
    .register(
        RouterConfiguration.customize({ useUrlFragmentHash: true }),
        DialogConfigurationStandard.customize((settings) => {
            settings.options.modal = true
        }),
        // Register services as singletons
        Registration.singleton(ArduinoCliService, ArduinoCliService),
        Registration.singleton(GitService, GitService),
        Registration.singleton(FileService, FileService),
        Registration.singleton(PreferencesService, PreferencesService),
        Registration.singleton(PythonService, PythonService),
        Registration.singleton(UsbService, UsbService),
        Registration.singleton(InstallerState, InstallerState),
    )
    .app(App)
    .start()
