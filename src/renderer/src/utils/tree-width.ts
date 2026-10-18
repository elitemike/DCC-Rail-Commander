/**
 * One saved width shared by every tree/list sidebar (turnouts, roster, sensors, routes, ...), so
 * resizing any of them resizes them all. Stored as a bare pixel number under TREE_WIDTH_KEY.
 */
export const TREE_WIDTH_KEY = 'tree-panel-width'
export const TREE_WIDTH_DEFAULT = 256

/** Saved width in px, or the default when nothing valid is stored. */
export function loadTreeWidth(): number {
    try {
        const n = parseInt(localStorage.getItem(TREE_WIDTH_KEY) ?? '', 10)
        return Number.isFinite(n) ? n : TREE_WIDTH_DEFAULT
    } catch { return TREE_WIDTH_DEFAULT }
}

export function saveTreeWidth(px: number): void {
    try { localStorage.setItem(TREE_WIDTH_KEY, String(Math.round(px))) } catch { /* ignore */ }
}
