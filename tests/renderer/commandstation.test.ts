import { describe, it, expect } from 'vitest'
import {
    generateCommandStationConfig,
    parseCommandStationConfig,
    generateMyAutomation,
    parseMyAutomationTrackManager,
    type CommandStationConfigOptions,
    type MyAutomationOptions,
} from '../../src/renderer/src/config/commandstation'

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseOpts(overrides: Partial<CommandStationConfigOptions> = {}): CommandStationConfigOptions {
    return {
        motorDriver: 'STANDARD_MOTOR_SHIELD',
        display: 'NONE',
        scrollMode: 1,
        enableWifi: false,
        wifiMode: 'ap',
        wifiHostname: 'dccex',
        wifiSsid: '',
        wifiPassword: '',
        wifiChannel: 1,
        hasStackedMotorShield: false,
        trackManagerMode: 'dcc-only',
        trackAMode: 'MAIN',
        trackAType: 'dcc',
        trackALocoId: 3,
        trackBMode: 'PROG',
        trackBType: 'dcc',
        trackBLocoId: 4,
        trackCMode: 'MAIN',
        trackCType: 'dcc',
        trackCLocoId: 0,
        trackDMode: 'MAIN',
        trackDType: 'dcc',
        trackDLocoId: 0,
        startupPowerMode: 'all',
        trackAPower: 'ON',
        trackBPower: 'ON',
        trackCPower: 'ON',
        trackDPower: 'ON',
        enablePowerOnStart: false,
        disableEeprom: false,
        enableEthernet: false,
        disableProg: false,
        ...overrides,
    }
}

function baseAutoOpts(overrides: Partial<MyAutomationOptions> = {}): MyAutomationOptions {
    return {
        enablePowerOnStart: false,
        hasStackedMotorShield: false,
        trackAMode: 'MAIN',
        trackALocoId: 3,
        startupPowerMode: 'all',
        trackAPower: 'ON',
        trackBMode: 'PROG',
        trackBLocoId: 4,
        trackBPower: 'ON',
        trackCMode: 'MAIN',
        trackCLocoId: 0,
        trackCPower: 'ON',
        trackDMode: 'MAIN',
        trackDLocoId: 0,
        trackDPower: 'ON',
        ...overrides,
    }
}

// ── generateCommandStationConfig ─────────────────────────────────────────────

describe('generateCommandStationConfig', () => {
    describe('always-present defines (required for compilation)', () => {
        it('includes #define IP_PORT 2560', () => {
            const out = generateCommandStationConfig(baseOpts())
            expect(out).toContain('#define IP_PORT 2560')
        })

        it('omits SCROLLMODE when no display selected', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'NONE' }))
            expect(out).not.toContain('#define SCROLLMODE')
        })

        it('includes SCROLLMODE when display is selected', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'OLED_128x32', scrollMode: 1 }))
            expect(out).toContain('#define SCROLLMODE 1')
        })

        it('uses configured scrollMode value', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'LCD_16x2', scrollMode: 2 }))
            expect(out).toContain('#define SCROLLMODE 2')
        })

        it('includes correct MOTOR_SHIELD_TYPE', () => {
            const out = generateCommandStationConfig(baseOpts({ motorDriver: 'POLOLU_MOTOR_SHIELD' }))
            expect(out).toContain('#define MOTOR_SHIELD_TYPE POLOLU_MOTOR_SHIELD')
        })
    })

    describe('display options', () => {
        it('omits display define when NONE', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'NONE' }))
            expect(out).not.toContain('#define OLED_DRIVER')
            expect(out).not.toContain('#define LCD_DRIVER')
        })

        it('OLED_128x32 → OLED_DRIVER 128,32', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'OLED_128x32' }))
            expect(out).toContain('#define OLED_DRIVER 128,32')
        })

        it('OLED_128x64 → OLED_DRIVER 128,64', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'OLED_128x64' }))
            expect(out).toContain('#define OLED_DRIVER 128,64')
        })

        it('OLED_132x64 → OLED_DRIVER 132,64 (SH1106 / EX-CSB1 default)', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'OLED_132x64' }))
            expect(out).toContain('#define OLED_DRIVER 132,64')
        })

        it('LCD_16x2 → LCD_DRIVER 0x27,16,2', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'LCD_16x2' }))
            expect(out).toContain('#define LCD_DRIVER 0x27,16,2')
        })

        it('LCD_20x4 → LCD_DRIVER 0x27,20,4', () => {
            const out = generateCommandStationConfig(baseOpts({ display: 'LCD_20x4' }))
            expect(out).toContain('#define LCD_DRIVER 0x27,20,4')
        })
    })

    describe('WiFi disabled', () => {
        it('omits all WiFi defines', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: false }))
            expect(out).not.toContain('#define WIFI_HOSTNAME')
            expect(out).not.toContain('#define ENABLE_WIFI')
            expect(out).not.toContain('#define WIFI_SSID')
            expect(out).not.toContain('#define WIFI_PASSWORD')
            expect(out).not.toContain('#define WIFI_CHANNEL')
        })
    })

    describe('WiFi enabled — AP mode (required for ESP32 compilation)', () => {
        it('includes WIFI_HOSTNAME (was missing — caused compile error)', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap' }))
            expect(out).toContain('#define WIFI_HOSTNAME "dccex"')
        })

        it('uses custom hostname when provided', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap', wifiHostname: 'mystation' }))
            expect(out).toContain('#define WIFI_HOSTNAME "mystation"')
        })

        it('falls back to "dccex" when hostname is empty', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap', wifiHostname: '' }))
            expect(out).toContain('#define WIFI_HOSTNAME "dccex"')
        })

        it('omits WIFI_SSID when no ssid given in AP mode', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap' }))
            expect(out).not.toContain('#define WIFI_SSID')
        })

        it('includes WIFI_FORCE_AP true in AP mode', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap' }))
            expect(out).toContain('#define WIFI_FORCE_AP true')
        })

        it('omits WIFI_PASSWORD when no password given in AP mode', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap', wifiPassword: '' }))
            expect(out).not.toContain('#define WIFI_PASSWORD')
        })

        it('includes custom WIFI_PASSWORD when provided', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap', wifiPassword: 'secret123' }))
            expect(out).toContain('#define WIFI_PASSWORD "secret123"')
        })

        it('includes ENABLE_WIFI true', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap' }))
            expect(out).toContain('#define ENABLE_WIFI true')
        })

        it('includes correct WIFI_CHANNEL', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap', wifiChannel: 6 }))
            expect(out).toContain('#define WIFI_CHANNEL 6')
        })
    })

    describe('WiFi enabled — station mode', () => {
        it('includes WIFI_SSID when provided', () => {
            const out = generateCommandStationConfig(baseOpts({
                enableWifi: true, wifiMode: 'sta', wifiSsid: 'HomeNet', wifiPassword: 'pass',
            }))
            expect(out).toContain('#define WIFI_SSID "HomeNet"')
        })

        it('includes WIFI_PASSWORD when provided', () => {
            const out = generateCommandStationConfig(baseOpts({
                enableWifi: true, wifiMode: 'sta', wifiSsid: 'HomeNet', wifiPassword: 'securepass',
            }))
            expect(out).toContain('#define WIFI_PASSWORD "securepass"')
        })

        it('omits WIFI_SSID when not provided in sta mode', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'sta', wifiSsid: '' }))
            expect(out).not.toContain('#define WIFI_SSID')
        })
    })

    describe('EEPROM', () => {
        it('includes DISABLE_EEPROM when set', () => {
            const out = generateCommandStationConfig(baseOpts({ disableEeprom: true }))
            expect(out).toContain('#define DISABLE_EEPROM')
        })

        it('omits DISABLE_EEPROM when not set', () => {
            const out = generateCommandStationConfig(baseOpts({ disableEeprom: false }))
            expect(out).not.toContain('#define DISABLE_EEPROM')
        })
    })

    describe('ordering — IP_PORT and SCROLLMODE before motor driver', () => {
        it('IP_PORT appears before MOTOR_SHIELD_TYPE', () => {
            const out = generateCommandStationConfig(baseOpts())
            expect(out.indexOf('#define IP_PORT')).toBeLessThan(out.indexOf('#define MOTOR_SHIELD_TYPE'))
        })
    })
})

// ── parseCommandStationConfig — round-trip tests ──────────────────────────────

describe('parseCommandStationConfig', () => {
    function roundTrip(overrides: Partial<CommandStationConfigOptions>) {
        const original = baseOpts(overrides)
        const generated = generateCommandStationConfig(original)
        return parseCommandStationConfig(generated)
    }

    describe('display', () => {
        it('round-trips NONE display', () => {
            expect(roundTrip({ display: 'NONE' }).display).toBe('NONE')
        })

        it('round-trips OLED_128x32', () => {
            expect(roundTrip({ display: 'OLED_128x32' }).display).toBe('OLED_128x32')
        })

        it('round-trips OLED_128x64', () => {
            expect(roundTrip({ display: 'OLED_128x64' }).display).toBe('OLED_128x64')
        })

        it('round-trips OLED_132x64', () => {
            expect(roundTrip({ display: 'OLED_132x64' }).display).toBe('OLED_132x64')
        })

        it('round-trips LCD_16x2', () => {
            expect(roundTrip({ display: 'LCD_16x2' }).display).toBe('LCD_16x2')
        })

        it('round-trips LCD_20x4', () => {
            expect(roundTrip({ display: 'LCD_20x4' }).display).toBe('LCD_20x4')
        })

        it('round-trips scrollMode 0', () => {
            expect(roundTrip({ display: 'OLED_128x32', scrollMode: 0 }).scrollMode).toBe(0)
        })

        it('round-trips scrollMode 2', () => {
            expect(roundTrip({ display: 'OLED_128x32', scrollMode: 2 }).scrollMode).toBe(2)
        })
    })

    describe('WiFi', () => {
        it('round-trips AP mode (WIFI_FORCE_AP)', () => {
            const parsed = roundTrip({ enableWifi: true, wifiMode: 'ap' })
            expect(parsed.enableWifi).toBe(true)
            expect(parsed.wifiMode).toBe('ap')
        })

        it('round-trips station mode with SSID', () => {
            const parsed = roundTrip({ enableWifi: true, wifiMode: 'sta', wifiSsid: 'HomeNet', wifiPassword: 'secret' })
            expect(parsed.wifiMode).toBe('sta')
            expect(parsed.wifiSsid).toBe('HomeNet')
            expect(parsed.wifiPassword).toBe('secret')
        })

        it('round-trips AP mode with custom SSID', () => {
            const parsed = roundTrip({ enableWifi: true, wifiMode: 'ap', wifiSsid: 'MyAP', wifiChannel: 6 })
            expect(parsed.wifiMode).toBe('ap')
            expect(parsed.wifiSsid).toBe('MyAP')
            expect(parsed.wifiChannel).toBe(6)
        })
    })

    describe('motor driver', () => {
        it('round-trips custom motor driver', () => {
            expect(roundTrip({ motorDriver: 'EX8874' }).motorDriver).toBe('EX8874')
        })

        it('marks stacked shield when MOTOR_SHIELD_TYPE is EXCSB1_WITH_EX8874', () => {
            const parsed = roundTrip({ motorDriver: 'EXCSB1_WITH_EX8874', hasStackedMotorShield: false })
            expect(parsed.motorDriver).toBe('EXCSB1_WITH_EX8874')
            expect(parsed.hasStackedMotorShield).toBe(true)
        })
    })
})

// ── generateMyAutomation ──────────────────────────────────────────────────────

describe('generateMyAutomation', () => {
    describe('default config (MAIN/PROG, no power-on)', () => {
        it('produces no AUTOSTART when nothing is enabled', () => {
            const out = generateMyAutomation(baseAutoOpts())
            expect(out).not.toContain('AUTOSTART')
        })

        it('produces no POWERON', () => {
            const out = generateMyAutomation(baseAutoOpts())
            expect(out).not.toContain('POWERON')
        })

        it('produces no SET_TRACK', () => {
            const out = generateMyAutomation(baseAutoOpts())
            expect(out).not.toContain('SET_TRACK')
        })
    })

    describe('power-on start', () => {
        it('includes AUTOSTART', () => {
            const out = generateMyAutomation(baseAutoOpts({ enablePowerOnStart: true }))
            expect(out).toContain('AUTOSTART')
        })

        it('includes POWERON', () => {
            const out = generateMyAutomation(baseAutoOpts({ enablePowerOnStart: true }))
            expect(out).toContain('POWERON')
        })

        it('includes DONE', () => {
            const out = generateMyAutomation(baseAutoOpts({ enablePowerOnStart: true }))
            expect(out).toContain('DONE')
        })

        it('uses POWERON when startupPowerMode is all', () => {
            const out = generateMyAutomation(baseAutoOpts({
                enablePowerOnStart: true,
                startupPowerMode: 'all',
            }))
            expect(out).toContain('POWERON')
            expect(out).not.toContain('SET_POWER(')
            expect(out.indexOf('SET_TRACK(B,PROG)')).toBeLessThan(out.indexOf('POWERON'))
        })

        it('uses SET_POWER per track when startupPowerMode is individual', () => {
            const out = generateMyAutomation(baseAutoOpts({
                enablePowerOnStart: true,
                startupPowerMode: 'individual',
                trackAPower: 'ON',
                trackBPower: 'OFF',
            }))
            expect(out).toContain('SET_POWER(A,ON)')
            expect(out).toContain('SET_POWER(B,OFF)')
            expect(out).not.toContain('POWERON')
            expect(out.indexOf('SET_TRACK(B,PROG)')).toBeLessThan(out.indexOf('SET_POWER(A,ON)'))
        })

        it('includes SET_POWER for C/D when stacked shield is enabled', () => {
            const out = generateMyAutomation(baseAutoOpts({
                enablePowerOnStart: true,
                startupPowerMode: 'individual',
                hasStackedMotorShield: true,
                trackCPower: 'OFF',
                trackDPower: 'ON',
            }))
            expect(out).toContain('SET_POWER(C,OFF)')
            expect(out).toContain('SET_POWER(D,ON)')
        })

        it('does not include POWERON when using individual power mode', () => {
            const out = generateMyAutomation(baseAutoOpts({
                enablePowerOnStart: true,
                startupPowerMode: 'individual',
                trackAPower: 'OFF',
                trackBPower: 'ON',
            }))
            expect(out).toContain('SET_POWER(A,OFF)')
            expect(out).toContain('SET_POWER(B,ON)')
            expect(out).not.toContain('POWERON')
        })
    })

    describe('track manager — non-DC modes', () => {
        it('emits SET_TRACK(A,DC) for DC_A mode', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackAMode: 'DC', trackBMode: 'PROG' }))
            expect(out).toContain('SET_TRACK(A,DC)')
        })

        it('emits SET_TRACK for A/B/C/D when stacked shield is enabled with defaults', () => {
            const out = generateMyAutomation(baseAutoOpts({ hasStackedMotorShield: true }))
            expect(out).toContain('SET_TRACK(A,MAIN)')
            expect(out).toContain('SET_TRACK(B,PROG)')
            expect(out).toContain('SET_TRACK(C,MAIN)')
            expect(out).toContain('SET_TRACK(D,MAIN)')
        })

        it('emits SET_TRACK(B,NONE) for NONE_B mode', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackAMode: 'MAIN', trackBMode: 'NONE' }))
            expect(out).toContain('SET_TRACK(B,NONE)')
        })

        it('includes AUTOSTART for track manager change', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackAMode: 'DC', trackBMode: 'PROG' }))
            expect(out).toContain('AUTOSTART')
        })
    })

    describe('track manager — DC modes (require SETLOCO + ROSTER)', () => {
        it('emits SETLOCO and SET_TRACK for DC track A', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackAMode: 'DC', trackALocoId: 7 }))
            expect(out).toContain('SETLOCO(7) SET_TRACK(A,DC)')
        })

        it('emits SETLOCO and SET_TRACK for DCX track B', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackBMode: 'DCX', trackBLocoId: 12 }))
            expect(out).toContain('SETLOCO(12) SET_TRACK(B,DCX)')
        })

        it('adds ROSTER entry for DC track A', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackAMode: 'DC', trackALocoId: 7 }))
            expect(out).toContain('ROSTER(7,"DC TRACK A","/* /")')
        })

        it('adds ROSTER entry for DC track B', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackBMode: 'DCX', trackBLocoId: 12 }))
            expect(out).toContain('ROSTER(12,"DC TRACK B","/* /")')
        })

        it('does not add ROSTER for non-DC track', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackAMode: 'MAIN', trackBMode: 'PROG' }))
            expect(out).not.toContain('ROSTER')
        })
    })
})

// ── parseMyAutomationTrackManager ─────────────────────────────────────────────

describe('parseMyAutomationTrackManager', () => {
    describe('empty / missing AUTOSTART', () => {
        it('returns empty object for empty string', () => {
            expect(parseMyAutomationTrackManager('')).toEqual({})
        })

        it('returns empty object when no AUTOSTART block found', () => {
            expect(parseMyAutomationTrackManager('// just a comment\n')).toEqual({})
        })
    })

    describe('SET_TRACK parsing', () => {
        it('parses trackAMode from SET_TRACK(A,...)', () => {
            const content = 'AUTOSTART\n  SET_TRACK(A,MAIN)\nDONE'
            expect(parseMyAutomationTrackManager(content).trackAMode).toBe('MAIN')
        })

        it('parses trackBMode from SET_TRACK(B,...)', () => {
            const content = 'AUTOSTART\n  SET_TRACK(B,PROG)\nDONE'
            expect(parseMyAutomationTrackManager(content).trackBMode).toBe('PROG')
        })

        it('parses trackCMode from SET_TRACK(C,...)', () => {
            const content = 'AUTOSTART\n  SET_TRACK(C,MAIN)\nDONE'
            expect(parseMyAutomationTrackManager(content).trackCMode).toBe('MAIN')
        })

        it('parses trackDMode from SET_TRACK(D,...)', () => {
            const content = 'AUTOSTART\n  SET_TRACK(D,NONE)\nDONE'
            expect(parseMyAutomationTrackManager(content).trackDMode).toBe('NONE')
        })

        it('parses all four tracks when all present', () => {
            const content = 'AUTOSTART\n  SET_TRACK(A,MAIN)\n  SET_TRACK(B,PROG)\n  SET_TRACK(C,MAIN)\n  SET_TRACK(D,MAIN)\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.trackAMode).toBe('MAIN')
            expect(opts.trackBMode).toBe('PROG')
            expect(opts.trackCMode).toBe('MAIN')
            expect(opts.trackDMode).toBe('MAIN')
        })
    })

    describe('SETLOCO parsing', () => {
        it('parses trackALocoId from SETLOCO before SET_TRACK(A,...)', () => {
            const content = 'AUTOSTART\n  SETLOCO(7) SET_TRACK(A,DC)\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.trackALocoId).toBe(7)
            expect(opts.trackAMode).toBe('DC')
        })

        it('parses trackBLocoId from SETLOCO before SET_TRACK(B,...)', () => {
            const content = 'AUTOSTART\n  SETLOCO(12) SET_TRACK(B,DCX)\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.trackBLocoId).toBe(12)
        })
    })

    describe('stacked motor shield detection', () => {
        it('sets hasStackedMotorShield true when track C is present', () => {
            const content = 'AUTOSTART\n  SET_TRACK(A,MAIN)\n  SET_TRACK(C,MAIN)\nDONE'
            expect(parseMyAutomationTrackManager(content).hasStackedMotorShield).toBe(true)
        })

        it('sets hasStackedMotorShield true when track D is present', () => {
            const content = 'AUTOSTART\n  SET_TRACK(D,MAIN)\nDONE'
            expect(parseMyAutomationTrackManager(content).hasStackedMotorShield).toBe(true)
        })

        it('does NOT set hasStackedMotorShield when only A and B present', () => {
            const content = 'AUTOSTART\n  SET_TRACK(A,MAIN)\n  SET_TRACK(B,PROG)\nDONE'
            expect(parseMyAutomationTrackManager(content).hasStackedMotorShield).toBeUndefined()
        })
    })

    describe('POWERON parsing', () => {
        it('sets enablePowerOnStart and startupPowerMode all when POWERON found', () => {
            const content = 'AUTOSTART\n  SET_TRACK(A,MAIN)\n  POWERON\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.enablePowerOnStart).toBe(true)
            expect(opts.startupPowerMode).toBe('all')
        })

        it('does NOT set enablePowerOnStart when no power command', () => {
            const content = 'AUTOSTART\n  SET_TRACK(A,MAIN)\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.enablePowerOnStart).toBeUndefined()
        })
    })

    describe('SET_POWER parsing', () => {
        it('sets startupPowerMode individual and trackAPower when SET_POWER(A,...) present', () => {
            const content = 'AUTOSTART\n  SET_TRACK(A,MAIN)\n  SET_POWER(A,ON)\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.startupPowerMode).toBe('individual')
            expect(opts.trackAPower).toBe('ON')
            expect(opts.enablePowerOnStart).toBe(true)
        })

        it('parses trackBPower OFF from SET_POWER(B,OFF)', () => {
            const content = 'AUTOSTART\n  SET_POWER(A,ON)\n  SET_POWER(B,OFF)\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.trackBPower).toBe('OFF')
        })

        it('parses SET_POWER for C and D tracks', () => {
            const content = 'AUTOSTART\n  SET_POWER(C,OFF)\n  SET_POWER(D,ON)\nDONE'
            const opts = parseMyAutomationTrackManager(content)
            expect(opts.trackCPower).toBe('OFF')
            expect(opts.trackDPower).toBe('ON')
        })

        it('does NOT set POWERON mode when using individual SET_POWER', () => {
            const content = 'AUTOSTART\n  SET_POWER(A,ON)\n  SET_POWER(B,ON)\nDONE'
            expect(parseMyAutomationTrackManager(content).startupPowerMode).toBe('individual')
        })
    })

    describe('round-trip: generateMyAutomation → parseMyAutomationTrackManager', () => {
        it('round-trips POWERON (all mode)', () => {
            const opts = baseAutoOpts({ enablePowerOnStart: true, startupPowerMode: 'all' })
            const content = generateMyAutomation(opts)
            const parsed = parseMyAutomationTrackManager(content)
            expect(parsed.enablePowerOnStart).toBe(true)
            expect(parsed.startupPowerMode).toBe('all')
        })

        it('round-trips individual SET_POWER with mixed ON/OFF', () => {
            const opts = baseAutoOpts({
                enablePowerOnStart: true,
                startupPowerMode: 'individual',
                trackAPower: 'ON',
                trackBPower: 'OFF',
            })
            const content = generateMyAutomation(opts)
            const parsed = parseMyAutomationTrackManager(content)
            expect(parsed.startupPowerMode).toBe('individual')
            expect(parsed.trackAPower).toBe('ON')
            expect(parsed.trackBPower).toBe('OFF')
        })

        it('round-trips stacked shield with all four SET_TRACK modes', () => {
            const opts = baseAutoOpts({
                hasStackedMotorShield: true,
                trackAMode: 'MAIN',
                trackBMode: 'PROG',
                trackCMode: 'MAIN',
                trackDMode: 'NONE',
            })
            const content = generateMyAutomation(opts)
            const parsed = parseMyAutomationTrackManager(content)
            expect(parsed.hasStackedMotorShield).toBe(true)
            expect(parsed.trackAMode).toBe('MAIN')
            expect(parsed.trackBMode).toBe('PROG')
            expect(parsed.trackCMode).toBe('MAIN')
            expect(parsed.trackDMode).toBe('NONE')
        })

        it('round-trips SET_POWER for C and D when stacked shield enabled', () => {
            const opts = baseAutoOpts({
                enablePowerOnStart: true,
                startupPowerMode: 'individual',
                hasStackedMotorShield: true,
                trackCPower: 'OFF',
                trackDPower: 'ON',
            })
            const content = generateMyAutomation(opts)
            const parsed = parseMyAutomationTrackManager(content)
            expect(parsed.trackCPower).toBe('OFF')
            expect(parsed.trackDPower).toBe('ON')
        })

        it('round-trips DC track with loco ID', () => {
            const opts = baseAutoOpts({ trackAMode: 'DC', trackALocoId: 9 })
            const content = generateMyAutomation(opts)
            const parsed = parseMyAutomationTrackManager(content)
            expect(parsed.trackAMode).toBe('DC')
            expect(parsed.trackALocoId).toBe(9)
        })
    })
})
