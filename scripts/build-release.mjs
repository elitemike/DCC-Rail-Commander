#!/usr/bin/env node
/**
 * One-command build: checks the Node version, installs deps (which also
 * fetches the bundled toolchain via postinstall if it isn't already present
 * for this OS/arch), builds the renderer/main bundles, packages a native
 * installer with electron-builder for whatever OS this is run on, and prints
 * the path to the resulting executable.
 *
 *   pnpm release
 */

import { readFile, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const log = (msg) => console.log(`[release] ${msg}`)

function run(command, args, options = {}) {
    // pnpm is a .cmd shim on Windows, which node's spawn() can only launch through a shell.
    // Folding the whole command line into one string (rather than passing shell:true alongside
    // a separate args array) avoids node's "unescaped args with shell:true" deprecation warning —
    // safe here since every arg is a fixed literal, never user input.
    return new Promise((resolve, reject) => {
        log(`${command} ${args.join(' ')}`)
        const child = spawn([command, ...args].join(' '), [], { stdio: 'inherit', cwd: ROOT, shell: true, ...options })
        child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
        )
        child.on('error', reject)
    })
}

function checkNodeVersion(requiredRange) {
    // engines.node is a simple ">=X.Y.Z" in this repo — parse the minimum major version out of it.
    const match = requiredRange.match(/(\d+)\.(\d+)\.(\d+)/)
    if (!match) return
    const [, major] = match.map(Number)
    const actualMajor = Number(process.versions.node.split('.')[0])
    if (actualMajor < major) {
        throw new Error(
            `Node ${process.version} is too old — this project requires ${requiredRange}. ` +
                `Run \`nvm install ${major} && nvm use ${major}\` (see README.md) and try again.`,
        )
    }
    log(`Node ${process.version} OK (requires ${requiredRange})`)
}

/** Finds the artifact(s) electron-builder just produced, so the final message is unambiguous. */
async function findReleaseArtifacts(outputDir) {
    let entries
    try {
        entries = await readdir(join(ROOT, outputDir))
    } catch {
        return []
    }
    const installerExts = ['.exe', '.dmg', '.appimage', '.deb']
    return entries.filter((name) => installerExts.includes(name.slice(name.lastIndexOf('.')).toLowerCase()))
}

/**
 * electron-builder used to package into the fixed `release/` directory (directories.output in
 * package.json's "build" config), so a second release right after a first one had to overwrite
 * the previous run's still-warm win-unpacked\resources\app.asar in place. On Windows that file
 * can briefly be held open by AV/EDR real-time scanning, the search indexer, or (when running
 * from VS Code) the editor's own file watcher/Explorer view of release/ — nothing to do with a
 * leftover app process — which turned the overwrite into an EBUSY. Deleting release/ first
 * (an earlier fix) only narrowed the window: the delete itself could still lose to one of those
 * same watchers holding a handle open, and a watcher can just as easily re-lock the freshly
 * written files a moment later. Writing every run into its own timestamped subfolder instead
 * means a run never touches another run's files at all, so this class of lock can't happen.
 */
function timestampedOutputDir() {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return join('release', stamp)
}

async function main() {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'))
    checkNodeVersion(pkg.engines.node)

    const outputDir = timestampedOutputDir()
    log(`Packaging into ${outputDir}/ (a fresh folder per run, so this build never has to overwrite a previous run's output)`)
    await run('pnpm', ['install'])
    await run('pnpm', ['build'])
    await run('pnpm', ['exec', 'electron-builder', `-c.directories.output=${outputDir}`])

    const artifacts = await findReleaseArtifacts(outputDir)
    if (artifacts.length === 0) {
        log(`electron-builder finished, but no installer file was found under ${outputDir}/ — check the log above.`)
        return
    }
    log('Executable ready:')
    for (const name of artifacts) {
        log(`  ${join(outputDir, name)}`)
    }
}

main().catch((err) => {
    console.error(`[release] ${err.message}`)
    process.exit(1)
})
