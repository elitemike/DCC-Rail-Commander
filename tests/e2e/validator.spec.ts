/**
 * E2E tests: DCC-EX macro validators — inline squiggle diagnostics.
 *
 * Tests that the Monaco editor shows red squiggle decorations (`.squiggly-error`)
 * and yellow warning squiggles (`.squiggly-warning`) for invalid / out-of-range
 * arguments in ROSTER() and SERVO_TURNOUT() macro calls.
 *
 * Prerequisites: build the app with `pnpm build` before running.
 * Run: pnpm test:e2e --grep "Validators"
 */

import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openRawRoster(page: Page) {
    await page.getByText('Roster', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
}

async function openRawTurnouts(page: Page) {
    await page.getByText('Turnouts', { exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Visual' })).toBeVisible()
    await page.getByRole('button', { name: 'Raw' }).click()
    await expect(page.locator('div.monaco-editor')).toBeVisible()
}

/**
 * Replace the Monaco editor content and wait for the debounce + validator
 * decoration pipeline to settle.
 */
async function setMonacoContent(page: Page, text: string) {
    const editor = page.locator('div.monaco-editor').first()
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        await page.keyboard.type(lines[i])
        if (i < lines.length - 1) await page.keyboard.press('Enter')
    }
    // Wait for Monaco debounce (300ms) + validator re-render
    await page.waitForTimeout(600)
}

/** Wait for error squiggles to appear in the Monaco view. */
async function expectErrorSquiggle(page: Page) {
    await expect(page.locator('.squiggly-error').first()).toBeVisible({ timeout: 4_000 })
}

/** Wait for warning squiggles to appear in the Monaco view. */
async function expectWarningSquiggle(page: Page) {
    await expect(page.locator('.squiggly-warning').first()).toBeVisible({ timeout: 4_000 })
}

/** Assert no error squiggles are visible. */
async function expectNoErrorSquiggle(page: Page) {
    await expect(page.locator('.squiggly-error')).toHaveCount(0)
}

// ── ROSTER validator tests ────────────────────────────────────────────────────

test.describe('Validators', () => {
    test.describe('ROSTER', () => {
        test('valid entry — no squiggles', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            await setMonacoContent(page, 'ROSTER(42, "Valid Loco", "LIGHT/HORN")')
            await expectNoErrorSquiggle(page)
        })

        test('non-integer DCC address — error squiggle on the bad token', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            await setMonacoContent(page, 'ROSTER(notAnInt, "Loco", "LIGHT")')
            await expectErrorSquiggle(page)
        })

        test('DCC address out of range — warning squiggle', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            await setMonacoContent(page, 'ROSTER(99999, "Loco", "LIGHT")')
            await expectWarningSquiggle(page)
        })

        test('unquoted loco name — error squiggle', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            await setMonacoContent(page, 'ROSTER(5, UnquotedName, "LIGHT")')
            await expectErrorSquiggle(page)
        })

        test('undefined macro in function list — warning squiggle', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            await setMonacoContent(page, 'ROSTER(5, "Good Name", LIGHT)')
            await expectWarningSquiggle(page)
        })

        test('wrong argument count — error squiggle on entire call', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            await setMonacoContent(page, 'ROSTER(1, "Only two args")')
            await expectErrorSquiggle(page)
        })

        test('squiggles clear when content becomes valid', async ({ workspacePage: page }) => {
            await openRawRoster(page)

            // Start with bad content — squiggle should appear
            await setMonacoContent(page, 'ROSTER(bad, Unquoted, 123)')
            await expectErrorSquiggle(page)

            // Replace with valid content — squiggle must disappear
            await setMonacoContent(page, 'ROSTER(1, "Good Loco", "LIGHT")')
            await expectNoErrorSquiggle(page)
        })

        test('multiple errors in one file each get a squiggle', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            await setMonacoContent(page, [
                'ROSTER(abc, "Line one", "LIGHT")',
                'ROSTER(5, BadName, "LIGHT")',
            ].join('\n'))
            // At least two error decorations (one per bad argument)
            await expect(page.locator('.squiggly-error')).toHaveCount(2, { timeout: 4_000 })
        })

        test('macro with appended functions — no squiggles', async ({ workspacePage: page }) => {
            await openRawRoster(page)
            // Valid: #define MOTOR_FN with ROSTER using MOTOR_FN "/EXTRA" format (appended functions)
            await setMonacoContent(page, [
                '#define MOTOR_FN "LIGHT/HORN"',
                'ROSTER(101, "Engine", MOTOR_FN "/BRAKE")',
                'ROSTER(102, "Tender", MOTOR_FN "/WHISTLE")',
            ].join('\n'))
            await expectNoErrorSquiggle(page)
        })
    })

    // ── SERVO_TURNOUT validator tests ─────────────────────────────────────────

    test.describe('SERVO_TURNOUT', () => {
        test('valid entry — no squiggles', async ({ workspacePage: page }) => {
            await openRawTurnouts(page)
            await setMonacoContent(page, 'SERVO_TURNOUT(200, 25, 410, 205, Slow, "Main Line")')
            await expectNoErrorSquiggle(page)
        })

        test('non-integer ID — error squiggle', async ({ workspacePage: page }) => {
            await openRawTurnouts(page)
            await setMonacoContent(page, 'SERVO_TURNOUT(BAD_ID, 25, 410, 205, Slow, "Desc")')
            await expectErrorSquiggle(page)
        })

        test('invalid profile keyword — error squiggle', async ({ workspacePage: page }) => {
            await openRawTurnouts(page)
            await setMonacoContent(page, 'SERVO_TURNOUT(200, 25, 410, 205, SuperFast, "Desc")')
            await expectErrorSquiggle(page)
        })

        test('unquoted description — error squiggle', async ({ workspacePage: page }) => {
            await openRawTurnouts(page)
            await setMonacoContent(page, 'SERVO_TURNOUT(200, 25, 410, 205, Slow, UnquotedDesc)')
            await expectErrorSquiggle(page)
        })

        test('wrong argument count — error squiggle on entire call', async ({ workspacePage: page }) => {
            await openRawTurnouts(page)
            await setMonacoContent(page, 'SERVO_TURNOUT(200, 25, 410)')
            await expectErrorSquiggle(page)
        })
    })
})
