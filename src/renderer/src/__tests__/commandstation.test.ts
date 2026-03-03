import { describe, it, expect } from 'vitest'
import {
    generateCommandStationConfig,
    generateMyAutomation,
    type CommandStationConfigOptions,
    type MyAutomationOptions,
} from '../config/commandstation'

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseOpts(overrides: Partial<CommandStationConfigOptions> = {}): CommandStationConfigOptions {
    return {
        motorDriver: 'STANDARD_MOTOR_SHIELD',
        display: 'NONE',
        enableWifi: false,
        wifiMode: 'ap',
        wifiHostname: 'dccex',
        wifiSsid: '',
        wifiPassword: '',
        wifiChannel: 1,
        trackAMode: 'MAIN',
        trackBMode: 'PROG',
        trackALocoId: 3,
        trackBLocoId: 4,
        enablePowerOnStart: false,
        disableEeprom: false,
        ...overrides,
    }
}

function baseAutoOpts(overrides: Partial<MyAutomationOptions> = {}): MyAutomationOptions {
    return {
        enablePowerOnStart: false,
        trackAMode: 'MAIN',
        trackBMode: 'PROG',
        trackALocoId: 3,
        trackBLocoId: 4,
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

        it('includes #define SCROLLMODE 1', () => {
            const out = generateCommandStationConfig(baseOpts())
            expect(out).toContain('#define SCROLLMODE 1')
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

        it('includes default WIFI_SSID placeholder', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap' }))
            expect(out).toContain('#define WIFI_SSID "Your network name"')
        })

        it('includes WIFI_PASSWORD placeholder when no password given', () => {
            const out = generateCommandStationConfig(baseOpts({ enableWifi: true, wifiMode: 'ap', wifiPassword: '' }))
            expect(out).toContain('#define WIFI_PASSWORD "Your network passwd"')
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
    })

    describe('track manager — non-DC modes', () => {
        it('emits SET_TRACK(A,DC) for DC_A mode', () => {
            const out = generateMyAutomation(baseAutoOpts({ trackAMode: 'DC', trackBMode: 'PROG' }))
            expect(out).toContain('SET_TRACK(A,DC)')
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
