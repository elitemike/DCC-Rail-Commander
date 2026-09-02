import { IDialogController, IDialogCustomElementViewModel } from '@aurelia/dialog'
import { resolve } from 'aurelia'
import { getHalBoard } from '../../config/hal-boards'
import type { HalDeviceInstance } from '../../config/hal-devices'

interface HalDeviceLabelDialogModel {
    /** Only the devices `project-importer.ts` marked `isDefaultLabel` — every other device
     *  already carries a real, previously-chosen label and has nothing to ask about here. */
    devices: HalDeviceInstance[]
}

interface Row {
    instanceId: string
    boardLabel: string
    chip: string
    addressHex: string
    label: string
}

function formatHex(n: number): string {
    return '0x' + n.toString(16).padStart(2, '0')
}

/**
 * Shown after reviewing an existing-project import whenever the merged HAL accessory devices
 * (myAutomation_HAL.h et al. — see project-importer.ts) include one or more bare, untagged
 * `HAL(...)` lines, the normal shape for a hand-written project. Those get parsed with only the
 * generic catalog board name as a label (e.g. every MCP23017 16-Channel I/O Expander looks the
 * same), so a project with several instances of the same board type has no way to tell them apart
 * in the Accessories tab. Labeling is optional — skipping leaves the generic name in place, which
 * is a legitimate no-op, not an error state — but strongly suggested since it's the only chance to
 * label them without re-deriving which physical board is which from wiring notes.
 */
export class HalDeviceLabelDialog implements IDialogCustomElementViewModel {
    readonly $dialog = resolve(IDialogController)

    rows: Row[] = []

    activate(model: HalDeviceLabelDialogModel): void {
        this.rows = model.devices.map(d => ({
            instanceId: d.instanceId,
            boardLabel: getHalBoard(d.boardId)?.label ?? d.boardId,
            chip: getHalBoard(d.boardId)?.chip ?? '',
            addressHex: formatHex(d.address),
            label: d.label,
        }))
    }

    /** Escape/backdrop dismissal is treated the same as Skip — this dialog never blocks import. */
    skip(): void {
        void this.$dialog.ok(new Map<string, string>())
    }

    continue(): void {
        const labels = new Map<string, string>()
        for (const row of this.rows) {
            const trimmed = row.label.trim()
            if (trimmed) labels.set(row.instanceId, trimmed)
        }
        void this.$dialog.ok(labels)
    }
}
