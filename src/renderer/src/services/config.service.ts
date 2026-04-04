import { DI } from 'aurelia'

export const IConfigService = DI.createInterface<ConfigService>('IConfigService')

/** Wraps window.config (contextBridge API) for the renderer. */
export class ConfigService {
    private _isMock = false
    private _skipStartup = false
    readonly ready: Promise<void>

    constructor() {
        this.ready = Promise.all([
            window.config.getMock().then((value) => { this._isMock = value }),
            window.config.getSkipStartup().then((value) => { this._skipStartup = value }),
        ]).then(() => undefined)
    }

    get isMock(): boolean {
        return this._isMock
    }

    get skipStartup(): boolean {
        return this._skipStartup
    }
}
