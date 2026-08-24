/**
 * Locates and prepares the bundled, version-locked build runtime.
 *
 * DCC-Rail-Commander ships its own CPython and PlatformIO Core rather than
 * downloading a toolchain on first launch, so a build is reproducible and works
 * behind a firewall. The only process in the app that is allowed to touch the
 * network is git (cloning the DCC-EX product repos) — every environment built
 * here is deliberately hostile to outbound HTTP so that a missing package
 * fails loudly instead of quietly downloading itself.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { mkdir, cp, readdir, writeFile, readFile, rename, rm } from 'fs/promises'

/**
 * Versions the app is built against. These are what `fetch-toolchain.mjs`
 * installs into `resources/`, and what the UI reports as the bundled version.
 */
/**
 * Fallback for `bundledVersion()` when the manifest is unreadable. The shipped
 * versions themselves are pinned in `scripts/fetch-toolchain.mjs`, which writes
 * the manifest this module reads.
 */
export const BUNDLED_PLATFORMIO_VERSION = '6.1.18'

export interface ToolchainManifest {
    python: string
    platformio: string
    platforms: Record<string, string>
    /** Changes whenever the bundled tree changes; drives re-seeding. */
    stamp: string
}

const STAMP_FILE = '.dcc-rail-commander-toolchain'

/**
 * Root of the bundled resources tree. Packaged builds get it from Electron's
 * resources dir; in dev it is the repo's `resources/` folder, which
 * `pnpm toolchain:fetch` populates.
 */
export function resourcesRoot(): string {
    return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
}

/** The bundled interpreter. Relocatable, so it can be invoked from anywhere. */
export function pythonExe(): string {
    return process.platform === 'win32'
        ? join(resourcesRoot(), 'python', 'python.exe')
        : join(resourcesRoot(), 'python', 'bin', 'python3')
}

/** Vendored PlatformIO Core and its dependencies (installed with `pip --target`). */
export function sitePackagesDir(): string {
    return join(resourcesRoot(), 'pio', 'site-packages')
}

/** Vendored Arduino libraries that would otherwise come from the PIO registry. */
export function pioLibsDir(): string {
    return join(resourcesRoot(), 'pio-libs')
}

/** Read-only platform/package tree shipped in the app. */
export function bundledCoreDir(): string {
    return join(resourcesRoot(), 'pio-core')
}

/**
 * Writable PlatformIO core directory, seeded from the bundled tree on first run.
 * Follows the same `~/dcc-rail-commander/...` convention as the repos and prefs dirs.
 */
export function coreDir(): string {
    return join(app.getPath('home'), 'dcc-rail-commander', 'platformio')
}

export function platformsDir(): string {
    return join(coreDir(), 'platforms')
}

export function packagesDir(): string {
    return join(coreDir(), 'packages')
}

/** True when the app was packaged with (or dev-fetched) a usable runtime. */
export function hasBundledRuntime(): boolean {
    return existsSync(pythonExe()) && existsSync(sitePackagesDir())
}

/** Reads `resources/toolchain-manifest.json`, or null when it isn't there. */
export function readManifest(): ToolchainManifest | null {
    const path = join(resourcesRoot(), 'toolchain-manifest.json')
    if (!existsSync(path)) return null
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as ToolchainManifest
    } catch {
        return null
    }
}

/** The PlatformIO Core version this build ships, per the manifest. */
export function bundledVersion(): string {
    return readManifest()?.platformio ?? BUNDLED_PLATFORMIO_VERSION
}

async function readStamp(): Promise<string | null> {
    try {
        return (await readFile(join(coreDir(), STAMP_FILE), 'utf-8')).trim()
    } catch {
        return null
    }
}

/**
 * True when the bundled runtime is present *and* its platform packs have
 * already been copied into the writable core dir for this exact build.
 */
export async function isRuntimeReady(): Promise<boolean> {
    if (!hasBundledRuntime()) return false
    const expected = readManifest()?.stamp
    if (!expected) return false
    return (await readStamp()) === expected
}

/**
 * Copies the bundled platform/package tree into the writable core dir.
 *
 * Copying rather than symlinking is deliberate: PlatformIO writes metadata into
 * package directories, user-imported toolchain packs have to land in the same
 * tree, and Windows directory symlinks need elevation. It runs once per build
 * of the app, guarded by the manifest stamp.
 *
 * Each entry is copied to a sibling temp path and then renamed into place.
 * `existsSync(target)` below is what makes re-seeding cheap on every launch —
 * without the rename being atomic, a process crash (or a second app instance
 * seeding the same shared core dir concurrently) can leave a half-copied
 * directory that looks "already installed" forever after, since nothing ever
 * re-copies over an existing target. A copy that never completes to `target`
 * cannot corrupt it; two racing copies just duplicate work, and whichever
 * renames first wins while the loser's temp copy is discarded.
 */
export async function seedRuntime(
    onProgress?: (message: string) => void,
): Promise<{ success: boolean; error?: string }> {
    if (!hasBundledRuntime()) {
        return { success: false, error: 'The bundled build runtime is missing from this installation.' }
    }
    const manifest = readManifest()
    if (!manifest) {
        return { success: false, error: 'The bundled build runtime is missing its toolchain manifest.' }
    }

    try {
        await mkdir(coreDir(), { recursive: true })

        for (const kind of ['platforms', 'packages'] as const) {
            const src = join(bundledCoreDir(), kind)
            if (!existsSync(src)) continue
            const dest = join(coreDir(), kind)
            await mkdir(dest, { recursive: true })

            const entries = await readdir(src)
            for (const entry of entries) {
                const target = join(dest, entry)
                if (existsSync(target)) continue
                onProgress?.(`Installing ${entry}...`)
                const tmp = join(dest, `.tmp-${entry}-${process.pid}-${Date.now()}`)
                await cp(join(src, entry), tmp, { recursive: true })
                try {
                    await rename(tmp, target)
                } catch (err) {
                    await rm(tmp, { recursive: true, force: true }).catch(() => { })
                    if (!existsSync(target)) throw err
                }
            }
        }

        await writeFile(join(coreDir(), STAMP_FILE), manifest.stamp, 'utf-8')
        onProgress?.('Build toolchain ready')
        return { success: true }
    } catch (err) {
        return { success: false, error: (err as Error).message }
    }
}

/** True when a platform pack (e.g. "espressif32") is present in the core dir. */
export function isPlatformInstalled(platform: string): boolean {
    return existsSync(join(platformsDir(), platform))
}

/**
 * Environment for every PlatformIO subprocess.
 *
 * Besides pointing PlatformIO at the bundled interpreter and the seeded core
 * dir, this pins outbound HTTP at a dead local port. Nothing here should ever
 * need the network — if PlatformIO decides it wants to download a package, the
 * build fails immediately with a connection error instead of silently pulling
 * an unpinned toolchain over the wire.
 */
export function pioEnv(): NodeJS.ProcessEnv {
    const dead = 'http://127.0.0.1:9'
    return {
        ...process.env,
        PYTHONPATH: sitePackagesDir(),
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUNBUFFERED: '1',
        PLATFORMIO_CORE_DIR: coreDir(),
        PLATFORMIO_PLATFORMS_DIR: platformsDir(),
        PLATFORMIO_PACKAGES_DIR: packagesDir(),
        PLATFORMIO_DISABLE_PROGRESSBAR: 'true',
        PLATFORMIO_FORCE_ANSI: 'true',
        PLATFORMIO_SETTING_ENABLE_TELEMETRY: 'false',
        PLATFORMIO_SETTING_CHECK_PLATFORMIO_INTERVAL: '1000000',
        PLATFORMIO_SETTING_CHECK_PLATFORMS_INTERVAL: '1000000',
        PLATFORMIO_SETTING_CHECK_LIBRARIES_INTERVAL: '1000000',
        // Offline fuse — see the doc comment above.
        HTTP_PROXY: dead,
        HTTPS_PROXY: dead,
        http_proxy: dead,
        https_proxy: dead,
        NO_PROXY: '',
        no_proxy: '',
    }
}
