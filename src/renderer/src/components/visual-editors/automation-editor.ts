import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'

type ViewTab = 'visual' | 'raw'

/**
 * automation-editor — editor for myAutomation.h.
 *
 * Provides a Visual/Raw toggle:
 *   - Visual: TrackManager form (the only structured part of myAutomation.h —
 *     includes/turnout-defaults/custom EXRAIL content remain raw-only)
 *   - Raw:    Monaco editor with the managed sections (unchanged behaviour)
 */
export class AutomationEditorCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)

    activeTab: ViewTab = 'visual'

    /** Ref to the raw Monaco editor — used to flush pending debounced edits before Save. */
    rawEditor: { flush(): string } | null = null

    get productId(): string | null {
        return this.installerState.selectedProduct
    }

    get hasVisualEditor(): boolean {
        return this.productId === 'ex_commandstation'
    }

    setTab(tab: ViewTab): void {
        this.activeTab = tab
    }

    private get automationFile(): { name: string; content: string } | null {
        return this.installerState.configFiles.find(f => f.name === 'myAutomation.h') ?? null
    }

    get content(): string {
        return this.automationFile?.content ?? this.state.automationPreview
    }

    set content(val: string) {
        if (this.automationFile) {
            this.automationFile.content = val
        }
    }

    flush(): void {
        this.rawEditor?.flush()
    }
}
