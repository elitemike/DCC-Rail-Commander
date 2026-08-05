import type { ConfigEditorState } from '../models/config-editor-state'

/**
 * Shared handle to the active ConfigEditorState, used by both the Monaco
 * completion provider (exrail-completions) and the diagnostic validator
 * (dccex-validators) so EXRAIL files can offer/validate turnout, sensor,
 * route, sequence and roster references against what's actually configured.
 *
 * Stored on `window` — not a module-level variable — so Vite HMR re-evaluating
 * this module doesn't reset it between the two consumer modules. `window` is
 * accessed lazily inside each function (not at module scope) so this module
 * can still be imported under Vitest's default `node` test environment.
 */
type WindowWithState = Window & { __dccexConfigEditorState?: ConfigEditorState }

export function setSharedConfigEditorState(state: ConfigEditorState): void {
    (window as WindowWithState).__dccexConfigEditorState = state
}

export function getSharedConfigEditorState(): ConfigEditorState | undefined {
    if (typeof window === 'undefined') return undefined
    return (window as WindowWithState).__dccexConfigEditorState
}
