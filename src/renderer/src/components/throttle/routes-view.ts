import { resolve } from 'aurelia'
import { ThrottleService } from '../../services/throttle.service'
import { ConfigEditorState } from '../../models/config-editor-state'
import type { RouteEntry } from '../../utils/myAutomationParser'

/**
 * Live route list — shows each route's status derived from the live state of
 * the turnouts it throws/closes.
 *
 * Iterates `throttleService.routeStatuses` directly (see turnouts-view.ts for
 * why: Aurelia only reactively observes direct member-access expressions
 * bound in the template, not values read inside a method call).
 */
export class RoutesViewCustomElement {
    readonly throttleService = resolve(ThrottleService)
    private readonly configEditorState = resolve(ConfigEditorState)

    routeFor(id: number): RouteEntry | undefined {
        return this.configEditorState.routes.find((r) => r.id === id)
    }
}
