import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── Regression coverage ──────────────────────────────────────────────────────
// The "Setup New Device" modal (device-wizard.html) used to size itself with a
// fixed `width: 760px` on its root panel and a fixed `height: 44rem` on the step
// content pane, with no max-height anywhere in the chain. On a small/low-res
// screen the header + stepper nav + 44rem content + footer could add up to more
// than the available viewport height, and nothing in the classic dialog host
// (@aurelia/dialog's DialogDomRendererClassic, used here so Syncfusion popups
// aren't clipped by the native <dialog> top-layer — see device-wizard.ts) scrolls
// the modal as a whole. The footer's Next/Back/Finish buttons were pushed off
// the bottom of the screen with no way to reach them.
//
// There's no jsdom/DOM-rendering tier in this repo (vitest.config.ts runs
// `environment: 'node'`), so this asserts the template source directly rather
// than rendering it — same tradeoff other renderer tests make by exercising the
// ViewModel instead of the DOM (see device-wizard.test.ts).

function readTemplate(): string {
    const path = fileURLToPath(new URL('../../src/renderer/src/components/device-wizard.html', import.meta.url))
    return readFileSync(path, 'utf-8')
}

describe('device-wizard.html modal sizing', () => {
    it('caps the root panel size against the viewport instead of a fixed pixel size', () => {
        const html = readTemplate()

        // Old bug: `style="width: 760px;"` with no max-height anywhere on the panel.
        expect(html).not.toMatch(/style="width:\s*760px;?"/)

        // Width and height must both be bounded by a vw/vh viewport unit so the
        // panel can never exceed the screen, while still capping at (not
        // exceeding) the original 760px / 90vh design size.
        expect(html).toMatch(/width:\s*min\(760px,\s*95vw\)/)
        expect(html).toMatch(/max-height:\s*90vh/)
    })

    it('lets only the step content scroll, keeping header/footer pinned on screen', () => {
        const html = readTemplate()

        // Old bug: the step content pane had a fixed `height: 44rem` instead of
        // flexing to the space actually available, so it didn't shrink on short
        // screens and pushed the footer (Next/Back/Finish buttons) off-screen.
        expect(html).not.toMatch(/style="height:\s*44rem;?"/)

        // Root panel must be a flex column so header/footer can be pinned
        // (shrink-0) while the middle section absorbs the flexible space.
        expect(html).toMatch(/rounded-2xl shadow-2xl flex flex-col"/)

        // Header and footer never shrink or scroll off...
        const headerBar = html.match(/<div class="flex items-center justify-between px-6 py-4 border-b[^"]*"/)
        const footerBar = html.match(/<div class="flex items-center justify-between px-6 py-4 border-t[^"]*"/)
        expect(headerBar?.[0]).toContain('shrink-0')
        expect(footerBar?.[0]).toContain('shrink-0')

        // ...while the step content pane is the flexible, scrollable region.
        expect(html).toMatch(/class="px-6 py-5 overflow-y-auto flex-1 min-h-0"/)
    })
})
