import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { InstallerState } from '../models/installer-state'

export class Welcome {
    private readonly router = resolve(Router)
    readonly state = resolve(InstallerState)

    goNext(): void {
        this.router.load('manage-cli')
    }
}
