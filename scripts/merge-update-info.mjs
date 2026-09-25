/**
 * electron-updater reads one channel file per release (`latest.yml`, or `alpha.yml`/`beta.yml` for
 * prerelease versions) and, on Windows, picks the installer whose file name contains the running
 * `process.arch`. `pnpm release` builds x64 and arm64 in two separate electron-builder runs, and
 * each run writes a channel file listing only its own installer — the second overwriting the first.
 * Merging them gives one file that lists both, so each arch updates to its own installer.
 */

/** Channel files electron-builder writes next to the installers. `builder-debug.yml` is a build log, not one. */
export function isChannelFile(name) {
    return /^[a-z]+\.yml$/i.test(name) && name !== 'builder-debug.yml'
}

/**
 * Combines two parsed channel files for the same version. The top-level `path`/`sha512` (a legacy
 * single-file fallback for old updater clients) stays the first file's.
 */
export function mergeUpdateInfo(first, second) {
    if (first.version !== second.version) {
        throw new Error(`Cannot merge update info for different versions (${first.version} vs ${second.version})`)
    }
    const files = [...(first.files ?? [])]
    for (const file of second.files ?? []) {
        if (!files.some((existing) => existing.url === file.url)) files.push(file)
    }
    return { ...first, files }
}
