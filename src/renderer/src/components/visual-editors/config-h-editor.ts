import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { InstallerState } from '../../models/installer-state'

type ViewTab = 'visual' | 'raw'

/**
 * config-h-editor — editor for config.h / myConfig.h.
 *
 * Provides a Visual/Raw toggle:
 *   - Visual: dispatches to a product-specific form component
 *   - Raw:    Monaco raw C++ editor (unchanged behaviour)
 */
export class ConfigHEditorCustomElement {
    private readonly state = resolve(ConfigEditorState)
    private readonly installerState = resolve(InstallerState)

    activeTab: ViewTab = 'visual'

    get productId(): string | null {
        return this.installerState.selectedProduct
    }

    get hasVisualEditor(): boolean {
        return this.productId === 'ex_commandstation' || this.productId === 'ex_ioexpander'
    }

    setTab(tab: ViewTab): void {
        this.activeTab = tab
    }

    get content(): string {
        return this.state.configHContent
    }

    onRawChange = (text: string): void => {
        this.state.configHContent = text
        this.state.syncConfigH()
    }
}
