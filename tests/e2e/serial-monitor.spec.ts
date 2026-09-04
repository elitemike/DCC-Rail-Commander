import { test, expect } from './fixtures'

/**
 * Regression coverage for a bug where rapidly toggling the Monitor panel
 * could leave duplicate quick-command button rows behind (or, less often,
 * an empty panel). Two independent bugs combined to cause it:
 *
 * 1. serial-monitor.ts deferred its xterm init behind `document.fonts.load()`,
 *    guarded by a plain boolean that a newer attach cycle could reset before
 *    an older cycle's callback checked it — letting a stale init slip through.
 * 2. xterm's own `Terminal.dispose()` can throw when a terminal is torn down
 *    very soon after creation. Since that call happened inside the
 *    synchronous `detaching()` lifecycle hook, the throw aborted Aurelia's
 *    `if` controller mid-deactivation, so the old view's DOM (including its
 *    quick-command button row) never actually got removed before the next
 *    toggle's fresh view was inserted.
 */
test('rapid Monitor toggling never leaves duplicate or stray DOM behind', async ({ workspacePage: page }) => {
    const monitorBtn = page.getByRole('button', { name: 'Monitor' }).first()
    await expect(monitorBtn).toBeVisible()

    // Zero-gap synchronous spam clicks, dispatched in-page so there's no
    // Playwright actionability wait between them — the same-tick race that
    // caused the original bug.
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find((b) => b.textContent?.trim().includes('Monitor') && !b.closest('#workspace-splitter'))
        for (let i = 0; i < 20; i++) {
            btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        }
    })
    await page.waitForTimeout(500)

    // Real clicks at varying small intervals, to land inside the async
    // document.fonts.load() resolution window from different offsets.
    for (let i = 0; i < 10; i++) {
        await monitorBtn.click()
        await page.waitForTimeout(i % 4)
    }
    await page.waitForTimeout(500)

    // Whatever state it settles in (open or closed), there must be exactly
    // one clean render, never a partial or duplicated stack.
    expect(await page.locator('serial-monitor').count()).toBeLessThanOrEqual(1)
    expect(await page.locator('serial-monitor button[title^="Send:"]').count()).toBeLessThanOrEqual(15)
    expect(await page.locator('serial-monitor button[title="Send: <s>"]').count()).toBeLessThanOrEqual(1)
})

/**
 * Regression coverage for a bug where closing the bottom panel via its own
 * "✕ Close panel" button (closeBottomPanel(), collapses the splitter) left
 * `showMonitor` desynced from the panel's actual (collapsed) visibility —
 * that button only touched the splitter, never `showMonitor`. So if Monitor
 * was open when the panel got closed this way, `showMonitor` stayed true,
 * and the *next* click on the Monitor toggle button just flipped it back to
 * false (a no-op, since the panel was already collapsed) instead of
 * reopening it. From the user's perspective: "the monitor doesn't come back"
 * — it actually takes a second click to see anything happen.
 */
test('Monitor reopens with a single click after being closed via the panel\'s own close button', async ({ workspacePage: page }) => {
    const monitorBtn = page.getByRole('button', { name: 'Monitor' }).first()
    await expect(monitorBtn).toBeVisible()
    // The mock device auto-connects and auto-opens the Monitor on load.
    await expect(page.locator('serial-monitor')).toHaveCount(1)

    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.title === 'Close panel')
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await expect(page.locator('serial-monitor')).toHaveCount(0)

    await monitorBtn.click()
    await expect(page.locator('serial-monitor')).toHaveCount(1)
})

/**
 * Regression: the quick-send "E-Stop" button sent `<=>` (Track Manager
 * config query) instead of `<!>` (actual emergency stop all) — a copy/paste
 * mix-up, so clicking it never emergency-stopped anything.
 */
test('E-Stop quick-send button sends the real emergency-stop command', async ({ workspacePage: page }) => {
    await expect(page.locator('serial-monitor')).toHaveCount(1)
    await page.getByRole('button', { name: 'E-Stop', exact: true }).click()
    await expect(page.locator('serial-monitor .xterm-rows')).toContainText('> <!>')
})

/**
 * The core of this change: Monitor is just a view over the connection, not
 * the thing that owns it. Closing the Monitor panel must not disconnect the
 * port — Connect/Disconnect is now a separate, explicit control.
 */
test('closing the Monitor panel does not disconnect the port', async ({ workspacePage: page }) => {
    const connectToggle = page.getByTestId('connect-toggle')
    // The mock device auto-connects on load (see other tests in this file).
    await expect(connectToggle).toHaveText('Disconnect', { timeout: 5_000 })

    await page.getByRole('button', { name: 'Monitor' }).first().click()
    await expect(page.locator('serial-monitor')).toHaveCount(0)

    await expect(connectToggle).toHaveText('Disconnect')
})

/**
 * The Reset quick-send command reboots the command station, so unlike the
 * other quick-send buttons it must be gated behind a confirmation dialog —
 * cancelling must not send anything, and confirming must send the real
 * `<D RESET>` command.
 */
test('Reset quick-send button asks for confirmation before sending', async ({ workspacePage: page }) => {
    await expect(page.locator('serial-monitor')).toHaveCount(1)

    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    const dialog = page.locator('confirm-dialog, [class*="fixed inset-0"]').filter({ hasText: 'Reset?' })
    await dialog.waitFor({ state: 'visible' })

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await expect(page.locator('serial-monitor .xterm-rows')).not.toContainText('<D RESET>')

    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    const dialog2 = page.locator('confirm-dialog, [class*="fixed inset-0"]').filter({ hasText: 'Reset?' })
    await dialog2.waitFor({ state: 'visible' })
    await dialog2.getByRole('button', { name: 'Send' }).click()

    await expect(page.locator('serial-monitor .xterm-rows')).toContainText('> <D RESET>')
})

test('Disconnect/Connect toggles the connection while the Monitor stays open as a view', async ({ workspacePage: page }) => {
    const connectToggle = page.getByTestId('connect-toggle')
    await expect(connectToggle).toHaveText('Disconnect', { timeout: 5_000 })
    await expect(page.locator('serial-monitor')).toHaveCount(1)

    await connectToggle.click()
    await expect(connectToggle).toHaveText('Connect')
    // The panel itself is untouched — still there, now just showing "not connected".
    await expect(page.locator('serial-monitor')).toHaveCount(1)
    await expect(page.locator('serial-monitor .xterm-rows')).toContainText('Disconnected')

    await connectToggle.click()
    await expect(connectToggle).toHaveText('Disconnect')
    await expect(page.locator('serial-monitor .xterm-rows')).toContainText('Connected')
})
