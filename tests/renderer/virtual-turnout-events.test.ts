import { describe, it, expect } from 'vitest'

import {
    addChildToVirtualEvents,
    removeChildFromVirtualEvents,
    syncVirtualEvents,
    hasVirtualEvents,
    virtualEventStatus,
    canonicalizeVirtualEvents,
} from '../../src/renderer/src/utils/virtual-turnout-events'
import type { EventHandlerEntry } from '../../src/renderer/src/utils/myAutomationParser'

const close300: EventHandlerEntry = { command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(200)\nDONE' }
const throw300: EventHandlerEntry = { command: 'ONTHROW', text: 'ONTHROW(300)\nTHROW(200)\nDONE' }

describe('virtual-turnout-events', () => {
    it('adds CLOSE/THROW lines above DONE in the parent’s handlers', () => {
        const out = addChildToVirtualEvents([close300, throw300], 300, 201)
        expect(out[0].text).toBe('ONCLOSE(300)\nCLOSE(200)\nCLOSE(201)\nDONE')
        expect(out[1].text).toBe('ONTHROW(300)\nTHROW(200)\nTHROW(201)\nDONE')
    })

    it('is idempotent', () => {
        const once = addChildToVirtualEvents([close300, throw300], 300, 201)
        expect(addChildToVirtualEvents(once, 300, 201)).toBe(once)
    })

    it('appends when the handler has no DONE', () => {
        const out = addChildToVirtualEvents([{ command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(200)' }], 300, 201)
        expect(out[0].text).toBe('ONCLOSE(300)\nCLOSE(200)\nCLOSE(201)')
    })

    it('fills an empty body', () => {
        const out = addChildToVirtualEvents([{ command: 'ONCLOSE', text: 'ONCLOSE(300)' }], 300, 201)
        expect(out[0].text).toBe('ONCLOSE(300)\nCLOSE(201)')
    })

    it('creates the ONCLOSE and ONTHROW handlers when the parent has none', () => {
        const out = addChildToVirtualEvents([], 300, 201)
        expect(out).toEqual([
            { command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(201)\nDONE' },
            { command: 'ONTHROW', text: 'ONTHROW(300)\nTHROW(201)\nDONE' },
        ])
        const other: EventHandlerEntry[] = [{ command: 'ONCLOSE', text: 'ONCLOSE(999)\nCLOSE(5)\nDONE' }]
        const withOther = addChildToVirtualEvents(other, 300, 201)
        expect(withOther).toHaveLength(3)
        expect(withOther[0]).toBe(other[0])
        expect(hasVirtualEvents(other, 300)).toBe(false)
    })

    it('creates only the missing half when one handler already exists', () => {
        const out = addChildToVirtualEvents([close300], 300, 201)
        expect(out).toHaveLength(2)
        expect(out[0].text).toBe('ONCLOSE(300)\nCLOSE(200)\nCLOSE(201)\nDONE')
        expect(out[1].text).toBe('ONTHROW(300)\nTHROW(201)\nDONE')
    })

    it('reports which children are not yet covered', () => {
        expect(virtualEventStatus([], 300, [200])).toEqual({ hasClose: false, hasThrow: false, missing: [200] })
        expect(virtualEventStatus([close300, throw300], 300, [200, 201])).toEqual({ hasClose: true, hasThrow: true, missing: [201] })
        expect(virtualEventStatus([close300], 300, [200]).missing).toEqual([200]) // THROW side absent
    })

    it('leaves a handler alone when its body is shared with another trigger', () => {
        const shared: EventHandlerEntry[] = [{ command: 'ONCLOSE', text: 'ONCLOSE(300)\nONCLOSE(301)\nCLOSE(200)\nDONE' }]
        const out = addChildToVirtualEvents(shared, 300, 201)
        expect(out[0]).toBe(shared[0]) // the shared block is untouched; own handlers are created beside it
        expect(out.slice(1).map(h => h.command)).toEqual(['ONCLOSE', 'ONTHROW'])
    })

    it('removes the child’s line', () => {
        const out = removeChildFromVirtualEvents([close300, throw300], 300, 200)
        expect(out[0].text).toBe('ONCLOSE(300)\nDONE')
        expect(out[1].text).toBe('ONTHROW(300)\nDONE')
    })

    it('leaves unrelated lines for the same id alone (only the matching command is touched)', () => {
        const h: EventHandlerEntry = { command: 'ONCLOSE', text: 'ONCLOSE(300)\nTHROW(200)\nCLOSE(200)\nDONE' }
        expect(removeChildFromVirtualEvents([h], 300, 200)[0].text).toBe('ONCLOSE(300)\nTHROW(200)\nDONE')
    })

    describe('aliases', () => {
        const names: Record<number, string> = { 300: 'YARD_HUB', 200: 'MAIN_JUNCTION', 201: 'YARD_ENTRY' }
        const alias = (id: number) => names[id] ?? ''

        it('writes created handlers and lines with the alias when one is set, numbers otherwise', () => {
            const out = addChildToVirtualEvents([], 300, 201, alias)
            expect(out.map(h => h.text)).toEqual(['ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nDONE', 'ONTHROW(YARD_HUB)\nTHROW(YARD_ENTRY)\nDONE'])

            const mixed = addChildToVirtualEvents([], 300, 250, alias) // 250 has no alias
            expect(mixed[0].text).toBe('ONCLOSE(YARD_HUB)\nCLOSE(250)\nDONE')
            expect(addChildToVirtualEvents([], 301, 200, alias)[0].text).toBe('ONCLOSE(301)\nCLOSE(MAIN_JUNCTION)\nDONE')
        })

        it('recognises an existing handler by number or by alias, and does not duplicate a line in either spelling', () => {
            const byNumber: EventHandlerEntry[] = [
                { command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(200)\nDONE' },
                { command: 'ONTHROW', text: 'ONTHROW(YARD_HUB)\nTHROW(MAIN_JUNCTION)\nDONE' },
            ]
            expect(addChildToVirtualEvents(byNumber, 300, 200, alias)).toBe(byNumber)

            const out = addChildToVirtualEvents(byNumber, 300, 201, alias)
            expect(out).toHaveLength(2) // both recognised as 300's — nothing new created
            expect(out[0].text).toBe('ONCLOSE(300)\nCLOSE(200)\nCLOSE(YARD_ENTRY)\nDONE')
            expect(out[1].text).toBe('ONTHROW(YARD_HUB)\nTHROW(MAIN_JUNCTION)\nTHROW(YARD_ENTRY)\nDONE')
        })

        it('removes a line whichever way it was spelled', () => {
            const hs: EventHandlerEntry[] = [
                { command: 'ONCLOSE', text: 'ONCLOSE(YARD_HUB)\nCLOSE(200)\nCLOSE(YARD_ENTRY)\nDONE' },
            ]
            expect(removeChildFromVirtualEvents(hs, 300, 200, alias)[0].text).toBe('ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nDONE')
            expect(removeChildFromVirtualEvents(hs, 300, 201, alias)[0].text).toBe('ONCLOSE(YARD_HUB)\nCLOSE(200)\nDONE')
        })

        it('still treats a different alias in a stacked header as another trigger', () => {
            const shared: EventHandlerEntry[] = [{ command: 'ONCLOSE', text: 'ONCLOSE(YARD_HUB)\nONCLOSE(OTHER)\nCLOSE(200)\nDONE' }]
            expect(hasVirtualEvents(shared, 300, alias)).toBe(false)
        })

        it('reports coverage regardless of spelling', () => {
            const hs: EventHandlerEntry[] = [
                { command: 'ONCLOSE', text: 'ONCLOSE(YARD_HUB)\nCLOSE(MAIN_JUNCTION)\nDONE' },
                { command: 'ONTHROW', text: 'ONTHROW(300)\nTHROW(200)\nDONE' },
            ]
            expect(virtualEventStatus(hs, 300, [200, 201], alias).missing).toEqual([201])
        })
    })

    describe('canonicalizeVirtualEvents', () => {
        const virt = { id: 300, type: 'VIRTUAL' }
        const kid = { id: 201, type: 'SERVO', parentId: 300 }
        const stranger = { id: 500, type: 'SERVO' }
        const names: Record<number, string> = { 300: 'YARD_HUB', 201: 'YARD_ENTRY' }
        const alias = (id: number) => names[id] ?? ''

        it('re-spells numeric headers and child lines once aliases exist', () => {
            const hs: EventHandlerEntry[] = [
                { command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(201)\nCLOSE(500)\nDONE' },
                { command: 'ONTHROW', text: 'ONTHROW(300)\nTHROW(201)\nDONE' },
            ]
            const out = canonicalizeVirtualEvents(hs, [virt, kid, stranger], alias)
            expect(out[0].text).toBe('ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nCLOSE(500)\nDONE') // 500 isn't a tree child: untouched
            expect(out[1].text).toBe('ONTHROW(YARD_HUB)\nTHROW(YARD_ENTRY)\nDONE')
        })

        it('follows a renamed alias via previousAlias', () => {
            const hs: EventHandlerEntry[] = [{ command: 'ONCLOSE', text: 'ONCLOSE(YARD_HUB)\nCLOSE(OLD_ENTRY)\nDONE' }]
            const out = canonicalizeVirtualEvents(hs, [virt, kid], alias, id => (id === 201 ? 'OLD_ENTRY' : ''))
            expect(out[0].text).toBe('ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nDONE')
        })

        it('falls back to the number if the alias was removed', () => {
            const hs: EventHandlerEntry[] = [{ command: 'ONCLOSE', text: 'ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nDONE' }]
            const out = canonicalizeVirtualEvents(hs, [virt, kid], () => '', alias)
            expect(out[0].text).toBe('ONCLOSE(300)\nCLOSE(201)\nDONE')
        })

        it('returns the same array when already canonical', () => {
            const hs: EventHandlerEntry[] = [{ command: 'ONCLOSE', text: 'ONCLOSE(YARD_HUB)\nCLOSE(YARD_ENTRY)\nDONE' }]
            expect(canonicalizeVirtualEvents(hs, [virt, kid], alias)).toBe(hs)
        })
    })

    describe('syncVirtualEvents', () => {
        const virt = { id: 300, type: 'VIRTUAL' }
        const kid = { id: 201, type: 'SERVO' }

        it('adds when a turnout gains a virtual parent', () => {
            const out = syncVirtualEvents([close300], [virt, kid], [virt, { ...kid, parentId: 300 }])
            expect(out[0].text).toContain('CLOSE(201)')
            expect(out[1].text).toBe('ONTHROW(300)\nTHROW(201)\nDONE')
        })

        it('removes when it leaves or is deleted', () => {
            const linked = { ...kid, parentId: 300 }
            expect(syncVirtualEvents([close300], [virt, linked], [virt, kid])[0].text).not.toContain('201')
            const withLine: EventHandlerEntry = { command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(201)\nDONE' }
            expect(syncVirtualEvents([withLine], [virt, linked], [virt])[0].text).toBe('ONCLOSE(300)\nDONE')
        })

        it('follows a child that is renumbered', () => {
            const withLine: EventHandlerEntry = { command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(201)\nDONE' }
            const out = syncVirtualEvents(
                [withLine],
                [virt, { ...kid, parentId: 300 }],
                [virt, { ...kid, id: 205, parentId: 300 }],
            )
            expect(out[0].text).toBe('ONCLOSE(300)\nCLOSE(205)\nDONE')
        })

        it('does not strip a handler when its parent is deleted, renumbered or no longer virtual', () => {
            const withLine: EventHandlerEntry[] = [{ command: 'ONCLOSE', text: 'ONCLOSE(300)\nCLOSE(201)\nDONE' }]
            const linked = { ...kid, parentId: 300 }
            expect(syncVirtualEvents(withLine, [virt, linked], [kid])).toBe(withLine)
            expect(syncVirtualEvents(withLine, [virt, linked], [{ id: 300, type: 'PIN' }, kid])).toBe(withLine)

            // Renumbered parent: the old 300 handlers stay; the new id gets its own.
            const renumbered = syncVirtualEvents(withLine, [virt, linked], [{ id: 310, type: 'VIRTUAL' }, { ...kid, parentId: 310 }])
            expect(renumbered[0]).toBe(withLine[0])
            expect(renumbered.slice(1).map(h => h.text)).toEqual(['ONCLOSE(310)\nCLOSE(201)\nDONE', 'ONTHROW(310)\nTHROW(201)\nDONE'])
        })

        it('returns the same array when nothing changed', () => {
            const list = [close300]
            expect(syncVirtualEvents(list, [virt, kid], [virt, kid])).toBe(list)
        })
    })
})
