import { describe, it, expect } from 'vitest'
import { generateTurntableConfig, type TurntableConfigOptions } from '../config/turntable'

function baseOpts(overrides: Partial<TurntableConfigOptions> = {}): TurntableConfigOptions {
    return {
        i2cAddress: 0x60,
        mode: 'TURNTABLE',
        sensorTesting: false,
        homeSensorActiveState: 'LOW',
        limitSensorActiveState: 'LOW',
        relayActiveState: 'HIGH',
        phaseSwitching: 'AUTO',
        phaseSwitchAngle: 45,
        stepperDriver: 'ULN2003_HALF_CW',
        disableOutputsIdle: false,
        maxSpeed: 200,
        acceleration: 25,
        gearingFactor: 1,
        invertDirection: false,
        invertStep: false,
        invertEnable: false,
        forwardOnly: false,
        reverseOnly: false,
        ledFast: 100,
        ledSlow: 500,
        enableDebug: false,
        sanitySteps: null,
        homeSensitivity: null,
        fullStepCount: null,
        debounceDelay: null,
        ...overrides,
    }
}

describe('generateTurntableConfig', () => {
    describe('always-present defines', () => {
        it('includes correct I2C_ADDRESS in hex', () => {
            const out = generateTurntableConfig(baseOpts({ i2cAddress: 0x60 }))
            expect(out).toContain('#define I2C_ADDRESS 0x60')
        })

        it('uppercases hex address', () => {
            const out = generateTurntableConfig(baseOpts({ i2cAddress: 0x6F }))
            expect(out).toContain('#define I2C_ADDRESS 0x6F')
        })

        it('includes TURNTABLE_EX_MODE TURNTABLE', () => {
            const out = generateTurntableConfig(baseOpts({ mode: 'TURNTABLE' }))
            expect(out).toContain('#define TURNTABLE_EX_MODE TURNTABLE')
        })

        it('includes TURNTABLE_EX_MODE TRAVERSER', () => {
            const out = generateTurntableConfig(baseOpts({ mode: 'TRAVERSER' }))
            expect(out).toContain('#define TURNTABLE_EX_MODE TRAVERSER')
        })

        it('includes HOME_SENSOR_ACTIVE_STATE', () => {
            const out = generateTurntableConfig(baseOpts({ homeSensorActiveState: 'HIGH' }))
            expect(out).toContain('#define HOME_SENSOR_ACTIVE_STATE HIGH')
        })

        it('includes LIMIT_SENSOR_ACTIVE_STATE', () => {
            const out = generateTurntableConfig(baseOpts({ limitSensorActiveState: 'HIGH' }))
            expect(out).toContain('#define LIMIT_SENSOR_ACTIVE_STATE HIGH')
        })

        it('includes RELAY_ACTIVE_STATE', () => {
            const out = generateTurntableConfig(baseOpts({ relayActiveState: 'LOW' }))
            expect(out).toContain('#define RELAY_ACTIVE_STATE LOW')
        })

        it('includes STEPPER_DRIVER', () => {
            const out = generateTurntableConfig(baseOpts({ stepperDriver: 'A4988' }))
            expect(out).toContain('#define STEPPER_DRIVER A4988')
        })

        it('includes STEPPER_MAX_SPEED', () => {
            const out = generateTurntableConfig(baseOpts({ maxSpeed: 400 }))
            expect(out).toContain('#define STEPPER_MAX_SPEED 400')
        })

        it('includes STEPPER_ACCELERATION', () => {
            const out = generateTurntableConfig(baseOpts({ acceleration: 50 }))
            expect(out).toContain('#define STEPPER_ACCELERATION 50')
        })

        it('includes STEPPER_GEARING_FACTOR', () => {
            const out = generateTurntableConfig(baseOpts({ gearingFactor: 2 }))
            expect(out).toContain('#define STEPPER_GEARING_FACTOR 2')
        })

        it('includes LED_FAST', () => {
            const out = generateTurntableConfig(baseOpts({ ledFast: 200 }))
            expect(out).toContain('#define LED_FAST 200')
        })

        it('includes LED_SLOW', () => {
            const out = generateTurntableConfig(baseOpts({ ledSlow: 1000 }))
            expect(out).toContain('#define LED_SLOW 1000')
        })
    })

    describe('sensor testing', () => {
        it('includes SENSOR_TESTING when enabled', () => {
            const out = generateTurntableConfig(baseOpts({ sensorTesting: true }))
            expect(out).toContain('#define SENSOR_TESTING')
        })

        it('comments out SENSOR_TESTING when disabled', () => {
            const out = generateTurntableConfig(baseOpts({ sensorTesting: false }))
            expect(out).toContain('// #define SENSOR_TESTING')
            expect(out).not.toMatch(/^#define SENSOR_TESTING/m)
        })
    })

    describe('phase switching', () => {
        it('AUTO includes PHASE_SWITCH_ANGLE', () => {
            const out = generateTurntableConfig(baseOpts({ phaseSwitching: 'AUTO', phaseSwitchAngle: 90 }))
            expect(out).toContain('#define PHASE_SWITCHING AUTO')
            expect(out).toContain('#define PHASE_SWITCH_ANGLE 90')
        })

        it('MANUAL omits PHASE_SWITCH_ANGLE', () => {
            const out = generateTurntableConfig(baseOpts({ phaseSwitching: 'MANUAL' }))
            expect(out).toContain('#define PHASE_SWITCHING MANUAL')
            expect(out).not.toContain('#define PHASE_SWITCH_ANGLE')
        })
    })

    describe('output idle', () => {
        it('includes DISABLE_OUTPUTS_IDLE when set', () => {
            const out = generateTurntableConfig(baseOpts({ disableOutputsIdle: true }))
            expect(out).toContain('#define DISABLE_OUTPUTS_IDLE')
        })

        it('omits DISABLE_OUTPUTS_IDLE when not set', () => {
            const out = generateTurntableConfig(baseOpts({ disableOutputsIdle: false }))
            expect(out).not.toContain('#define DISABLE_OUTPUTS_IDLE')
        })
    })

    describe('invert options', () => {
        it('includes INVERT_DIRECTION when set', () => {
            const out = generateTurntableConfig(baseOpts({ invertDirection: true }))
            expect(out).toContain('#define INVERT_DIRECTION')
        })

        it('comments out INVERT_DIRECTION when not set', () => {
            const out = generateTurntableConfig(baseOpts({ invertDirection: false }))
            expect(out).toContain('// #define INVERT_DIRECTION')
        })

        it('includes INVERT_STEP when set', () => {
            const out = generateTurntableConfig(baseOpts({ invertStep: true }))
            expect(out).toContain('#define INVERT_STEP')
        })

        it('includes INVERT_ENABLE when set', () => {
            const out = generateTurntableConfig(baseOpts({ invertEnable: true }))
            expect(out).toContain('#define INVERT_ENABLE')
        })
    })

    describe('rotation direction', () => {
        it('includes ROTATE_FORWARD_ONLY when set', () => {
            const out = generateTurntableConfig(baseOpts({ forwardOnly: true }))
            expect(out).toContain('#define ROTATE_FORWARD_ONLY')
        })

        it('includes ROTATE_REVERSE_ONLY when set', () => {
            const out = generateTurntableConfig(baseOpts({ reverseOnly: true }))
            expect(out).toContain('#define ROTATE_REVERSE_ONLY')
        })

        it('comments out ROTATE_FORWARD_ONLY when not set', () => {
            const out = generateTurntableConfig(baseOpts({ forwardOnly: false }))
            expect(out).toContain('// #define ROTATE_FORWARD_ONLY')
        })
    })

    describe('debug', () => {
        it('includes DEBUG when enabled', () => {
            const out = generateTurntableConfig(baseOpts({ enableDebug: true }))
            expect(out).toContain('#define DEBUG')
        })

        it('comments out DEBUG when disabled', () => {
            const out = generateTurntableConfig(baseOpts({ enableDebug: false }))
            expect(out).toContain('// #define DEBUG')
        })
    })

    describe('optional advanced values', () => {
        it('includes SANITY_STEPS when provided', () => {
            const out = generateTurntableConfig(baseOpts({ sanitySteps: 10000 }))
            expect(out).toContain('#define SANITY_STEPS 10000')
        })

        it('comments out SANITY_STEPS when null', () => {
            const out = generateTurntableConfig(baseOpts({ sanitySteps: null }))
            expect(out).toContain('// #define SANITY_STEPS 10000')
        })

        it('includes HOME_SENSITIVITY when provided', () => {
            const out = generateTurntableConfig(baseOpts({ homeSensitivity: 150 }))
            expect(out).toContain('#define HOME_SENSITIVITY 150')
        })

        it('comments out HOME_SENSITIVITY when null', () => {
            const out = generateTurntableConfig(baseOpts({ homeSensitivity: null }))
            expect(out).toContain('// #define HOME_SENSITIVITY 300')
        })

        it('includes FULL_STEP_COUNT when provided', () => {
            const out = generateTurntableConfig(baseOpts({ fullStepCount: 2048 }))
            expect(out).toContain('#define FULL_STEP_COUNT 2048')
        })

        it('comments out FULL_STEP_COUNT when null', () => {
            const out = generateTurntableConfig(baseOpts({ fullStepCount: null }))
            expect(out).toContain('// #define FULL_STEP_COUNT 4096')
        })

        it('includes DEBOUNCE_DELAY when provided', () => {
            const out = generateTurntableConfig(baseOpts({ debounceDelay: 20 }))
            expect(out).toContain('#define DEBOUNCE_DELAY 20')
        })

        it('comments out DEBOUNCE_DELAY when null', () => {
            const out = generateTurntableConfig(baseOpts({ debounceDelay: null }))
            expect(out).toContain('// #define DEBOUNCE_DELAY 10')
        })
    })

    describe('output format', () => {
        it('starts with generator comment', () => {
            const out = generateTurntableConfig(baseOpts())
            expect(out).toMatch(/^\/\/ config\.h/)
        })

        it('ends with a newline', () => {
            const out = generateTurntableConfig(baseOpts())
            expect(out.endsWith('\n')).toBe(true)
        })
    })
})
