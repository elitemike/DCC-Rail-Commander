import { describe, it, expect } from 'vitest'
import { generateIOExpanderConfig, type IOExpanderConfigOptions } from '../config/ioexpander'

function baseOpts(overrides: Partial<IOExpanderConfigOptions> = {}): IOExpanderConfigOptions {
    return {
        i2cAddress: 0x65,
        disablePullups: false,
        testMode: null,
        ...overrides,
    }
}

describe('generateIOExpanderConfig', () => {
    describe('always-present defines', () => {
        it('includes correct I2C_ADDRESS in hex', () => {
            const out = generateIOExpanderConfig(baseOpts({ i2cAddress: 0x65 }))
            expect(out).toContain('#define I2C_ADDRESS 0x65')
        })

        it('uppercases hex address', () => {
            const out = generateIOExpanderConfig(baseOpts({ i2cAddress: 0x6A }))
            expect(out).toContain('#define I2C_ADDRESS 0x6A')
        })

        it('includes DIAG_CONFIG_DELAY 5', () => {
            const out = generateIOExpanderConfig(baseOpts())
            expect(out).toContain('#define DIAG_CONFIG_DELAY 5')
        })
    })

    describe('test mode', () => {
        it('omits TEST_MODE when null', () => {
            const out = generateIOExpanderConfig(baseOpts({ testMode: null }))
            expect(out).not.toContain('#define TEST_MODE')
        })

        it('includes TEST_MODE ANALOGUE_TEST', () => {
            const out = generateIOExpanderConfig(baseOpts({ testMode: 'ANALOGUE_TEST' }))
            expect(out).toContain('#define TEST_MODE ANALOGUE_TEST')
        })

        it('includes TEST_MODE INPUT_TEST', () => {
            const out = generateIOExpanderConfig(baseOpts({ testMode: 'INPUT_TEST' }))
            expect(out).toContain('#define TEST_MODE INPUT_TEST')
        })

        it('includes TEST_MODE OUTPUT_TEST', () => {
            const out = generateIOExpanderConfig(baseOpts({ testMode: 'OUTPUT_TEST' }))
            expect(out).toContain('#define TEST_MODE OUTPUT_TEST')
        })

        it('includes TEST_MODE PULLUP_TEST', () => {
            const out = generateIOExpanderConfig(baseOpts({ testMode: 'PULLUP_TEST' }))
            expect(out).toContain('#define TEST_MODE PULLUP_TEST')
        })
    })

    describe('I2C pullups', () => {
        it('includes DISABLE_I2C_PULLUPS when set', () => {
            const out = generateIOExpanderConfig(baseOpts({ disablePullups: true }))
            expect(out).toContain('#define DISABLE_I2C_PULLUPS')
        })

        it('omits DISABLE_I2C_PULLUPS when not set', () => {
            const out = generateIOExpanderConfig(baseOpts({ disablePullups: false }))
            expect(out).not.toContain('#define DISABLE_I2C_PULLUPS')
        })
    })

    describe('output format', () => {
        it('starts with generator comment', () => {
            const out = generateIOExpanderConfig(baseOpts())
            expect(out).toMatch(/^\/\/ myConfig\.h/)
        })

        it('ends with a newline', () => {
            const out = generateIOExpanderConfig(baseOpts())
            expect(out.endsWith('\n')).toBe(true)
        })
    })
})
