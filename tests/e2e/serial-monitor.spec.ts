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
    expect(await page.locator('serial-monitor button[title^="Send:"]').count()).toBeLessThanOrEqual(14)
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
