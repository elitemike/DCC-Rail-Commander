/**
 * Identity and directory naming for a configured board.
 *
 * A build directory used to be named `_build/<timestamp>/` — nothing about the
 * path said which board it was for, and a previous configuration was matched by
 * product alone, so with (say) a Mega and an ESP32 both running
 * EX-CommandStation the wrong board's config.h could be carried forward into a
 * new configuration. Keying on the board itself removes that collision.
 */

export interface BoardIdentity {
    fqbn: string
    serialNumber?: string
    port?: string
}

/**
 * Stable identity for a board: its type plus the specific unit. Serial number
 * is preferred because it survives the board moving to another port; the port
 * is the fallback for boards that don't report one.
 */
export function boardKey(board: BoardIdentity): string {
    const unit = board.serialNumber?.trim() || board.port?.trim() || ''
    return `${board.fqbn.trim()}|${unit}`
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** FNV-1a, base36. Short and stable — this only needs to avoid collisions. */
function shortHash(value: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(36)
}

/**
 * Directory-name fragment identifying a board.
 *
 * Readable prefix plus a hash of the full identity rather than the whole FQBN:
 * PlatformIO's package trees are deep, and Windows' path limit leaves little
 * room for a 50-character directory name.
 */
export function boardDirSlug(board: BoardIdentity): string {
    const name = slug(board.fqbn.split(':')[2] ?? board.fqbn) || 'board'
    return `${name}-${shortHash(boardKey(board))}`
}

/**
 * Per-configuration build directory.
 *
 * The `<repoFolder>` nesting is kept from the Arduino CLI era (it required the
 * sketch directory name to match the .ino filename); it costs nothing and keeps
 * existing saved configurations' paths shaped the same way.
 */
export function buildScratchPath(
    reposDir: string,
    repoFolder: string,
    board: BoardIdentity,
    id: string,
): string {
    return `${reposDir}/_build/${boardDirSlug(board)}-${id}/${repoFolder}`
}
