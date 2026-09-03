/**
 * PlatformIO build backend.
 *
 * Replaces the previous arduino-cli integration. Everything it needs — the
 * Python interpreter, PlatformIO Core, the platform toolchains and the Arduino
 * libraries — is bundled with the app (see `pio-runtime.ts`), so compiling and
 * uploading never reaches the network.
 *
 * The public surface deliberately matches what the renderer already consumed:
 * `compile(sketchPath, fqbn)`, `upload(sketchPath, fqbn, port)` and
 * `listBoards()`, each returning the same shapes as before.
 */

import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { writeFile, readFile, readdir, mkdtemp, rm, cp } from 'fs/promises'
import { tmpdir, cpus } from 'os'
import { execFile, exec, spawn, type ChildProcess } from 'child_process'
import { extract as tarExtract } from 'tar'
import type { UsbManager } from './usb-manager'
import {
    resolveTarget,
    platformName,
    lookupKnownBoard,
    type BoardTarget,
} from './board-targets'
import {
    pythonExe,
    pioEnv,
    pioLibsDir,
    platformsDir,
    packagesDir,
    hasBundledRuntime,
    isPlatformInstalled,
    isRuntimeReady,
    seedRuntime,
    bundledVersion,
    readManifest,
} from './pio-runtime'
import {
    filterSketchEntries,
    toSyntaxOnlyCommand,
    parseDiagnostics,
    dedupeDiagnostics,
    type CompileDbEntry,
} from './quick-compile'
import type { QuickCompileResult, QuickCompileDiagnostic } from '../types/ipc'

export interface PioRunResult {
    success: boolean
    output: string
    error?: string
}

export interface DetectedBoard {
    name: string
    fqbn: string
    port: string
    protocol: string
    serialNumber?: string
}

/** Build/upload subprocess timeout. Matches the previous backend's 5 minutes. */
const RUN_TIMEOUT_MS = 300_000

/**
 * Quick Compile's own, much shorter subprocess timeouts — it's meant to be
 * fast (compiledb generation and a syntax-only pass are each a second or two
 * in practice; see the feature/quick_compile design notes), and it runs
 * automatically on every Save, so a stuck subprocess should be killed well
 * before it could ever compete with `RUN_TIMEOUT_MS`-scale real build/upload
 * work or block the app for anywhere near that long.
 */
const QUICK_COMPILE_COMPILEDB_TIMEOUT_MS = 30_000
const QUICK_COMPILE_SYNTAX_TIMEOUT_MS = 15_000

/** Used only to test for blank lines — the ANSI itself is kept and forwarded so xterm can render color. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*[A-Za-z]/g

export class PlatformIoService {
    private progressCallback?: (phase: string, message: string) => void

    /**
     * Builds run one at a time. Two concurrent runs would race over the shared
     * core directory, and PlatformIO's own locking would fail one of them with
     * an opaque error rather than simply waiting.
     */
    private queue: Promise<unknown> = Promise.resolve()

    /**
     * Live child processes spawned by quick-compile's compiledb generation and
     * per-file syntax-only checks — tracked so `killQuickCompileProcesses()` can
     * force-kill them on app quit. Unlike a real compile/upload (bounded by
     * `RUN_TIMEOUT_MS` and expected to run to completion), quick-compile fires
     * automatically on every Save with nothing in the UI ever awaiting it, so a
     * still-running one at quit time is normal, not exceptional — same
     * reasoning as `PythonRunner.killAll()`'s own job tracking (see
     * `window-all-closed` in index.ts).
     */
    private readonly quickCompileProcesses = new Set<ChildProcess>()

    constructor(private readonly usb: UsbManager) { }

    /** Force-kills any in-flight quick-compile subprocess — called on app quit (see index.ts's `window-all-closed`), same pattern as `PythonRunner.killAll()`. */
    killQuickCompileProcesses(): void {
        for (const child of this.quickCompileProcesses) child.kill()
        this.quickCompileProcesses.clear()
    }

    setProgressCallback(cb: (phase: string, message: string) => void): void {
        this.progressCallback = cb
    }

    private emitProgress(phase: string, message: string): void {
        this.progressCallback?.(phase, message)
    }

    // ── Runtime state ────────────────────────────────────────────────────────

    /** True when the bundled runtime is present and seeded and ready to build. */
    async isRuntimeReady(): Promise<boolean> {
        return isRuntimeReady()
    }

    /** Copies the bundled platform packs into the writable core dir (once). */
    async seedRuntime(): Promise<{ success: boolean; error?: string }> {
        return seedRuntime((message) => this.emitProgress('seed', message))
    }

    /** The PlatformIO Core version this build of the app ships. */
    getBundledVersion(): string {
        return bundledVersion()
    }

    /** Asks the bundled PlatformIO Core to report its own version. */
    async getVersion(): Promise<string | null> {
        if (!hasBundledRuntime()) return null
        return new Promise((resolve) => {
            execFile(
                pythonExe(),
                ['-m', 'platformio', '--version'],
                { timeout: 30_000, env: pioEnv() },
                (err, stdout) => {
                    if (err) return resolve(null)
                    const match = /\d+\.\d+\.\d+/.exec(stdout)
                    resolve(match ? match[0] : stdout.trim() || null)
                },
            )
        })
    }

    /** Installed platform packs, in the shape the renderer's platform list expects. */
    async getPlatforms(): Promise<Array<{ id: string; installed: string; latest: string; name: string }>> {
        const manifest = readManifest()
        let entries: string[] = []
        try {
            entries = await readdir(platformsDir())
        } catch {
            return []
        }
        return entries
            .filter((name) => !name.startsWith('.'))
            .map((name) => {
                const version = manifest?.platforms?.[name] ?? ''
                return { id: name, installed: version, latest: version, name }
            })
    }

    /**
     * Whether the toolchain for a given board is available locally. Boards
     * outside the bundled set (STM32) report `installed: false` so the UI can
     * offer the offline pack import instead of failing at compile time.
     */
    async checkToolchain(fqbn: string): Promise<{ installed: boolean; version: string | null }> {
        const target = resolveTarget(fqbn)
        if (!target) return { installed: false, version: null }
        const name = platformName(target.platform)
        if (!isPlatformInstalled(name)) return { installed: false, version: null }
        return { installed: true, version: readManifest()?.platforms?.[name] ?? null }
    }

    /**
     * Imports a toolchain pack — a `.tar.gz`/`.zip` containing `platforms/`
     * and/or `packages/` directories — into the writable core dir. This is the
     * offline route for boards whose toolchain isn't bundled.
     */
    async importToolchainPack(archivePath: string): Promise<{ success: boolean; error?: string }> {
        let tempDir: string | null = null
        try {
            tempDir = await mkdtemp(join(tmpdir(), 'ex-toolchain-'))
            this.emitProgress('seed', 'Extracting toolchain pack...')
            if (archivePath.endsWith('.zip')) {
                await this.extractZipTo(archivePath, tempDir)
            } else {
                await this.extractTarGzTo(archivePath, tempDir)
            }

            // Tolerate both `pack.tar.gz/{platforms,packages}` and an archive
            // that wraps those in a single top-level directory.
            const entries = await readdir(tempDir)
            const srcRoot =
                entries.includes('platforms') || entries.includes('packages')
                    ? tempDir
                    : entries.length === 1
                        ? join(tempDir, entries[0])
                        : tempDir

            let copied = false
            for (const kind of ['platforms', 'packages'] as const) {
                const src = join(srcRoot, kind)
                if (!existsSync(src)) continue
                const dest = kind === 'platforms' ? platformsDir() : packagesDir()
                if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
                this.emitProgress('seed', `Installing ${kind}...`)
                await cp(src, dest, { recursive: true })
                copied = true
            }

            if (!copied) {
                return {
                    success: false,
                    error: 'That archive does not look like a PlatformIO toolchain pack (no platforms/ or packages/ directory).',
                }
            }
            this.emitProgress('seed', 'Toolchain pack installed')
            return { success: true }
        } catch (err) {
            return { success: false, error: (err as Error).message }
        } finally {
            if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => { })
        }
    }

    // ── Board detection ──────────────────────────────────────────────────────

    /**
     * Enumerates connected boards.
     *
     * PlatformIO can list serial ports but cannot identify which board is on
     * them, so identity comes from the VID/PID table in `board-targets.ts`.
     * Every physically present port is returned — an unrecognised one shows up
     * with an empty FQBN rather than disappearing.
     */
    async listBoards(): Promise<DetectedBoard[]> {
        const ports = await this.usb.listSerialPorts()
        return ports.map((sp) => {
            const known = lookupKnownBoard(sp.vendorId, sp.productId)
            return {
                name: known?.name ?? sp.manufacturer ?? 'Unknown device',
                fqbn: known?.fqbn ?? '',
                port: sp.path,
                protocol: 'serial',
                serialNumber: sp.serialNumber,
            }
        })
    }

    // ── Build / upload ───────────────────────────────────────────────────────

    async compile(sketchPath: string, fqbn: string, verbose?: boolean): Promise<PioRunResult> {
        return this.enqueue(() => this.runBuild('compile', sketchPath, fqbn, undefined, verbose))
    }

    async upload(sketchPath: string, fqbn: string, port: string, verbose?: boolean): Promise<PioRunResult> {
        return this.enqueue(() => this.runBuild('upload', sketchPath, fqbn, port, verbose))
    }

    /**
     * Syntax-only check of the user's own sketch files — see the design writeup in
     * the `feature/quick_compile` plan. Compiles nothing for real: generates (or
     * reuses a cached) `compile_commands.json` via `pio run -t compiledb`, then
     * re-runs each project-root translation unit's exact compiler command with
     * `-fsyntax-only` appended, in parallel, bypassing SCons/pio entirely for the
     * actual check. Routed through the same `enqueue()` as compile/upload — it
     * must not race a real build over the shared `.pio/build` dir.
     */
    async quickCompile(sketchPath: string, fqbn: string): Promise<QuickCompileResult> {
        return this.enqueue(() => this.runQuickCompile(sketchPath, fqbn))
    }

    /** compile_commands.json entries, keyed by scratchPath, cached until the sketch's own source-file list changes. */
    private readonly compileDbCache = new Map<string, { sourceKey: string; entries: CompileDbEntry[] }>()

    private async runQuickCompile(sketchPath: string, fqbn: string): Promise<QuickCompileResult> {
        const started = Date.now()
        const fail = (error: string): QuickCompileResult =>
            ({ success: false, diagnostics: [], durationMs: Date.now() - started, error })

        const target = resolveTarget(fqbn)
        if (!target) return fail(`No PlatformIO build target is defined for board "${fqbn}".`)
        if (!hasBundledRuntime()) return fail('The bundled build runtime is missing from this installation.')
        const platform = platformName(target.platform)
        if (!isPlatformInstalled(platform)) {
            return fail(`The ${platform} toolchain is not installed. Import a toolchain pack for ${target.label} to build for this board.`)
        }

        try {
            await this.writeProjectConfig(sketchPath, target)
        } catch (err) {
            return fail(`Could not write platformio.ini: ${(err as Error).message}`)
        }

        let entries: CompileDbEntry[]
        try {
            entries = await this.getSketchCompileDbEntries(sketchPath, target)
        } catch (err) {
            return fail(`Could not resolve build commands: ${(err as Error).message}`)
        }

        const diagnostics = dedupeDiagnostics(await this.runSyntaxOnlyChecks(entries))
        return {
            success: !diagnostics.some((d) => d.severity === 'error'),
            diagnostics,
            durationMs: Date.now() - started,
        }
    }

    /**
     * Returns the project-root (user-editable) compile_commands.json entries for
     * `sketchPath`/`target`, regenerating via `pio run -t compiledb` only when the
     * sketch's own source-file list has changed since the last call — config-file
     * edits alone (config.h, etc.) never invalidate this, since those are headers,
     * not separate translation units.
     */
    private async getSketchCompileDbEntries(sketchPath: string, target: BoardTarget): Promise<CompileDbEntry[]> {
        const rootFiles = (await readdir(sketchPath)).filter((f) => /\.(cpp|ino)$/i.test(f)).sort()
        const sourceKey = rootFiles.join(',')

        const cached = this.compileDbCache.get(sketchPath)
        if (cached && cached.sourceKey === sourceKey) return cached.entries

        const args = ['-m', 'platformio', 'run', '-e', target.env, '--project-dir', sketchPath, '-t', 'compiledb']
        const result = await this.execPio(args, sketchPath)
        if (!result.success) throw new Error(result.error || result.output || 'compiledb generation failed')

        const raw = await readFile(join(sketchPath, 'compile_commands.json'), 'utf-8')
        const allEntries = JSON.parse(raw) as CompileDbEntry[]
        const entries = filterSketchEntries(allEntries)

        this.compileDbCache.set(sketchPath, { sourceKey, entries })
        return entries
    }

    /**
     * Runs every entry's compiler command with `-fsyntax-only` and parses their
     * combined output. Capped well below `cpus().length` — real DCC-EX projects
     * have dozens of sketch-root files, and this runs automatically on every
     * Save, so spawning one compiler process per core at once would peg every
     * CPU right as the renderer is also busy re-rendering after a save; a
     * modest cap keeps quick-compile itself fast without competing that hard
     * for machine resources.
     */
    private async runSyntaxOnlyChecks(entries: CompileDbEntry[]): Promise<QuickCompileDiagnostic[]> {
        const concurrency = Math.max(1, Math.min(4, cpus().length))
        const diagnostics: QuickCompileDiagnostic[] = []
        let index = 0

        const worker = async (): Promise<void> => {
            while (index < entries.length) {
                const entry = entries[index++]
                const output = await this.execShell(toSyntaxOnlyCommand(entry.command), entry.directory)
                diagnostics.push(...parseDiagnostics(output))
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()))
        return diagnostics
    }

    /** Runs a PlatformIO subcommand without streaming progress — currently only quick-compile's compiledb generation, an internal step that isn't something the Output panel needs to show, and which should never take anywhere near as long as a real build. */
    private execPio(args: string[], cwd: string): Promise<PioRunResult> {
        return new Promise((resolvePromise) => {
            const child = execFile(pythonExe(), args, { cwd, env: pioEnv(), timeout: QUICK_COMPILE_COMPILEDB_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
                this.quickCompileProcesses.delete(child)
                resolvePromise({ success: !err, output: stdout, error: err ? (stderr || stdout || err.message) : undefined })
            })
            this.quickCompileProcesses.add(child)
        })
    }

    /**
     * Runs one already-fully-formed shell command line (a compile_commands.json
     * entry, already shell-quoted by PlatformIO) and returns its combined
     * stdout+stderr — `-fsyntax-only` diagnostics are all that's wanted here, and
     * a non-zero exit (a real syntax error) is expected, not a failure to
     * surface as an error.
     */
    private execShell(command: string, cwd: string): Promise<string> {
        return new Promise((resolvePromise) => {
            const child = exec(command, { cwd, env: pioEnv(), timeout: QUICK_COMPILE_SYNTAX_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout, stderr) => {
                this.quickCompileProcesses.delete(child)
                resolvePromise(`${stdout}\n${stderr}`)
            })
            this.quickCompileProcesses.add(child)
        })
    }

    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.queue.then(fn, fn)
        // Keep the chain alive even if a run rejects.
        this.queue = next.catch(() => undefined)
        return next
    }

    private async runBuild(
        phase: 'compile' | 'upload',
        sketchPath: string,
        fqbn: string,
        port?: string,
        verbose?: boolean,
    ): Promise<PioRunResult> {
        const target = resolveTarget(fqbn)
        if (!target) {
            return this.fail(phase, `No PlatformIO build target is defined for board "${fqbn}".`)
        }
        if (!hasBundledRuntime()) {
            return this.fail(phase, 'The bundled build runtime is missing from this installation.')
        }
        const platform = platformName(target.platform)
        if (!isPlatformInstalled(platform)) {
            return this.fail(
                phase,
                `The ${platform} toolchain is not installed. Import a toolchain pack for ${target.label} to build for this board.`,
            )
        }

        try {
            await this.writeProjectConfig(sketchPath, target)
        } catch (err) {
            return this.fail(phase, `Could not write platformio.ini: ${(err as Error).message}`)
        }

        const args = ['-m', 'platformio', 'run', '-e', target.env, '--project-dir', sketchPath]
        if (phase === 'upload') {
            args.push('-t', 'upload', '--upload-port', port ?? '')
        }
        if (verbose) args.push('-v')

        this.emitProgress(
            phase,
            phase === 'compile' ? `Compiling for ${fqbn}...` : `Uploading to ${port}...`,
        )
        return this.spawnPio(phase, args)
    }

    private fail(phase: 'compile' | 'upload', message: string): PioRunResult {
        this.emitProgress(phase, message)
        return { success: false, output: '', error: message }
    }

    private spawnPio(phase: 'compile' | 'upload', args: string[]): Promise<PioRunResult> {
        return new Promise((resolve) => {
            const child = spawn(pythonExe(), args, { env: pioEnv(), timeout: RUN_TIMEOUT_MS })
            let stdout = ''
            let stderr = ''

            const stream = (text: string) => {
                for (const line of text.split(/\r\n|\r|\n/)) {
                    if (line.replace(ANSI, '').trim()) this.emitProgress(phase, line)
                }
            }

            child.stdout.on('data', (d: Buffer) => {
                const text = d.toString()
                stdout += text
                stream(text)
            })
            child.stderr.on('data', (d: Buffer) => {
                const text = d.toString()
                stderr += text
                stream(text)
            })
            child.on('close', (code) => {
                resolve({
                    success: code === 0,
                    output: stdout,
                    error: code !== 0 ? stderr || stdout : undefined,
                })
            })
            child.on('error', (err) => {
                resolve({ success: false, output: '', error: err.message })
            })
        })
    }

    /**
     * Writes the `platformio.ini` used for this build.
     *
     * It is regenerated on every run and deliberately declares no `lib_deps`:
     * every dependency resolves from directories bundled with the app, which is
     * what keeps the build off the PlatformIO registry. The layout mirrors the
     * one CommandStation-EX ships upstream (`src_dir = .`, `include_dir = .`)
     * because the staged sketch is a flat Arduino tree with headers at the root.
     */
    private async writeProjectConfig(sketchPath: string, target: BoardTarget): Promise<void> {
        const libDirs = [pioLibsDir()]
        if (existsSync(join(sketchPath, 'libraries'))) libDirs.push(join(sketchPath, 'libraries'))

        const buildFlags = ['-Wall', '-Wextra', ...target.buildFlags].join(' ')
        const lines = [
            '; Generated by DCC-Rail-Commander — regenerated on every build.',
            '; Edits to this file will be overwritten.',
            '',
            '[platformio]',
            `default_envs = ${target.env}`,
            'src_dir = .',
            'include_dir = .',
            'build_dir = .pio/build',
            'libdeps_dir = .pio/libdeps',
            '',
            `[env:${target.env}]`,
            `platform = ${target.platform}`,
            `board = ${target.board}`,
            'framework = arduino',
            `build_flags = ${buildFlags}`,
            `lib_extra_dirs = ${libDirs.map(toIniPath).join(', ')}`,
            'monitor_speed = 115200',
        ]
        if (target.uploadSpeed) lines.push(`upload_speed = ${target.uploadSpeed}`)
        lines.push('')

        await writeFile(join(sketchPath, 'platformio.ini'), lines.join('\n'), 'utf-8')
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private async extractTarGzTo(archivePath: string, cwd: string): Promise<void> {
        await tarExtract({ file: archivePath, cwd })
    }

    private extractZipTo(archivePath: string, cwd: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (process.platform === 'win32') {
                execFile(
                    'powershell',
                    ['-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${cwd}' -Force`],
                    (err) => (err ? reject(err) : resolve()),
                )
            } else {
                execFile('unzip', ['-o', archivePath, '-d', cwd], (err) => (err ? reject(err) : resolve()))
            }
        })
    }
}

/** PlatformIO reads ini paths fine with forward slashes on every platform. */
function toIniPath(p: string): string {
    return p.replace(/\\/g, '/')
}
