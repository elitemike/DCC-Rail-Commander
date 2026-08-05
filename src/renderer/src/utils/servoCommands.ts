/**
 * DCC-EX serial command builders and validation helpers for live servo
 * calibration. Pure/side-effect-free so it's independently unit-testable —
 * see servo-calibration-dialog.ts for the component that uses these.
 */
import type { TurnoutProfile } from './myAutomationParser'

export const SERVO_POSITION_MIN = 0
export const SERVO_POSITION_MAX = 512

/** DCC-EX's documented "typical usable" PWM range — visual markers only, not enforced bounds. */
export const SERVO_POSITION_SAFE_MIN = 102
export const SERVO_POSITION_SAFE_MAX = 490

export const PROFILE_TO_NUMERIC: Record<TurnoutProfile, number> = {
    Instant: 0,
    Fast: 1,
    Medium: 2,
    Slow: 3,
    Bounce: 4,
}

function resolveProfileNumber(profile: TurnoutProfile | number): number {
    return typeof profile === 'number' ? profile : PROFILE_TO_NUMERIC[profile]
}

export function clampServoPosition(value: number): number {
    const rounded = Math.round(value)
    return Math.min(SERVO_POSITION_MAX, Math.max(SERVO_POSITION_MIN, rounded))
}

export function validateServoPosition(value: number): { ok: true } | { ok: false; reason: string } {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return { ok: false, reason: 'Position must be a number.' }
    }
    if (!Number.isInteger(value)) {
        return { ok: false, reason: 'Position must be a whole number.' }
    }
    if (value < SERVO_POSITION_MIN || value > SERVO_POSITION_MAX) {
        return { ok: false, reason: `Position must be between ${SERVO_POSITION_MIN} and ${SERVO_POSITION_MAX}.` }
    }
    return { ok: true }
}

/**
 * `<D SERVO vpin position profile>` — diagnostic live move, used while
 * dragging. Clamps the position before building so a stray out-of-range
 * value never gets sent to a real servo.
 */
export function buildServoDiagnosticCommand(
    vpin: number,
    position: number,
    profile: TurnoutProfile | number = 'Instant',
): string {
    const clamped = clampServoPosition(position)
    return `<D SERVO ${vpin} ${clamped} ${resolveProfileNumber(profile)}>`
}

/**
 * `<T id SERVO vpin activeAngle inactiveAngle profile>` — full turnout
 * (re)definition. Not called by the Save flow in this feature (Save only
 * updates in-app config state) — exported for unit coverage and as a
 * natural extension point for a future "push to device" action.
 */
export function buildDefineServoTurnoutCommand(turnout: {
    id: number
    pin: number
    activeAngle: number
    inactiveAngle: number
    profile: TurnoutProfile
}): string {
    return `<T ${turnout.id} SERVO ${turnout.pin} ${turnout.activeAngle} ${turnout.inactiveAngle} ${resolveProfileNumber(turnout.profile)}>`
}

export interface Debouncer<TArgs extends unknown[]> {
    call: (...args: TArgs) => void
    cancel: () => void
}

/** Cancel-and-restart debounce. Each call resets the timer; only the last call's args fire. */
export function createDebouncer<TArgs extends unknown[]>(fn: (...args: TArgs) => void, ms: number): Debouncer<TArgs> {
    let timer: ReturnType<typeof setTimeout> | null = null
    return {
        call: (...args: TArgs) => {
            if (timer !== null) clearTimeout(timer)
            timer = setTimeout(() => {
                timer = null
                fn(...args)
            }, ms)
        },
        cancel: () => {
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
        },
    }
}
