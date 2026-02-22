import Aurelia from 'aurelia'
import { App } from './app'
import '../../types/ipc' // Window.python / Window.usb type augmentation
import { registerLicense } from '@syncfusion/ej2/base';
import syncfusionLicense from '../../../syncfusion-license.txt?raw';
import './styles.css'

registerLicense(syncfusionLicense);
new Aurelia()
    .app(App)
    .start()
