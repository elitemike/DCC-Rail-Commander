import { resolve } from 'aurelia'
import { ConfigEditorState } from '../../models/config-editor-state'
import { HAL_BOARD_CATALOG, getHalBoard, type HalBoardDefinition } from '../../config/hal-boards'
import { generateHalDevicesBlock, type HalDeviceInstance } from '../../config/hal-devices'

/**
 * hal-devices-form — the "Accessories" tab of Device Settings for
 * EX-CommandStation. Lets the user declare I2C add-on boards (block sensors,
 * multiplexers, IO/servo expanders) from HAL_BOARD_CATALOG.
 *
 * Deliberately lives under Device Settings, not Automation — see
 * hal-devices.ts's doc comment and the plan this was built from. The
 * generated output still has to land in myAutomation.h's managed HAL Devices
 * block (a DCC-EX file-format fact), via `editorState.syncHalDevices()`,
 * mirroring TrackManager's write path exactly (see track-manager-form.ts) —
 * NOT the sensors/turnouts pattern, since myAutomation.h's Raw tab has no
 * live reparse-on-edit hookup back into structured state.
 *
 * `devices` here is this form's own working copy (like track-manager-form's
 * `opts`), re-derived from `editorState.halDevices` only on (re)load — never
 * re-read mid-session, since `halDevices` is a getter that re-parses fresh
 * text on every access and would hand out new random instance ids each time.
 */
export class HalDevicesFormCustomElement {
    private readonly editorState = resolve(ConfigEditorState)

    readonly catalog: HalBoardDefinition[] = HAL_BOARD_CATALOG
    devices: HalDeviceInstance[] = []
    boardToAdd: string = HAL_BOARD_CATALOG[0].id

    // Event handler for config switches, mirroring track-manager-form.ts.
    private configSwitchedHandler = (): void => {
        this.reload()
    }

    binding(): void {
        this.reload()
    }

    attached(): void {
        try {
            window.addEventListener('exinst:config-switched', this.configSwitchedHandler as EventListener)
        } catch {
            // noop in non-browser contexts
        }
    }

    detaching(): void {
        try {
            window.removeEventListener('exinst:config-switched', this.configSwitchedHandler as EventListener)
        } catch {
            // noop
        }
    }

    private reload(): void {
        this.devices = this.editorState.halDevices
    }

    get vpinsInUse(): number {
        return this.editorState.vpinAllocations.reduce((sum, a) => sum + a.count, 0)
    }

    get nextFreeVpin(): number {
        return this.editorState.nextFreeVpin
    }

    board(device: HalDeviceInstance): HalBoardDefinition | undefined {
        return getHalBoard(device.boardId)
    }

    formatAddress(addr: number): string {
        return '0x' + addr.toString(16).padStart(2, '0')
    }

    boardLabel(boardId: string): string {
        return getHalBoard(boardId)?.label ?? boardId
    }

    /** Multiplexer rows other than the device's own row — the "Behind multiplexer" dropdown source. */
    get multiplexers(): HalDeviceInstance[] {
        return this.devices.filter(d => getHalBoard(d.boardId)?.isMultiplexer)
    }

    channelOptions(device: HalDeviceInstance): number[] {
        if (!device.parentMuxInstanceId) return []
        const parent = this.devices.find(d => d.instanceId === device.parentMuxInstanceId)
        const board = parent ? getHalBoard(parent.boardId) : undefined
        const count = board?.muxChannelCount ?? 0
        return Array.from({ length: count }, (_, i) => i)
    }

    /**
     * Other HAL boards' VPin ranges this device's range overlaps with (excluding itself) — shown
     * as an inline warning. Deliberately restricted to `onlyKind: 'device'`: a turnout/sensor/
     * signal using one of this board's own channels is the normal, expected way of consuming it,
     * not a conflict — see VpinAllocation.kind.
     */
    conflictsFor(device: HalDeviceInstance): string[] {
        const board = this.board(device)
        if (!board || board.pinCount === 0 || device.vpinStart == null) return []
        const source = `${board.label}: ${device.label}`
        return this.editorState
            .findVpinConflicts(device.vpinStart, board.pinCount, source, 'device')
            .map(c => c.source)
    }

    /** True if another device shares this device's exact address on the same physical bus segment. */
    addressConflict(device: HalDeviceInstance): boolean {
        return this.devices.some(
            other =>
                other.instanceId !== device.instanceId &&
                other.address === device.address &&
                other.parentMuxInstanceId === device.parentMuxInstanceId &&
                other.muxChannel === device.muxChannel,
        )
    }

    addDevice(): void {
        const board = getHalBoard(this.boardToAdd)
        if (!board) return
        const device: HalDeviceInstance = {
            instanceId: `hal-${Math.random().toString(36).slice(2, 10)}`,
            boardId: board.id,
            label: board.label,
            address: board.defaultAddress,
            vpinStart: board.pinCount > 0 ? this.editorState.nextFreeVpin : null,
        }
        this.devices = [...this.devices, device]
        this.onFieldChange()
    }

    removeDevice(index: number): void {
        const removed = this.devices[index]
        this.devices = this.devices
            .filter((_, i) => i !== index)
            .map(d =>
                d.parentMuxInstanceId === removed.instanceId
                    ? { ...d, parentMuxInstanceId: undefined, muxChannel: undefined }
                    : d,
            )
        this.onFieldChange()
    }

    /** "Add N sensors from this device" — only offered for pinRole 'sensor' boards. */
    addSensorsFromDevice(device: HalDeviceInstance): void {
        const board = this.board(device)
        if (!board || board.pinRole !== 'sensor' || device.vpinStart == null) return
        const startId = (this.editorState.sensors[this.editorState.sensors.length - 1]?.id ?? 0) + 1
        const newSensors = Array.from({ length: board.pinCount }, (_, i) => ({
            id: startId + i,
            pin: device.vpinStart! + i,
            description: `${device.label} ch ${i + 1}`,
        }))
        this.editorState.sensors = [...this.editorState.sensors, ...newSensors]
        this.editorState.syncAll()
    }

    onFieldChange(): void {
        this.editorState.syncHalDevices(generateHalDevicesBlock(this.devices))
    }
}
