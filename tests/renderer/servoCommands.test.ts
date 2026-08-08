import { describe, it, expect } from 'vitest'
import {
    clampServoPosition,
    validateServoPosition,
    buildServoDiagnosticCommand,
    buildDefineServoTurnoutCommand,
    PROFILE_TO_NUMERIC,
} from '../../src/renderer/src/utils/servoCommands'
import type { ServoTurnout } from '../../src/renderer/src/utils/myAutomationParser'

// ── clampServoPosition ───────────────────────────────────────────────────────

describe('clampServoPosition', () => {
    it('passes through an in-range integer unchanged', () => {
        expect(clampServoPosition(300)).toBe(300)
    })

    it('clamps below-range values to 0', () => {
        expect(clampServoPosition(-50)).toBe(0)
    })

    it('clamps above-range values to 512', () => {
        expect(clampServoPosition(999)).toBe(512)
    })

    it('rounds non-integer input', () => {
        expect(clampServoPosition(300.6)).toBe(301)
        expect(clampServoPosition(300.4)).toBe(300)
    })
})

// ── validateServoPosition ────────────────────────────────────────────────────

describe('validateServoPosition', () => {
    it('accepts a valid in-range integer', () => {
        expect(validateServoPosition(205)).toEqual({ ok: true })
    })

    it('accepts the boundary values', () => {
        expect(validateServoPosition(0)).toEqual({ ok: true })
        expect(validateServoPosition(512)).toEqual({ ok: true })
    })

    it('rejects NaN', () => {
        const result = validateServoPosition(NaN)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/number/i)
    })

    it('rejects negative values', () => {
        const result = validateServoPosition(-1)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/between/i)
    })

    it('rejects values above 512', () => {
        const result = validateServoPosition(513)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/between/i)
    })

    it('rejects non-integer values', () => {
        const result = validateServoPosition(300.5)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/whole number/i)
    })
})

// ── buildServoDiagnosticCommand ──────────────────────────────────────────────

describe('buildServoDiagnosticCommand', () => {
    it('builds the exact <D SERVO vpin position profile> shape', () => {
        expect(buildServoDiagnosticCommand(25, 300, 'Instant')).toBe('<D SERVO 25 300 0>')
    })

    it('defaults to profile Instant (0) when none is given', () => {
        expect(buildServoDiagnosticCommand(25, 300)).toBe('<D SERVO 25 300 0>')
    })

    it.each(Object.entries(PROFILE_TO_NUMERIC))('maps profile %s to numeric %i', (name, numeric) => {
        expect(buildServoDiagnosticCommand(1, 100, name as keyof typeof PROFILE_TO_NUMERIC)).toBe(
            `<D SERVO 1 100 ${numeric}>`,
        )
    })

    it('clamps an out-of-range position before building the string', () => {
        expect(buildServoDiagnosticCommand(25, 9999, 'Instant')).toBe('<D SERVO 25 512 0>')
        expect(buildServoDiagnosticCommand(25, -20, 'Instant')).toBe('<D SERVO 25 0 0>')
    })
})

// ── buildDefineServoTurnoutCommand ───────────────────────────────────────────

describe('buildDefineServoTurnoutCommand', () => {
    it('builds the exact <T id SERVO vpin activeAngle inactiveAngle profile> shape', () => {
        const turnout: ServoTurnout = {
            type: 'SERVO',
            id: 24,
            pin: 100,
            activeAngle: 410,
            inactiveAngle: 205,
            profile: 'Medium',
            description: 'Test',
            defaultState: 'CLOSED',
        }
        expect(buildDefineServoTurnoutCommand(turnout)).toBe('<T 24 SERVO 100 410 205 2>')
    })
})
