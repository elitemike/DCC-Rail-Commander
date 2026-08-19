#!/usr/bin/env node
/**
 * Populates `resources/` with the version-locked build runtime.
 *
 * This is the ONLY part of EX-Installer that downloads anything, and it runs at
 * build time, never on a user's machine. Everything it produces is shipped
 * inside the application so that the packaged app can compile firmware with no
 * network access at all — `git clone` of the DCC-EX product repos is then the
 * app's sole outbound connection.
 *
 *   pnpm toolchain:fetch
 *
 * Run it on each OS you package for: the interpreter, the Python wheels and the
 * compiler toolchains are all platform-specific.
 *
 * Produces:
 *   resources/python/                CPython (relocatable, from python-build-standalone)
 *   resources/pio/site-packages/     PlatformIO Core + deps + esptool
 *   resources/pio-core/platforms/    atmelavr, atmelmegaavr, espressif32
 *   resources/pio-core/packages/     the toolchains/frameworks those platforms need
 *   resources/pio-libs/              Arduino libraries that would come from the registry
 *   resources/toolchain-manifest.json
 */

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile, readFile, readdir, access, rename } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extract as tarExtract } from 'tar'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RESOURCES = join(ROOT, 'resources')

// ── Pinned versions ──────────────────────────────────────────────────────────
// Bump these deliberately; every one of them changes what a user's firmware is
// built with. `stamp` below is derived from them, which is what triggers the
// app to re-seed its core dir after an update.

const PYTHON_VERSION = '3.12.8'
/** python-build-standalone release tag providing the interpreter above. */
const PYTHON_RELEASE = '20241219'
const PLATFORMIO_VERSION = '6.1.18'
/** Pulled in explicitly: espressif32 expects esptool importable, not pip-installable. */
const ESPTOOL_VERSION = '4.7.0'

/**
 * Platform packs to vendor. STM32 is deliberately absent — it would add ~450 MB
 * for a small slice of users, who get the in-app "import toolchain pack" route
 * instead. Build a pack for them by running this script with
 * `--platforms ststm32@19.0.0` and archiving resources/pio-core.
 */
const PLATFORMS = ['atmelavr', 'atmelmegaavr', 'espressif32@6.7.0']

/**
 * Arduino libraries the sketches expect. CommandStation-EX's upstream
 * platformio.ini pulls Ethernet from the registry; we vendor it so a build
 * never needs the registry at all.
 */
const LIBRARIES = ['arduino-libraries/Ethernet@2.0.2']

// ── python-build-standalone asset selection ──────────────────────────────────

function pythonAsset() {
    const { platform, arch } = process
    const base = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}`
    const triples = {
        'linux-x64': 'x86_64-unknown-linux-gnu-install_only',
        'linux-arm64': 'aarch64-unknown-linux-gnu-install_only',
        'darwin-x64': 'x86_64-apple-darwin-install_only',
        'darwin-arm64': 'aarch64-apple-darwin-install_only',
        'win32-x64': 'x86_64-pc-windows-msvc-install_only',
    }
    const triple = triples[`${platform}-${arch}`]
    if (!triple) {
        throw new Error(`No bundled Python build for ${platform}-${arch}. Add one to fetch-toolchain.mjs.`)
    }
    return `${base}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${triple}.tar.gz`
}

function pythonExe() {
    return process.platform === 'win32'
        ? join(RESOURCES, 'python', 'python.exe')
        : join(RESOURCES, 'python', 'bin', 'python3')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const log = (msg) => console.log(`[toolchain] ${msg}`)

async function exists(path) {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

async function download(url, dest) {
    log(`downloading ${url}`)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`)
    await pipeline(res.body, createWriteStream(dest))
}

async function sha256(path) {
    const hash = createHash('sha256')
    hash.update(await readFile(path))
    return hash.digest('hex')
}

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        log(`${command} ${args.join(' ')}`)
        const child = spawn(command, args, { stdio: 'inherit', ...options })
        child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
        )
        child.on('error', reject)
    })
}

// ── Steps ────────────────────────────────────────────────────────────────────

async function fetchPython() {
    const target = join(RESOURCES, 'python')
    if (await exists(pythonExe())) {
        log('python already present, skipping')
        return null
    }

    const url = pythonAsset()
    const archive = join(RESOURCES, 'python.tar.gz')
    await download(url, archive)
    const digest = await sha256(archive)

    log('extracting python')
    const staging = join(RESOURCES, '.python-staging')
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await tarExtract({ file: archive, cwd: staging })

    // The archive wraps everything in a single `python/` directory. Move it
    // rather than copying: `fs.cp` resolves the relative symlinks in `bin/`
    // (python3 → python3.12) into absolute paths inside the staging dir, which
    // then get deleted, leaving a dangling interpreter.
    const [top] = await readdir(staging)
    await rm(target, { recursive: true, force: true })
    await rename(join(staging, top), target)
    await rm(staging, { recursive: true, force: true })
    await rm(archive, { force: true })

    return digest
}

async function installPythonPackages() {
    const target = join(RESOURCES, 'pio', 'site-packages')
    await mkdir(target, { recursive: true })
    // `--target` keeps everything relocatable; the app puts this on PYTHONPATH
    // rather than relying on a virtualenv baked to a build-machine path.
    await run(pythonExe(), [
        '-m', 'pip', 'install',
        '--no-cache-dir',
        '--upgrade',
        '--target', target,
        `platformio==${PLATFORMIO_VERSION}`,
        `esptool==${ESPTOOL_VERSION}`,
    ])
}

/** Environment for the pio invocations below — same layout the app ships. */
function pioEnv() {
    const coreDir = join(RESOURCES, 'pio-core')
    return {
        ...process.env,
        PYTHONPATH: join(RESOURCES, 'pio', 'site-packages'),
        PYTHONNOUSERSITE: '1',
        PLATFORMIO_CORE_DIR: coreDir,
        PLATFORMIO_PLATFORMS_DIR: join(coreDir, 'platforms'),
        PLATFORMIO_PACKAGES_DIR: join(coreDir, 'packages'),
        PLATFORMIO_SETTING_ENABLE_TELEMETRY: 'false',
    }
}

async function installPlatforms(platforms) {
    for (const platform of platforms) {
        // Installing into the shipped tree (rather than copying afterwards)
        // means the package manifests PlatformIO writes are shipped too, so the
        // app never has to "install" anything at runtime.
        await run(pythonExe(), ['-m', 'platformio', 'pkg', 'install', '--global', '--platform', platform], {
            env: pioEnv(),
        })
    }
    await installFrameworkPackages()
    await warmUpBuilds()
}

/**
 * One representative board per platform, used only to force a real build.
 * Mirrors `src/main/board-targets.ts`; any board on the platform will do.
 */
const WARMUP_BOARDS = {
    atmelavr: 'megaatmega2560',
    atmelmegaavr: 'nano_every',
    espressif32: 'esp32dev',
    ststm32: 'nucleo_f411re',
}

const WARMUP_SKETCH = `\
#include <Arduino.h>
void setup() {}
void loop() {}
`

/**
 * Compiles a trivial sketch for each installed platform.
 *
 * PlatformIO defers a surprising amount of downloading to the first real build
 * — SCons itself, framework packages, per-board tooling — none of which
 * `pkg install` fetches. On a user's machine those downloads can never happen,
 * so anything not pulled here becomes an HTTPClientError at compile time.
 * Building once is the only reliable way to discover the full set, and it
 * doubles as a check that the vendored toolchain actually works.
 */
async function warmUpBuilds() {
    const platformsRoot = join(RESOURCES, 'pio-core', 'platforms')
    let installed = []
    try {
        installed = (await readdir(platformsRoot)).filter((n) => !n.startsWith('.'))
    } catch {
        return
    }

    const workspace = join(RESOURCES, '.warmup')
    for (const platform of installed) {
        const board = WARMUP_BOARDS[platform]
        if (!board) {
            log(`no warm-up board known for ${platform}, skipping — its first real build may need the network`)
            continue
        }

        const projectDir = join(workspace, platform)
        await rm(projectDir, { recursive: true, force: true })
        await mkdir(join(projectDir, 'src'), { recursive: true })
        await writeFile(join(projectDir, 'src', 'main.cpp'), WARMUP_SKETCH, 'utf-8')
        await writeFile(
            join(projectDir, 'platformio.ini'),
            `[env:warmup]\nplatform = ${platform}\nboard = ${board}\nframework = arduino\n`,
            'utf-8',
        )

        log(`warming up ${platform} (${board})`)
        await run(pythonExe(), ['-m', 'platformio', 'run', '--project-dir', projectDir], { env: pioEnv() })
    }
    await rm(workspace, { recursive: true, force: true })
}

/**
 * Frameworks and upload tools that a platform marks *optional*.
 *
 * `pkg install --platform` only fetches a platform's mandatory packages;
 * PlatformIO pulls the framework and the uploader lazily, the first time a
 * project actually builds or flashes. On a user's machine that download can
 * never happen, so a build would die with an HTTPClientError. These have to be
 * vendored explicitly.
 *
 * Listed by name rather than "install everything optional" because that would
 * drag in a dozen AVR core variants (attiny, digistump, megacore, …) this app
 * never builds for. Versions are not repeated here — they come from each
 * platform's own platform.json, so they stay consistent with the platform pin.
 */
const EXTRA_PACKAGES = {
    atmelavr: ['framework-arduino-avr', 'tool-avrdude'],
    atmelmegaavr: ['framework-arduino-megaavr', 'tool-avrdude'],
    espressif32: ['framework-arduinoespressif32', 'tool-esptoolpy', 'tool-mkspiffs', 'tool-mklittlefs', 'tool-mkfatfs'],
    ststm32: ['framework-arduinoststm32', 'framework-cmsis', 'tool-openocd', 'tool-dfuutil', 'tool-stm32duino'],
}

async function installFrameworkPackages() {
    const platformsRoot = join(RESOURCES, 'pio-core', 'platforms')
    let installed = []
    try {
        installed = (await readdir(platformsRoot)).filter((n) => !n.startsWith('.'))
    } catch {
        return
    }

    for (const platform of installed) {
        const wanted = EXTRA_PACKAGES[platform]
        if (!wanted) continue

        let manifest
        try {
            manifest = JSON.parse(await readFile(join(platformsRoot, platform, 'platform.json'), 'utf-8'))
        } catch {
            log(`could not read platform.json for ${platform}, skipping its framework packages`)
            continue
        }

        for (const name of wanted) {
            const pkg = manifest.packages?.[name]
            if (!pkg) {
                log(`${platform} does not declare ${name}, skipping`)
                continue
            }
            const spec = `${pkg.owner ?? 'platformio'}/${name}@${pkg.version}`
            await run(pythonExe(), ['-m', 'platformio', 'pkg', 'install', '--global', '--tool', spec], {
                env: pioEnv(),
            })
        }
    }
}

async function installLibraries() {
    const target = join(RESOURCES, 'pio-libs')
    await mkdir(target, { recursive: true })
    for (const library of LIBRARIES) {
        await run(
            pythonExe(),
            ['-m', 'platformio', 'pkg', 'install', '--storage-dir', target, '--library', library],
            { env: pioEnv() },
        )
    }
}

async function writeManifest(pythonDigest) {
    // Read back what actually landed, so the manifest describes the shipped
    // tree rather than what we asked for.
    let installed = []
    try {
        installed = (await readdir(join(RESOURCES, 'pio-core', 'platforms'))).filter((n) => !n.startsWith('.'))
    } catch { /* no platforms installed */ }

    const platforms = {}
    for (const name of installed) {
        try {
            const raw = await readFile(join(RESOURCES, 'pio-core', 'platforms', name, 'platform.json'), 'utf-8')
            platforms[name] = JSON.parse(raw).version ?? ''
        } catch {
            platforms[name] = ''
        }
    }

    // Read back the package dir names too (not just platforms): EXTRA_PACKAGES
    // additions/removals don't bump any of the pinned version constants, but they
    // do change what lands in resources/pio-core/packages, and the stamp needs to
    // notice that or an already-seeded machine will never pick the change up.
    let packageNames = []
    try {
        packageNames = (await readdir(join(RESOURCES, 'pio-core', 'packages'))).filter((n) => !n.startsWith('.')).sort()
    } catch { /* no packages installed */ }

    const manifest = {
        python: PYTHON_VERSION,
        platformio: PLATFORMIO_VERSION,
        platforms,
        pythonSha256: pythonDigest ?? null,
        builtOn: `${process.platform}-${process.arch}`,
        // Anything that changes what a user builds with changes the stamp, which
        // is what makes the app re-seed its core dir after an update.
        stamp: createHash('sha256')
            .update(JSON.stringify({ PYTHON_VERSION, PLATFORMIO_VERSION, ESPTOOL_VERSION, platforms, LIBRARIES, packageNames }))
            .digest('hex')
            .slice(0, 16),
    }

    await writeFile(join(RESOURCES, 'toolchain-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
    log(`manifest written (stamp ${manifest.stamp})`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const argIndex = process.argv.indexOf('--platforms')
    const platforms = argIndex === -1 ? PLATFORMS : process.argv[argIndex + 1].split(',')

    await mkdir(RESOURCES, { recursive: true })

    const pythonDigest = await fetchPython()
    await installPythonPackages()
    await installPlatforms(platforms)
    await installLibraries()
    await writeManifest(pythonDigest)

    log('done — resources/ is ready to package')
}

main().catch((err) => {
    console.error(`[toolchain] ${err.message}`)
    process.exit(1)
})
