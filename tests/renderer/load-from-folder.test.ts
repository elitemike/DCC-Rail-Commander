/**
 * Unit tests: generator header utilities (myAutomationParser.ts),
 * device header utilities (configHeaderParser.ts), and
 * myAutomation.h automation content helpers (config-editor-state.ts).
 */
import { describe, it, expect } from 'vitest'
import {
    hasDeviceHeader,
    buildDeviceHeader,
    parseDeviceFromHeader,
    injectDeviceHeader,
    reconcileDevicePort,
} from '../../src/renderer/src/utils/configHeaderParser'
import type { ArduinoCliBoardInfo } from '../../src/types/ipc'
import {
    hasGeneratorHeader,
    getGeneratorVersion,
    buildGeneratorHeader,
    GENERATOR_HEADER_MARKER,
    parseRosterFromFile,
    parseTurnoutFromFile,
    parseDefaultThrownTurnoutIdsFromAutomation,
    serializeRosterToFile,
    serializeTurnoutToFile,
} from '../../src/renderer/src/utils/myAutomationParser'
import {
    extractAutomationCustomContent,
    MANAGED_INCLUDES_TAG,
    MANAGED_TRACK_MANAGER_TAG,
    MANAGED_TURNOUT_DEFAULTS_TAG,
} from '../../src/renderer/src/models/config-editor-state'

// ── hasGeneratorHeader ────────────────────────────────────────────────────────

describe('hasGeneratorHeader', () => {
    it('returns true for a file that starts with a built header', () => {
        const text = buildGeneratorHeader('myRoster.h', '0.1.0') + '\nROSTER(3, "Thomas", "")'
        expect(hasGeneratorHeader(text)).toBe(true)
    })

    it('returns true even when the header is not on the very first line', () => {
        const text = '\n' + buildGeneratorHeader('myRoster.h', '1.0.0') + '\nROSTER(3, "Thomas", "")'
        expect(hasGeneratorHeader(text)).toBe(true)
    })

    it('returns false for a plain roster file without a header', () => {
        const text = 'ROSTER(3, "Thomas", "LIGHT/HORN")\nROSTER(5, "Percy", "LIGHT")'
        expect(hasGeneratorHeader(text)).toBe(false)
    })

    it('returns false for an arbitrary comment at the top', () => {
        const text = '// My personal roster\n// Edited 2024-01-01\nROSTER(3, "Thomas", "")'
        expect(hasGeneratorHeader(text)).toBe(false)
    })

    it('returns false for empty string', () => {
        expect(hasGeneratorHeader('')).toBe(false)
    })
})

// ── getGeneratorVersion ───────────────────────────────────────────────────────

describe('getGeneratorVersion', () => {
    it('extracts the version from a header built with that version', () => {
        const text = buildGeneratorHeader('myRoster.h', '1.2.3')
        expect(getGeneratorVersion(text)).toBe('1.2.3')
    })

    it('extracts 0.1.0 correctly', () => {
        const text = buildGeneratorHeader('myTurnouts.h', '0.1.0')
        expect(getGeneratorVersion(text)).toBe('0.1.0')
    })

    it('returns null when no header is present', () => {
        expect(getGeneratorVersion('ROSTER(3, "Thomas", "")')).toBeNull()
    })

    it('returns null for an empty file', () => {
        expect(getGeneratorVersion('')).toBeNull()
    })
})

// ── buildGeneratorHeader ──────────────────────────────────────────────────────

describe('buildGeneratorHeader', () => {
    it('contains the DCCEX-Installer version marker', () => {
        const header = buildGeneratorHeader('myRoster.h', '0.1.0')
        expect(header).toContain('DCCEX-Installer v0.1.0')
    })

    it('contains the filename', () => {
        const header = buildGeneratorHeader('myRoster.h', '0.1.0')
        expect(header).toContain('myRoster.h')
    })

    it('produces only comment lines (no bare code)', () => {
        const header = buildGeneratorHeader('myTurnouts.h', '0.1.0')
        const nonEmptyLines = header.split('\n').filter(l => l.trim() !== '')
        for (const line of nonEmptyLines) {
            expect(line.trimStart()).toMatch(/^\/\//)
        }
    })

    it('satisfies hasGeneratorHeader after construction', () => {
        const header = buildGeneratorHeader('myRoster.h', '0.1.0')
        expect(hasGeneratorHeader(header)).toBe(true)
    })

    it('produces distinct output for different filenames', () => {
        const rosterH = buildGeneratorHeader('myRoster.h', '0.1.0')
        const turnoutsH = buildGeneratorHeader('myTurnouts.h', '0.1.0')
        expect(rosterH).not.toBe(turnoutsH)
    })

    it('GENERATOR_HEADER_MARKER string is contained in the header', () => {
        const header = buildGeneratorHeader('myRoster.h', '0.1.0')
        expect(header).toContain(GENERATOR_HEADER_MARKER)
    })
})

// ── Round-trip: header + data survives parse/serialize ───────────────────────

describe('header round-trip with roster data', () => {
    const ROSTER_CONTENT = 'ROSTER(3, "Thomas", "LIGHT/HORN/*WHISTLE")\nROSTER(5, "Percy", "LIGHT")'

    it('parseRosterFromFile ignores generator header lines', () => {
        const header = buildGeneratorHeader('myRoster.h', '0.1.0')
        const full = `${header}\n${ROSTER_CONTENT}`
        const roster = parseRosterFromFile(full)
        expect(roster).toHaveLength(2)
        expect(roster[0].dccAddress).toBe(3)
        expect(roster[0].name).toBe('Thomas')
        expect(roster[1].dccAddress).toBe(5)
    })

    it('parseTurnoutFromFile ignores generator header lines', () => {
        const TURNOUT_CONTENT = 'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line")'
        const header = buildGeneratorHeader('myTurnouts.h', '0.1.0')
        const full = `${header}\n${TURNOUT_CONTENT}`
        const turnouts = parseTurnoutFromFile(full)
        expect(turnouts).toHaveLength(1)
        expect(turnouts[0].id).toBe(200)
        expect(turnouts[0].defaultState).toBe('NORMAL')
    })

    it('extracts default thrown turnout IDs from AUTOSTART THROW lines', () => {
        const automation = [
            'AUTOSTART',
            '  THROW(200)',
            '  THROW(204)',
            'DONE',
        ].join('\n')

        const ids = parseDefaultThrownTurnoutIdsFromAutomation(automation)
        expect(Array.from(ids).sort((a, b) => a - b)).toEqual([200, 204])
    })

    it('serializeRosterToFile output with header still parses cleanly', () => {
        const roster = parseRosterFromFile(ROSTER_CONTENT)
        const serialized = serializeRosterToFile(roster)
        const header = buildGeneratorHeader('myRoster.h', '0.1.0')
        const full = `${header}\n${serialized}`

        const reparsed = parseRosterFromFile(full)
        expect(reparsed).toHaveLength(2)
        expect(reparsed[0].dccAddress).toBe(3)
        expect(reparsed[1].dccAddress).toBe(5)
    })

    it('serializeTurnoutToFile output with header still parses cleanly', () => {
        const TURNOUT_CONTENT = [
            'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line")',
            'TURNOUT(201, 50, 1, "DCC Switch")',
        ].join('\n')
        const turnouts = parseTurnoutFromFile(TURNOUT_CONTENT)
        const serialized = serializeTurnoutToFile(turnouts)
        const header = buildGeneratorHeader('myTurnouts.h', '0.1.0')
        const full = `${header}\n${serialized}`

        const reparsed = parseTurnoutFromFile(full)
        expect(reparsed).toHaveLength(2)
        expect(reparsed[0].id).toBe(200)
        expect(reparsed[1].id).toBe(201)
    })
})

// ── configHeaderParser — device header in config.h ────────────────────────────

const SAMPLE_DEVICE: ArduinoCliBoardInfo = {
    name: 'Arduino Mega 2560',
    port: '/dev/ttyUSB0',
    fqbn: 'arduino:avr:mega',
    protocol: 'serial',
}

const SAMPLE_CONFIG_H = [
    '// My DCC-EX config',
    '#define MAIN_DRIVER_MOTOR_SHIELD STANDARD_MOTOR_SHIELD',
    '#define WIFI_SSID "MyNetwork"',
].join('\n')

describe('hasDeviceHeader', () => {
    it('returns true after injecting a device header', () => {
        const injected = injectDeviceHeader(SAMPLE_CONFIG_H, SAMPLE_DEVICE)
        expect(hasDeviceHeader(injected)).toBe(true)
    })

    it('returns false for plain config.h without a device block', () => {
        expect(hasDeviceHeader(SAMPLE_CONFIG_H)).toBe(false)
    })

    it('returns false for empty string', () => {
        expect(hasDeviceHeader('')).toBe(false)
    })
})

describe('buildDeviceHeader', () => {
    it('contains the board name', () => {
        expect(buildDeviceHeader(SAMPLE_DEVICE)).toContain('Arduino Mega 2560')
    })

    it('contains the port', () => {
        expect(buildDeviceHeader(SAMPLE_DEVICE)).toContain('/dev/ttyUSB0')
    })

    it('contains the FQBN', () => {
        expect(buildDeviceHeader(SAMPLE_DEVICE)).toContain('arduino:avr:mega')
    })

    it('contains the protocol', () => {
        expect(buildDeviceHeader(SAMPLE_DEVICE)).toContain('serial')
    })

    it('produces only comment lines (safe to embed in C++ source)', () => {
        const header = buildDeviceHeader(SAMPLE_DEVICE)
        for (const line of header.split('\n').filter(l => l.trim() !== '')) {
            expect(line.trimStart()).toMatch(/^\/\//)
        }
    })
})

describe('parseDeviceFromHeader', () => {
    it('returns null for plain content with no device block', () => {
        expect(parseDeviceFromHeader(SAMPLE_CONFIG_H)).toBeNull()
    })

    it('returns null for empty string', () => {
        expect(parseDeviceFromHeader('')).toBeNull()
    })

    it('round-trips through buildDeviceHeader → parseDeviceFromHeader', () => {
        const header = buildDeviceHeader(SAMPLE_DEVICE)
        const parsed = parseDeviceFromHeader(header)
        expect(parsed).not.toBeNull()
        expect(parsed!.name).toBe(SAMPLE_DEVICE.name)
        expect(parsed!.port).toBe(SAMPLE_DEVICE.port)
        expect(parsed!.fqbn).toBe(SAMPLE_DEVICE.fqbn)
        expect(parsed!.protocol).toBe(SAMPLE_DEVICE.protocol)
    })

    it('extracts device from config.h that has been injected', () => {
        const injected = injectDeviceHeader(SAMPLE_CONFIG_H, SAMPLE_DEVICE)
        const parsed = parseDeviceFromHeader(injected)
        expect(parsed).not.toBeNull()
        expect(parsed!.name).toBe('Arduino Mega 2560')
        expect(parsed!.fqbn).toBe('arduino:avr:mega')
    })

    it('handles a port path with spaces', () => {
        const device: ArduinoCliBoardInfo = { ...SAMPLE_DEVICE, port: 'COM3' }
        const parsed = parseDeviceFromHeader(buildDeviceHeader(device))
        expect(parsed!.port).toBe('COM3')
    })
})

describe('injectDeviceHeader', () => {
    it('prepends header block to existing content', () => {
        const result = injectDeviceHeader(SAMPLE_CONFIG_H, SAMPLE_DEVICE)
        expect(result.startsWith('// ====')).toBe(true)
        expect(result).toContain('#define MAIN_DRIVER_MOTOR_SHIELD')
    })

    it('original config content is preserved below the header', () => {
        const result = injectDeviceHeader(SAMPLE_CONFIG_H, SAMPLE_DEVICE)
        expect(result).toContain('#define WIFI_SSID "MyNetwork"')
    })

    it('replaces an existing device block rather than appending a second one', () => {
        const first = injectDeviceHeader(SAMPLE_CONFIG_H, SAMPLE_DEVICE)
        const updated: ArduinoCliBoardInfo = { ...SAMPLE_DEVICE, port: 'COM4', name: 'Arduino UNO' }
        const second = injectDeviceHeader(first, updated)

        // Only one occurrence of the tag
        const tagCount = (second.match(/DCCEX-Installer Device Configuration/g) ?? []).length
        expect(tagCount).toBe(2)  // opening + closing — one block

        // New values present, old port not present
        expect(second).toContain('Arduino UNO')
        expect(second).toContain('COM4')
        expect(second).not.toContain('Arduino Mega 2560')
        expect(second).not.toContain('/dev/ttyUSB0')
    })

    it('works on an empty string', () => {
        const result = injectDeviceHeader('', SAMPLE_DEVICE)
        expect(hasDeviceHeader(result)).toBe(true)
    })
})

// ── reconcileDevicePort ───────────────────────────────────────────────────────

describe('reconcileDevicePort', () => {
    const STORED: ArduinoCliBoardInfo = {
        name: 'Arduino Mega 2560',
        port: '/dev/ttyUSB0',
        fqbn: 'arduino:avr:mega',
        protocol: 'serial',
    }

    it('returns stored device unchanged when no boards are connected', () => {
        const { device, portChanged } = reconcileDevicePort(STORED, [])
        expect(portChanged).toBe(false)
        expect(device.port).toBe('/dev/ttyUSB0')
    })

    it('returns stored device unchanged when port is already correct', () => {
        const connected = [{ ...STORED }]
        const { device, portChanged } = reconcileDevicePort(STORED, connected)
        expect(portChanged).toBe(false)
        expect(device.port).toBe('/dev/ttyUSB0')
    })

    it('updates port when same FQBN appears on a different port', () => {
        const connected: ArduinoCliBoardInfo[] = [
            { ...STORED, port: '/dev/ttyACM0' },
        ]
        const { device, portChanged } = reconcileDevicePort(STORED, connected)
        expect(portChanged).toBe(true)
        expect(device.port).toBe('/dev/ttyACM0')
    })

    it('preserves all other fields when updating port', () => {
        const connected: ArduinoCliBoardInfo[] = [
            { ...STORED, port: 'COM4' },
        ]
        const { device } = reconcileDevicePort(STORED, connected)
        expect(device.name).toBe(STORED.name)
        expect(device.fqbn).toBe(STORED.fqbn)
        expect(device.protocol).toBe(STORED.protocol)
    })

    it('does not match boards with a different FQBN', () => {
        const connected: ArduinoCliBoardInfo[] = [
            { name: 'Arduino UNO', port: '/dev/ttyACM0', fqbn: 'arduino:avr:uno', protocol: 'serial' },
        ]
        const { device, portChanged } = reconcileDevicePort(STORED, connected)
        expect(portChanged).toBe(false)
        expect(device.port).toBe('/dev/ttyUSB0')
    })

    it('matches on FQBN even when board names differ', () => {
        const connected: ArduinoCliBoardInfo[] = [
            { name: 'Mega (clone)', port: '/dev/ttyACM1', fqbn: 'arduino:avr:mega', protocol: 'serial' },
        ]
        const { device, portChanged } = reconcileDevicePort(STORED, connected)
        expect(portChanged).toBe(true)
        expect(device.port).toBe('/dev/ttyACM1')
    })

    it('uses first FQBN match when multiple boards of same type are connected', () => {
        const connected: ArduinoCliBoardInfo[] = [
            { ...STORED, port: '/dev/ttyACM0' },
            { ...STORED, port: '/dev/ttyACM1' },
        ]
        const { device } = reconcileDevicePort(STORED, connected)
        expect(device.port).toBe('/dev/ttyACM0')
    })
})

// ── MANAGED_INCLUDES_TAG ──────────────────────────────────────────────────────

describe('MANAGED_INCLUDES_TAG', () => {
    it('is a comment line', () => {
        expect(MANAGED_INCLUDES_TAG.trimStart()).toMatch(/^\/\//)
    })

    it('references EX-Installer', () => {
        expect(MANAGED_INCLUDES_TAG).toContain('EX-Installer')
    })
})

// ── extractAutomationCustomContent ───────────────────────────────────────────

describe('extractAutomationCustomContent', () => {
    it('returns empty string for empty input', () => {
        expect(extractAutomationCustomContent('')).toBe('')
    })

    it('returns empty string when file contains only the managed block', () => {
        const block = [
            MANAGED_INCLUDES_TAG,
            '// These #includes are managed by EX-Installer.',
            '// Do not remove them — they are required for the installer to function correctly.',
            '#include "myRoster.h"',
            '#include "myTurnouts.h"',
            MANAGED_INCLUDES_TAG,
        ].join('\n')
        expect(extractAutomationCustomContent(block)).toBe('')
    })

    it('preserves custom code that follows the managed block', () => {
        const customCode = 'SEQUENCE(100)\n  FWD(50) DELAY(2000) STOP\nDONE'
        const block = [
            MANAGED_INCLUDES_TAG,
            '#include "myRoster.h"',
            MANAGED_INCLUDES_TAG,
            '',
            customCode,
        ].join('\n')
        expect(extractAutomationCustomContent(block)).toBe(customCode)
    })

    it('strips bare #include "myRoster.h" outside the managed block', () => {
        const input = '#include "myRoster.h"\nSEQUENCE(100)\nDONE'
        expect(extractAutomationCustomContent(input)).toBe('SEQUENCE(100)\nDONE')
    })

    it('strips bare #include "myTurnouts.h" outside the managed block', () => {
        const input = '#include "myTurnouts.h"\nALIAS(MAIN, 1)'
        expect(extractAutomationCustomContent(input)).toBe('ALIAS(MAIN, 1)')
    })

    it('strips both bare managed includes when present together', () => {
        const input = [
            '#include "myRoster.h"',
            '#include "myTurnouts.h"',
            'SEQUENCE(200)',
            'DONE',
        ].join('\n')
        expect(extractAutomationCustomContent(input)).toBe('SEQUENCE(200)\nDONE')
    })

    it('preserves custom code that contains no managed includes', () => {
        const custom = 'SEQUENCE(100)\n  FWD(50)\nDONE\n\nALIAS(LOCO, 3)'
        expect(extractAutomationCustomContent(custom)).toBe(custom)
    })

    it('leaves other #include lines untouched', () => {
        const input = '#include "myRoster.h"\n#include "mySignals.h"\nSEQUENCE(1)\nDONE'
        const result = extractAutomationCustomContent(input)
        expect(result).toContain('#include "mySignals.h"')
        expect(result).not.toContain('#include "myRoster.h"')
    })

    it('round-trips: extract from a fully generated preview returns the original custom content', () => {
        const custom = 'SEQUENCE(100)\n  FWD(50) DELAY(2000) STOP\nDONE'
        // Build what automationPreview would emit
        const preview = [
            MANAGED_INCLUDES_TAG,
            '// These #includes are managed by EX-Installer.',
            '// Do not remove them — they are required for the installer to function correctly.',
            '#include "myRoster.h"',
            '#include "myTurnouts.h"',
            MANAGED_INCLUDES_TAG,
            '',
            custom,
        ].join('\n')
        expect(extractAutomationCustomContent(preview)).toBe(custom)
    })

    it('round-trips cleanly when there is no custom content', () => {
        const preview = [
            MANAGED_INCLUDES_TAG,
            '#include "myRoster.h"',
            MANAGED_INCLUDES_TAG,
        ].join('\n')
        expect(extractAutomationCustomContent(preview)).toBe('')
    })

    it('is idempotent: extracting twice gives the same result', () => {
        const custom = 'ALIAS(PLATFORM1, 10)'
        const first = extractAutomationCustomContent(
            `${MANAGED_INCLUDES_TAG}\n#include "myRoster.h"\n${MANAGED_INCLUDES_TAG}\n${custom}`
        )
        const second = extractAutomationCustomContent(first)
        expect(first).toBe(second)
    })

    // ── MANAGED_TRACK_MANAGER_TAG stripping ───────────────────────────────────

    it('strips the managed TrackManager block entirely', () => {
        const block = [
            MANAGED_TRACK_MANAGER_TAG,
            '// This TrackManager block is managed by EX-Installer.',
            'AUTOSTART',
            '  SET_TRACK(A,MAIN)',
            'DONE',
            MANAGED_TRACK_MANAGER_TAG,
        ].join('\n')
        expect(extractAutomationCustomContent(block)).toBe('')
    })

    it('preserves custom code outside the managed TrackManager block', () => {
        const custom = 'SEQUENCE(99)\n  FWD(50)\nDONE'
        const block = [
            MANAGED_TRACK_MANAGER_TAG,
            'AUTOSTART',
            '  SET_TRACK(A,MAIN)',
            'DONE',
            MANAGED_TRACK_MANAGER_TAG,
            '',
            custom,
        ].join('\n')
        expect(extractAutomationCustomContent(block)).toBe(custom)
    })

    it('strips both includes and TrackManager blocks, preserving only custom code', () => {
        const custom = 'SEQUENCE(100)\nDONE'
        const block = [
            MANAGED_INCLUDES_TAG,
            '#include "myRoster.h"',
            MANAGED_INCLUDES_TAG,
            '',
            MANAGED_TRACK_MANAGER_TAG,
            'AUTOSTART',
            '  SET_TRACK(A,MAIN)',
            'DONE',
            MANAGED_TRACK_MANAGER_TAG,
            '',
            custom,
        ].join('\n')
        expect(extractAutomationCustomContent(block)).toBe(custom)
    })

    it('is idempotent with TrackManager block: extracting twice gives same result', () => {
        const custom = 'ALIAS(TRACK_A, 1)'
        const first = extractAutomationCustomContent(
            `${MANAGED_TRACK_MANAGER_TAG}\nAUTOSTART\n  SET_TRACK(A,MAIN)\nDONE\n${MANAGED_TRACK_MANAGER_TAG}\n${custom}`
        )
        const second = extractAutomationCustomContent(first)
        expect(first).toBe(second)
    })

    it('strips managed turnout-defaults AUTOSTART block while preserving custom code', () => {
        const custom = 'SEQUENCE(100)\nDONE'
        const input = [
            MANAGED_TURNOUT_DEFAULTS_TAG,
            '// This turnout-defaults block is managed by EX-Installer.',
            'AUTOSTART',
            '  THROW(200)',
            'DONE',
            MANAGED_TURNOUT_DEFAULTS_TAG,
            '',
            custom,
        ].join('\n')

        expect(extractAutomationCustomContent(input)).toBe(custom)
    })

    // ── Legacy AUTOSTART block stripping (migration) ──────────────────────────

    it('strips legacy AUTOSTART block containing SET_TRACK', () => {
        const input = 'AUTOSTART\n  SET_TRACK(A,MAIN)\n  SET_TRACK(B,PROG)\nDONE\n'
        expect(extractAutomationCustomContent(input)).toBe('')
    })

    it('strips legacy AUTOSTART block containing POWERON', () => {
        const input = 'AUTOSTART\n  SET_TRACK(A,MAIN)\n  POWERON\nDONE\n'
        expect(extractAutomationCustomContent(input)).toBe('')
    })

    it('strips legacy AUTOSTART block containing SET_POWER', () => {
        const input = 'AUTOSTART\n  SET_POWER(A,ON)\n  SET_POWER(B,OFF)\nDONE\n'
        expect(extractAutomationCustomContent(input)).toBe('')
    })

    it('preserves user AUTOSTART blocks that have no track commands', () => {
        const input = 'AUTOSTART\n  FWD(50) DELAY(2000) STOP\nDONE'
        expect(extractAutomationCustomContent(input)).toBe(input)
    })

    // ── Legacy DC ROSTER line stripping (migration) ───────────────────────────

    it('strips legacy ROSTER DC TRACK A line', () => {
        const input = 'ROSTER(3,"DC TRACK A","/* /")\nSEQUENCE(1)\nDONE'
        expect(extractAutomationCustomContent(input)).not.toContain('ROSTER(3,"DC TRACK A"')
        expect(extractAutomationCustomContent(input)).toContain('SEQUENCE(1)')
    })

    it('strips legacy ROSTER DC TRACK B, C, D lines', () => {
        const input = [
            'ROSTER(4,"DC TRACK B","/* /")',
            'ROSTER(5,"DC TRACK C","/* /")',
            'ROSTER(6,"DC TRACK D","/* /")',
        ].join('\n')
        expect(extractAutomationCustomContent(input)).toBe('')
    })

    it('does NOT strip non-DC ROSTER lines', () => {
        const input = 'ROSTER(3,"Thomas","LIGHT/HORN")'
        expect(extractAutomationCustomContent(input)).toContain('ROSTER(3,"Thomas","LIGHT/HORN")')
    })
})
