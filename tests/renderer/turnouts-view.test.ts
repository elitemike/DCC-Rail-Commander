import { describe, it, expect } from 'vitest'
import { TurnoutsViewCustomElement } from '../../src/renderer/src/components/throttle/turnouts-view'

function makeView(descriptions: string[]): TurnoutsViewCustomElement {
    const view = Object.create(TurnoutsViewCustomElement.prototype) as TurnoutsViewCustomElement
    const turnouts = descriptions.map((description, i) => ({ id: i + 1, description }))
    Object.assign(view, {
        showHidden: false,
        configEditorState: { turnouts },
        throttleService: { turnoutStatuses: turnouts.map((t) => ({ id: t.id, state: 'UNKNOWN' })) },
    })
    return view
}

describe('TurnoutsViewCustomElement hidden turnouts', () => {
    it('hides HIDDEN turnouts by default and counts them', () => {
        const view = makeView(['Main', 'HIDDEN', 'Yard'])
        expect(view.showHidden).toBe(false)
        expect(view.isHiddenTurnout(1)).toBe(false)
        expect(view.isHiddenTurnout(2)).toBe(true)
        expect(view.hiddenCount).toBe(1)
        expect(view.allHiddenAndCollapsed).toBe(false)
    })

    it('reports the all-hidden empty state only while collapsed', () => {
        const view = makeView(['HIDDEN', 'HIDDEN'])
        expect(view.allHiddenAndCollapsed).toBe(true)
        view.showHidden = true
        expect(view.allHiddenAndCollapsed).toBe(false)
    })
})
