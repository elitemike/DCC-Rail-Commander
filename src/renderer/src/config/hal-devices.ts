/**
 * hal-devices.ts — generator/parser for the HAL Devices managed block inside
 * myAutomation.h (see MANAGED_HAL_DEVICES_TAG in config-editor-state.ts), plus
 * the cross-device VPin registry.
 *
 * Round-tripping: DCC-EX's `HAL(chip, vpin, pinCount, address)` macro has no
 * room for DCC-Rail-Commander-only metadata (a stable instance id, a user-editable
 * friendly name, which catalog board produced it — e.g. PCA9555+16 pins could
 * be either RT DCD-16 or RT PCA9555). Each device therefore gets a leading
 * `// HAL(board=..., label="...")` comment immediately above its real `HAL(...)`
 * line; multiplexers produce no `HAL(...)` line at all (DCC-EX auto-detects
 * them from their I2C address), so they get a comment-only
 * `// HAL-MUX(board=..., address=..., label="...")` line instead. Both are
 * plain comments — harmless to the compiler, ignored by DCC-EX, parsed back by
 * this file on load so the block round-trips byte-for-byte.
 */
import type { Turnout, SensorEntry, SignalEntry } from '../utils/myAutomationParser'
import { getHalBoard, HAL_BOARD_CATALOG, type HalBoardDefinition, type HalChipType } from './hal-boards'

export interface HalDeviceInstance {
    instanceId: string
    boardId: string
    /** User-editable friendly name, e.g. "Yard block detector". */
    label: string
    address: number
    /** null for multiplexer instances — they consume no vpins. */
    vpinStart: number | null
    parentMuxInstanceId?: string
    /** 0-based sub-bus channel on the parent multiplexer. */
    muxChannel?: number
}

/**
 * Deterministic id for a device parsed back out of myAutomation.h — the same text must always
 * parse to the same ids. `ConfigEditorState.halDevices` is a getter that re-parses the raw text
 * fresh on every access (see hal-devices-form.ts's doc comment), so a random id here would change
 * between one access and the next; a consumer that reads it twice in quick succession — e.g.
 * vpin-picker deriving `source` from one read, then rendering its `<option>` list from a second —
 * would then never find a match, and silently fall back to "Direct MCU pin" even when the value
 * is really a board+channel. `index` is the device's position in parse order, which is stable for
 * identical input text.
 */
function parsedInstanceId(boardId: string, address: number, index: number): string {
    return `hal-${boardId}-${formatHex(address)}-${index}`
}

function formatHex(n: number): string {
    return '0x' + n.toString(16).padStart(2, '0')
}

function escapeLabel(label: string): string {
    return label.replace(/"/g, '\\"')
}

function unescapeLabel(label: string): string {
    return label.replace(/\\"/g, '"')
}

/**
 * Generates the comment(+HAL line) for a single device. Returns '' if the
 * device's board can't be found (stale/removed catalog entry).
 */
export function generateHalDeviceLine(device: HalDeviceInstance, devices: HalDeviceInstance[]): string {
    const board = getHalBoard(device.boardId)
    if (!board) return ''

    if (board.isMultiplexer) {
        return `// HAL-MUX(board=${device.boardId}, address=${formatHex(device.address)}, label="${escapeLabel(device.label)}")`
    }

    let addressArg = formatHex(device.address)
    if (device.parentMuxInstanceId) {
        const parent = devices.find(d => d.instanceId === device.parentMuxInstanceId)
        if (parent) {
            const muxIndex = parent.address - 0x70
            addressArg = `{I2CMux_${muxIndex}, SubBus_${device.muxChannel ?? 0}, ${formatHex(device.address)}}`
        }
    }

    const comment = `// HAL(board=${device.boardId}, label="${escapeLabel(device.label)}")`
    const line = `HAL(${board.chip}, ${device.vpinStart}, ${board.pinCount}, ${addressArg})`
    return `${comment}\n${line}`
}

/** Generates the full body of the managed HAL Devices block. */
export function generateHalDevicesBlock(devices: HalDeviceInstance[]): string {
    return devices
        .map(d => generateHalDeviceLine(d, devices))
        .filter(l => l.length > 0)
        .join('\n')
}

// Exported so callers outside this file (the existing-project importer) can classify a line the
// same way this parser does, without re-deriving the pattern — e.g. to tell a bare HAL(...) line
// this parser resolved from one it left untouched (ambiguous/unrecognized chip+pinCount).
export const HAL_MUX_COMMENT_RE = /^\/\/\s*HAL-MUX\(board=([\w-]+),\s*address=(0x[0-9a-fA-F]+),\s*label="((?:[^"\\]|\\.)*)"\)\s*$/
export const HAL_DEVICE_COMMENT_RE = /^\/\/\s*HAL\(board=([\w-]+),\s*label="((?:[^"\\]|\\.)*)"\)\s*$/
export const HAL_LINE_RE = /^HAL\(\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:(0x[0-9a-fA-F]+)|\{\s*I2CMux_(\d+)\s*,\s*SubBus_(\d+)\s*,\s*(0x[0-9a-fA-F]+)\s*\})\s*\)\s*$/

/** True when a bare, untagged `HAL(chip, vpin, pinCount, addr)` line's (chip, pinCount) pair
 *  resolves to exactly one catalog board — the same test `parseHalDevicesFromAutomation`'s own
 *  bare-line pass uses. An ambiguous or unrecognized chip is left for the caller to treat as
 *  unrecognized/leftover content rather than guessed at. */
export function hasUniqueHalCandidate(chip: string, pinCount: number): boolean {
    return HAL_BOARD_CATALOG.filter(b => b.chip === chip && b.pinCount === pinCount && !b.isMultiplexer).length === 1
}

/** Parses the managed HAL Devices block body back into instances. */
export function parseHalDevicesFromAutomation(content: string): HalDeviceInstance[] {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    const devices: HalDeviceInstance[] = []

    // First pass: multiplexers, so device rows below can resolve parentMuxInstanceId by address.
    for (const line of lines) {
        const m = HAL_MUX_COMMENT_RE.exec(line)
        if (!m) continue
        const address = parseInt(m[2], 16)
        devices.push({
            instanceId: parsedInstanceId(m[1], address, devices.length),
            boardId: m[1],
            label: unescapeLabel(m[3]),
            address,
            vpinStart: null,
        })
    }

    // Second pass: paired "// HAL(board=...)" comment + "HAL(...)" line.
    for (let i = 0; i < lines.length; i++) {
        const m = HAL_DEVICE_COMMENT_RE.exec(lines[i])
        if (!m) continue
        const halLine = lines[i + 1]
        const hm = halLine ? HAL_LINE_RE.exec(halLine) : null
        if (!hm) continue

        const vpinStart = parseInt(hm[2], 10)
        let address: number
        let parentMuxInstanceId: string | undefined
        let muxChannel: number | undefined

        if (hm[4]) {
            address = parseInt(hm[4], 16)
        } else {
            const muxIndex = parseInt(hm[5], 10)
            muxChannel = parseInt(hm[6], 10)
            address = parseInt(hm[7], 16)
            const muxAddress = 0x70 + muxIndex
            const parent = devices.find(d => d.address === muxAddress && getHalBoard(d.boardId)?.isMultiplexer)
            parentMuxInstanceId = parent?.instanceId
        }

        devices.push({
            instanceId: parsedInstanceId(m[1], address, devices.length),
            boardId: m[1],
            label: unescapeLabel(m[2]),
            address,
            vpinStart,
            parentMuxInstanceId,
            muxChannel,
        })
    }

    // Third pass: bare, untagged HAL(...) lines — no DCC-Rail-Commander comment tag at all (the
    // normal case for a hand-written project, e.g. importing an existing one). Resolved only
    // when (chip, pinCount) matches exactly one catalog board — see hal-boards.ts's own note on
    // chip+pinCount ambiguity (PCA9555 alone maps to two different catalog boards). An
    // unrecognized chip or an ambiguous match is left unparsed here rather than guessed at; it
    // stays as plain text the caller is free to treat as unrecognized/leftover content.
    for (let i = 0; i < lines.length; i++) {
        const hm = HAL_LINE_RE.exec(lines[i])
        if (!hm) continue
        const prevLine = lines[i - 1]
        if (prevLine && HAL_DEVICE_COMMENT_RE.test(prevLine)) continue // already handled above

        const chip = hm[1] as HalChipType
        const pinCount = parseInt(hm[3], 10)
        const candidates = HAL_BOARD_CATALOG.filter(b => b.chip === chip && b.pinCount === pinCount && !b.isMultiplexer)
        if (candidates.length !== 1) continue
        const board = candidates[0]

        const vpinStart = parseInt(hm[2], 10)
        let address: number
        let parentMuxInstanceId: string | undefined
        let muxChannel: number | undefined

        if (hm[4]) {
            address = parseInt(hm[4], 16)
        } else {
            const muxIndex = parseInt(hm[5], 10)
            muxChannel = parseInt(hm[6], 10)
            address = parseInt(hm[7], 16)
            const muxAddress = 0x70 + muxIndex
            // No comment tag means no record of the multiplexer's own identity either (DCC-EX
            // needs no HAL(...) line at all for a mux — it's auto-detected — so there's nothing
            // in the file for an untagged project to have recorded it under). Losing this link
            // isn't harmless, though — generateHalDeviceLine only emits the {I2CMux_N,SubBus_M,addr}
            // form when parentMuxInstanceId resolves to a real parent, so leaving it undefined
            // would silently flatten the device back to a bare address and change the wiring
            // topology (which sub-bus it's actually on) on the very next regeneration. There's
            // exactly one multiplexer board in the whole catalog today, so — unlike the
            // chip+pinCount ambiguity above — synthesizing one here from muxAddress alone is a
            // confident inference, not a guess; only skip it if the catalog ever grows a second
            // multiplexer type, at which point which one it is genuinely can't be known.
            let parent = devices.find(d => d.address === muxAddress && getHalBoard(d.boardId)?.isMultiplexer)
            if (!parent) {
                const muxBoards = HAL_BOARD_CATALOG.filter(b => b.isMultiplexer)
                if (muxBoards.length === 1) {
                    parent = {
                        instanceId: parsedInstanceId(muxBoards[0].id, muxAddress, devices.length),
                        boardId: muxBoards[0].id,
                        label: muxBoards[0].label,
                        address: muxAddress,
                        vpinStart: null,
                    }
                    devices.push(parent)
                }
            }
            parentMuxInstanceId = parent?.instanceId
        }

        devices.push({
            instanceId: parsedInstanceId(board.id, address, devices.length),
            boardId: board.id,
            label: board.label,
            address,
            vpinStart,
            parentMuxInstanceId,
            muxChannel,
        })
    }

    return devices
}

// ── VPin registry ───────────────────────────────────────────────────────────

export interface VpinAllocation {
    start: number
    count: number
    /** Human-readable owner, shown in conflict warnings. */
    source: string
    /**
     * 'device' = the whole VPin range a HAL board makes available; 'consumer' = a single VPin
     * actually claimed by a turnout/sensor/signal. A consumer sitting inside a device's range is
     * the normal, expected way of using that board's channels — not a conflict — so callers that
     * want genuine double-use detection for a device's own range (see `onlyKind` below) must
     * compare it only against other devices, never against consumers.
     */
    kind: 'device' | 'consumer'
}

/** Aggregates every VPin-consuming thing in the config into one flat list. */
export function computeVpinAllocations(
    turnouts: Turnout[],
    sensors: SensorEntry[],
    signals: SignalEntry[],
    halDevices: HalDeviceInstance[],
): VpinAllocation[] {
    const allocations: VpinAllocation[] = []

    for (const t of turnouts) {
        if ('pin' in t && t.pin > 0) {
            allocations.push({ start: t.pin, count: 1, source: `Turnout: ${t.description}`, kind: 'consumer' })
        }
    }

    for (const s of sensors) {
        allocations.push({ start: s.pin, count: 1, source: `Sensor: ${s.description}`, kind: 'consumer' })
    }

    for (const sig of signals) {
        // DCC_SIGNAL is a DCC accessory address, not a VPin-driven device — nothing to allocate.
        if (sig.type === 'DCC') continue
        const aspects: Array<[string, number]> = [['red', sig.red], ['amber', sig.amber], ['green', sig.green]]
        for (const [role, pin] of aspects) {
            if (pin > 0) {
                allocations.push({ start: pin, count: 1, source: `Signal (${role}): ${sig.description ?? ''}`, kind: 'consumer' })
            }
        }
    }

    for (const d of halDevices) {
        const board: HalBoardDefinition | undefined = getHalBoard(d.boardId)
        if (!board || board.pinCount === 0 || d.vpinStart == null) continue
        allocations.push({ start: d.vpinStart, count: board.pinCount, source: `${board.label}: ${d.label}`, kind: 'device' })
    }

    return allocations
}

function rangesOverlap(aStart: number, aCount: number, bStart: number, bCount: number): boolean {
    return aStart < bStart + bCount && bStart < aStart + aCount
}

/**
 * Returns every allocation that overlaps the candidate range, excluding one by source (e.g. the
 * row being edited). Pass `onlyKind` to restrict the comparison to allocations of that kind —
 * e.g. a HAL device checking its own range for conflicts should pass `onlyKind: 'device'` so it's
 * only flagged against other boards' overlapping ranges, not against every consumer legitimately
 * using one of its own channels (see `VpinAllocation.kind`). Omit it for the "is this candidate
 * VPin free" case (auto-picking a new pin), which should still avoid both.
 */
export function findVpinConflicts(
    allocations: VpinAllocation[],
    candidateStart: number,
    candidateCount: number,
    excludeSource?: string,
    onlyKind?: VpinAllocation['kind'],
): VpinAllocation[] {
    return allocations.filter(
        a =>
            a.source !== excludeSource &&
            (!onlyKind || a.kind === onlyKind) &&
            rangesOverlap(a.start, a.count, candidateStart, candidateCount),
    )
}

/**
 * Counts distinct VPins covered by `allocations`, not the raw sum of their `count`s — a
 * turnout/sensor/signal using a channel on a HAL device (the normal case) claims a VPin that's
 * already counted in that device's own range, so a plain sum double-counts it. See
 * `computeVpinAllocations`'s `kind` doc.
 */
export function countDistinctVpins(allocations: VpinAllocation[]): number {
    const pins = new Set<number>()
    for (const a of allocations) {
        for (let p = a.start; p < a.start + a.count; p++) pins.add(p)
    }
    return pins.size
}

/**
 * Finds the first free VPin at or after `minimum`. Defaults to 100 — DCC-EX's
 * own examples (and RT_DCD_16's manual) reserve 0-99 for physical MCU pins
 * referenced directly by things like SERVO_TURNOUT/PIN_TURNOUT, and start
 * HAL/virtual device vpins at 100+.
 */
export function findNextFreeVpin(allocations: VpinAllocation[], minimum = 100): number {
    let candidate = minimum
    let moved = true
    while (moved) {
        moved = false
        for (const a of allocations) {
            if (candidate >= a.start && candidate < a.start + a.count) {
                candidate = a.start + a.count
                moved = true
            }
        }
    }
    return candidate
}
