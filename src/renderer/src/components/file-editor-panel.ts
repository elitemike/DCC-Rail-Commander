import { bindable, resolve } from 'aurelia'
import { ConfigEditorState } from '../models/config-editor-state'
import { InstallerState } from '../models/installer-state'
import { friendlyName } from '../utils/friendly-names'

/**
 * file-editor-panel — replaces the raw textarea in workspace.html.
 * Shows a specialized editor based on the active config file name, falling
 * back to a plain Monaco editor for unknown file types.
 */
export class FileEditorPanelCustomElement {
    readonly state = resolve(ConfigEditorState)
    readonly installer = resolve(InstallerState)

    /** Currently selected file index (passed in from workspace) */
    @bindable activeFileIndex = 0

    get activeFile(): { name: string; content: string } | null {
        return this.installer.configFiles[this.activeFileIndex] ?? null
    }

    readonly friendlyName = friendlyName

    /**
     * Single discriminant — exactly one branch in the template reads from this,
     * so it is structurally impossible for two panes to be visible at the same time.
     */
    get currentView(): 'configH' | 'roster' | 'turnouts' | 'automation' | 'sensors' | 'signals' | 'routes' | 'sequences' | 'aliases' | 'generic' | 'none' {
        const name = this.activeFile?.name
        // Debug: surface current view and active filename to console to aid troubleshooting
        try { console.debug('FileEditorPanel currentView check', { name }) } catch { /* ignore */ }
        if (!name) return 'none'
        if (name === 'config.h' || name === 'myConfig.h') return 'configH'
        if (name === 'myRoster.h') return 'roster'
        if (name === 'myTurnouts.h') return 'turnouts'
        if (name === 'myAutomation.h') return 'automation'
        if (name === 'mySensors.h') return 'sensors'
        if (name === 'mySignals.h') return 'signals'
        if (name === 'myRoutes.h') return 'routes'
        if (name === 'mySequences.h') return 'sequences'
        if (name === 'myAliases.h') return 'aliases'
        return 'generic'
    }

    // Keep old getters so nothing else breaks
    get isConfigH(): boolean { return this.currentView === 'configH' }
    get isRoster(): boolean { return this.currentView === 'roster' }
    get isTurnouts(): boolean { return this.currentView === 'turnouts' }
    get isAutomation(): boolean { return this.currentView === 'automation' }
    get isGeneric(): boolean { return this.currentView === 'generic' }

    // Raw content for generic files — getter/setter so two-way binding works
    get genericContent(): string {
        return this.activeFile?.content ?? ''
    }

    set genericContent(val: string) {
        if (this.activeFile) {
            this.activeFile.content = val
        }
    }

    get automationContent(): string {
        return this.activeFile?.content ?? this.state.automationPreview
    }

    set automationContent(val: string) {
        if (this.activeFile) {
            this.activeFile.content = val
        }
    }
}
