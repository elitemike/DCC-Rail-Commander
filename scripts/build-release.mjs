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
async function findReleaseArtifacts() {
    const releaseDir = join(ROOT, 'release')
    let entries
    try {
        entries = await readdir(releaseDir)
    } catch {
        return []
    }
    const installerExts = ['.exe', '.dmg', '.appimage', '.deb']
    return entries.filter((name) => installerExts.includes(name.slice(name.lastIndexOf('.')).toLowerCase()))
}

async function main() {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf-8'))
    checkNodeVersion(pkg.engines.node)

    await run('pnpm', ['install'])
    await run('pnpm', ['build'])
    await run('pnpm', ['exec', 'electron-builder'])

    const artifacts = await findReleaseArtifacts()
    if (artifacts.length === 0) {
        log('electron-builder finished, but no installer file was found under release/ — check the log above.')
        return
    }
    log('Executable ready:')
    for (const name of artifacts) {
        log(`  ${join('release', name)}`)
    }
}

main().catch((err) => {
    console.error(`[release] ${err.message}`)
    process.exit(1)
})
