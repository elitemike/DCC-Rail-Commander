import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'

/**
 * automation-editor — editor for myAutomation.h.
 *
 * Always-raw: myAutomation.h now only holds the auto-generated #include block,
 * the HAL Devices block (edited via the Accessories row instead — see
 * accessories-editor), and free-form custom EXRAIL code. TrackManager and
 * Turnout Defaults moved to myStartup.h (see startup-editor), which left
 * nothing structured here to justify a Visual tab.
 */
export class AutomationEditorCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)

    /** Ref to the raw Monaco editor — used to flush pending debounced edits before Save. */
    rawEditor: { flush(): string } | null = null

    private get automationFile(): { name: string; content: string } | null {
        return this.installerState.configFiles.find(f => f.name === 'myAutomation.h') ?? null
    }

    get content(): string {
        return this.automationFile?.content ?? this.state.automationPreview
    }

    set content(val: string) {
        if (this.automationFile) {
            this.automationFile.content = val
            this.state.hasChanges = true
        }
    }

    flush(): void {
        this.rawEditor?.flush()
    }
}
