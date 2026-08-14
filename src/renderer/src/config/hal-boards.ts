/**
 * hal-boards.ts — catalog of I2C accessory ("HAL device") boards that can be
 * declared in myAutomation.h via DCC-EX's `HAL(device, vpin, pinCount, address)`
 * macro (see https://dcc-ex.com/exrail/exrail-command-reference.html#create-and-manage-hal-device-objects).
 *
 * This is the extensibility point: adding support for a new board that uses a
 * chip DCC-EX already understands (PCA9555, MCP23017, PCA9685, or an I2C
 * multiplexer) means adding one entry here — no new UI or generator code.
 * A genuinely new chip type needs a new case in hal-devices.ts's line generator.
 *
 * Address ranges below are taken from each board's own operating manual where
 * one exists (rosscoe.com/Documents/*_operation_manual.pdf); RT_PCA9555_SH
 * reuses the RT_DCD_16 manual's PCA9555 address table since it's the same chip
 * family. RT_PCA9685_SH has no published jumper table, so its address is a
 * bounded free-entry field rather than a fixed list — see hal-devices-form.
 */
export type HalChipType = 'PCA9555' | 'MCP23017' | 'PCA9685' | 'MULTIPLEXER'

export interface HalBoardDefinition {
    id: string
    label: string
    vendor: string
    chip: HalChipType
    /** VPins consumed starting at the device's configured vpin. 0 for a pure multiplexer. */
    pinCount: number
    /** Drives the "quick add" convenience action in hal-devices-form. */
    pinRole: 'sensor' | 'servo' | 'none'
    isMultiplexer: boolean
    /** Number of downstream sub-bus channels (0-based) this board exposes, if it's a multiplexer. */
    muxChannelCount?: number
    addressMode: 'fixed-list' | 'free-entry'
    /** For 'fixed-list' boards — the exact jumper-selectable addresses from the manual. */
    addressOptions?: number[]
    /** For 'free-entry' boards — inclusive [min, max] bound on the address field. */
    addressRange?: [number, number]
    defaultAddress: number
    docsUrl?: string
}

const PCA9555_ADDRESS_OPTIONS = [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27]
const MULTIPLEXER_ADDRESS_OPTIONS = [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77]

export const HAL_BOARD_CATALOG: HalBoardDefinition[] = [
    {
        id: 'rt_dcd_16',
        label: 'RT DCD-16 Block Sensor',
        vendor: 'Rosscoe',
        chip: 'PCA9555',
        pinCount: 16,
        pinRole: 'sensor',
        isMultiplexer: false,
        addressMode: 'fixed-list',
        addressOptions: PCA9555_ADDRESS_OPTIONS,
        defaultAddress: 0x20,
        docsUrl: 'https://rosscoe.com/Documents/RT_DCD_16_operation_manual.pdf',
    },
    {
        id: 'rt_i2c_iso_mux',
        label: 'RT I2C Isolated Multiplexer',
        vendor: 'Rosscoe',
        chip: 'MULTIPLEXER',
        pinCount: 0,
        pinRole: 'none',
        isMultiplexer: true,
        muxChannelCount: 8,
        addressMode: 'fixed-list',
        // 0x70 is also the PCA9685 "All Call" broadcast default — avoid it when possible.
        addressOptions: MULTIPLEXER_ADDRESS_OPTIONS,
        defaultAddress: 0x71,
        docsUrl: 'https://rosscoe.com/Documents/RT_I2C_ISO_MUX_operation_manual.pdf',
    },
    {
        id: 'rt_pca9555_sh',
        label: 'RT PCA9555 (headers soldered)',
        vendor: 'Rosscoe',
        chip: 'PCA9555',
        pinCount: 16,
        pinRole: 'sensor',
        isMultiplexer: false,
        addressMode: 'fixed-list',
        addressOptions: PCA9555_ADDRESS_OPTIONS,
        defaultAddress: 0x20,
    },
    {
        id: 'rt_pca9685_sh',
        label: 'RT PCA9685 (headers soldered)',
        vendor: 'Rosscoe',
        chip: 'PCA9685',
        pinCount: 16,
        pinRole: 'servo',
        isMultiplexer: false,
        // No published jumper table for this board — bounded free entry instead
        // of a fixed dropdown. 0x70 (PCA9685 "All Call" default) is inside the
        // range but flagged by hal-devices-form as a likely multiplexer conflict.
        addressMode: 'free-entry',
        addressRange: [0x40, 0x7f],
        defaultAddress: 0x40,
    },
]

export function getHalBoard(boardId: string): HalBoardDefinition | undefined {
    return HAL_BOARD_CATALOG.find(b => b.id === boardId)
}
