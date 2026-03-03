import { resolve } from 'aurelia'
import { Router } from '@aurelia/router'
import { IDialogService } from '@aurelia/dialog'
import { InstallerState } from '../models/installer-state'
import { PreferencesService } from '../services/preferences.service'
import { DeviceWizard } from '../components/device-wizard'
import type { SavedConfiguration } from '../models/saved-configuration'

export class Home {
    private readonly router = resolve(Router)
    private readonly dialogService = resolve(IDialogService)
    readonly state = resolve(InstallerState)
    private readonly preferences = resolve(PreferencesService)

    async binding(): Promise<void> {
        await this.loadSavedConfigs()
    }

    private async loadSavedConfigs(): Promise<void> {
        try {
            const saved = await this.preferences.get('savedConfigurations') as SavedConfiguration[] | undefined
            this.state.savedConfigurations = Array.isArray(saved) ? saved : []
        } catch {
            this.state.savedConfigurations = []
        }
    }

    async openNewDevice(): Promise<void> {
        this.state.reset()
        const result = await this.dialogService
            .open({ component: () => DeviceWizard })
            .whenClosed((r) => r)
        if (typeof result === 'object' && result !== null && 'status' in result && (result as any).status === 'ok') {
            await this.router.load('workspace')
        }
    }

    async loadFromFolder(): Promise<void> {
        // TODO: use window.files.selectDirectory() to pick a folder
    }

    async loadConfig(config: SavedConfiguration): Promise<void> {
        this.state.selectedDevice = {
            name: config.deviceName,
            port: config.devicePort,
            fqbn: config.deviceFqbn,
            protocol: 'serial',
        }
        this.state.selectedProduct = config.product
        this.state.selectedVersion = config.version
        this.state.repoPath = config.repoPath
        this.state.configFiles = config.configFiles.map((f) => ({ ...f }))
        this.state.activeConfigId = config.id
        await this.router.load('workspace')
    }

    async deleteConfig(config: SavedConfiguration, event: Event): Promise<void> {
        event.stopPropagation()
        this.state.savedConfigurations = this.state.savedConfigurations.filter((c) => c.id !== config.id)
        await this.preferences.set('savedConfigurations', this.state.savedConfigurations)
    }

    formatDate(iso: string): string {
        try {
            return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        } catch {
            return iso
        }
    }
}
