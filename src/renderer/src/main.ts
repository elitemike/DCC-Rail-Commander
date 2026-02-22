import Aurelia from 'aurelia'
import { MyApp } from './my-app'
import '../../types/ipc' // Window.python / Window.usb type augmentation

new Aurelia()
    .app(MyApp)
    .start()
