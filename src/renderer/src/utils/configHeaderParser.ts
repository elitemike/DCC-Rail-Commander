/**
 * Parser and builder for the device-configuration comment block that
 * EX-Installer embeds at the top of config.h.
 *
 * The block is pure C++ comment syntax so it compiles cleanly, but it encodes
 * the board name/port/FQBN so the app can restore device selection when the
 * same folder is opened again — even after a full app reinstall.
 *
 * Format (both lines act as the open and close tag):
 *
 *   // ==== DCCEX-Installer Device Configuration ====
 *   //   Name:     Arduino Mega 2560
 *   //   Port:     /dev/ttyUSB0
 *   //   FQBN:     arduino:avr:mega
 *   //   Protocol: serial
 *   //   Updated:  2024-01-15T14:30:00.000Z
 *   // ==== DCCEX-Installer Device Configuration ====
 */

import type { DetectedBoardInfo } from '../../../types/ipc'

const DEVICE_HEADER_TAG = '// ==== DCCEX-Installer Device Configuration ===='

/** Returns true if config.h text contains an embedded device header block */
export function hasDeviceHeader(text: string): boolean {
    return text.includes(DEVICE_HEADER_TAG)
}

const UPDATED_LINE_RE = /^\/\/[ \t]*Updated:[ \t]*.*$/m

/**
 * Replaces the dynamic "Updated" timestamp line with a static placeholder.
 * Mirrors normalizeGeneratorTimestamp() in myAutomationParser.ts — this line
 * is rewritten to "now" whenever the device header gets (re)injected, so a
 * raw content comparison (e.g. the Preview Changes diff) needs to ignore it
 * to avoid treating config.h as changed on every save.
 */
export function normalizeDeviceHeaderTimestamp(text: string): string {
    return text.replace(UPDATED_LINE_RE, '//   Updated:  (unchanged)')
}

/**
 * Removes the device header block entirely. Mirrors stripGeneratorHeader()
 * in myAutomationParser.ts — used by the Preview Changes diff so it shows
 * only real content, not installer boilerplate.
 */
export function stripDeviceHeader(text: string): string {
    if (!hasDeviceHeader(text)) return text
    const firstIdx = text.indexOf(DEVICE_HEADER_TAG)
    const secondIdx = text.indexOf(DEVICE_HEADER_TAG, firstIdx + DEVICE_HEADER_TAG.length)
    if (secondIdx === -1) return text
    let endIdx = secondIdx + DEVICE_HEADER_TAG.length
    if (text.startsWith('\r\n', endIdx)) endIdx += 2
    else if (text[endIdx] === '\n') endIdx += 1
    return text.slice(0, firstIdx) + text.slice(endIdx)
}

/** Builds the device comment block to embed in config.h */
export function buildDeviceHeader(device: DetectedBoardInfo): string {
    return [
        DEVICE_HEADER_TAG,
        `//   Name:     ${device.name}`,
        `//   Port:     ${device.port}`,
        `//   FQBN:     ${device.fqbn}`,
        `//   Protocol: ${device.protocol}`,
        `//   Updated:  ${new Date().toISOString()}`,
        DEVICE_HEADER_TAG,
    ].join('\n')
}

/**
 * Parses an `DetectedBoardInfo` object from a device header block in text.
 * Returns `null` when no block is present or required fields are missing.
 */
export function parseDeviceFromHeader(text: string): DetectedBoardInfo | null {
    const firstIdx = text.indexOf(DEVICE_HEADER_TAG)
    if (firstIdx === -1) return null
    const secondIdx = text.indexOf(DEVICE_HEADER_TAG, firstIdx + DEVICE_HEADER_TAG.length)
    if (secondIdx === -1) return null

    // Restrict parsing to only the header block to avoid accidental matches
    const headerBlock = text.slice(firstIdx, secondIdx + DEVICE_HEADER_TAG.length)

    // Be permissive about whitespace so different editors / platforms don't break parsing.
    // Only horizontal whitespace ([ \t]), never \s — \s also matches newlines, so with a
    // *empty* field value (only Port supports that) a plain \s* would swallow the line break
    // and keep matching into the next line's "//   Xxx:" text as if it were the value.
    const nameMatch = /^\/\/[ \t]*Name:[ \t]*(.+)$/m.exec(headerBlock)
    // Port is allowed to be empty (board may not have been connected when the header was written)
    const portMatch = /^\/\/[ \t]*Port:[ \t]*(.*)$/m.exec(headerBlock)
    const fqbnMatch = /^\/\/[ \t]*FQBN:[ \t]*(.+)$/m.exec(headerBlock)
    const protocolMatch = /^\/\/[ \t]*Protocol:[ \t]*(.+)$/m.exec(headerBlock)

    if (!nameMatch || !fqbnMatch) return null

    return {
        name: nameMatch[1].trim(),
        port: portMatch ? portMatch[1].trim() : '',
        fqbn: fqbnMatch[1].trim(),
        protocol: protocolMatch ? protocolMatch[1].trim() : 'serial',
    }
}

/**
 * Inserts (or replaces) a device header block at the very top of the
 * config.h content string.  Existing content is preserved below the block.
 */
export function injectDeviceHeader(configHContent: string, device: DetectedBoardInfo): string {
    const header = buildDeviceHeader(device)

    if (hasDeviceHeader(configHContent)) {
        // Locate the first tag, then the matching closing tag that follows it
        const openIdx = configHContent.indexOf(DEVICE_HEADER_TAG)
        const closeIdx = configHContent.indexOf(DEVICE_HEADER_TAG, openIdx + DEVICE_HEADER_TAG.length)
        if (closeIdx !== -1) {
            const afterClose = closeIdx + DEVICE_HEADER_TAG.length
            const remainder = configHContent.slice(afterClose).replace(/^\n/, '')
            return remainder ? `${header}\n${remainder}` : header
        }
    }

    return configHContent ? `${header}\n${configHContent}` : header
}

/**
 * Reconciles a stored device against the list of currently connected boards.
 *
 * The FQBN is treated as the stable board identity — it never changes for a
 * given board type.  The port, however, is assigned by the OS at plug-in time
 * and can differ on every connection (e.g. /dev/ttyACM0 → /dev/ttyACM1 or
 * COM3 → COM4 on Windows).
 *
 * Returns:
 *   `device`      — the reconciled board info (port updated if a live match
 *                   was found, otherwise the stored value is returned unchanged)
 *   `portChanged` — true when the live port differs from the stored port
 */
/**
 * Returns the base FQBN (first three colon-separated segments) so that boards
 * that report option-suffixed FQBNs (e.g. esp32:esp32:esp32:FlashFreq=80m,...)
 * still match against the canonical form stored in config.h.
 */
function baseFqbn(fqbn: string): string {
    return fqbn.split(':').slice(0, 3).join(':')
}

export function reconcileDevicePort(
    stored: DetectedBoardInfo,
    connected: DetectedBoardInfo[],
): { device: DetectedBoardInfo; portChanged: boolean } {
    // Match on base FQBN — stable board identity, ignoring option suffixes
    const match = connected.find(b => baseFqbn(b.fqbn) === baseFqbn(stored.fqbn))

    if (!match) {
        // Board not currently attached — use stored info as-is
        return { device: stored, portChanged: false }
    }

    if (match.port === stored.port) {
        // Same port — nothing to do
        return { device: stored, portChanged: false }
    }

    // Port changed (or was previously empty) — return updated board with live port
    return {
        device: { ...stored, port: match.port },
        portChanged: true,
    }
}
