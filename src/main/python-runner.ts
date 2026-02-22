import { BrowserWindow } from 'electron'
import { PythonShell, Options as PythonOptions } from 'python-shell'
import { join } from 'path'
import { app } from 'electron'

export interface PythonJobOptions {
    /** Python script path relative to the `python/` resource directory. */
    script: string
    /** CLI arguments forwarded to the script. */
    args?: string[]
    /** Working directory override. Defaults to the app resource path. */
    cwd?: string
    /** Additional environment variables merged with process.env. */
    env?: Record<string, string>
    /** Mode passed to python-shell. Defaults to 'text'. */
    mode?: 'text' | 'json' | 'binary'
}

export interface PythonJobResult {
    jobId: string
    exitCode: number | null
    output: string[]
    error?: string
}

/**
 * PythonRunner
 *
 * Wraps `python-shell` to spawn Python sub-processes from the Electron main
 * process. Each job receives a unique ID so the renderer can track multiple
 * concurrent invocations via IPC.
 *
 * Scripts should be placed in  <resources>/python/  when packaged, or in
 * src/python/ during development.
 */
export class PythonRunner {
    private readonly jobs = new Map<string, PythonShell>()
    private jobCounter = 0

    /** Resolve the root directory that contains Python scripts. */
    private get scriptRoot(): string {
        return app.isPackaged
            ? join(process.resourcesPath, 'python')
            : join(__dirname, '../../python')
    }

    /**
     * Run a Python script, streaming stdout lines back to the renderer as they
     * arrive, and resolving when the process exits.
     */
    run(options: PythonJobOptions): Promise<PythonJobResult> {
        const jobId = `python-job-${++this.jobCounter}`
        const collected: string[] = []

        const shellOptions: PythonOptions = {
            mode: options.mode ?? 'text',
            pythonPath: process.platform === 'win32' ? 'python' : 'python3',
            scriptPath: options.cwd ?? this.scriptRoot,
            args: options.args,
            env: { ...process.env, ...(options.env ?? {}) },
        }

        return new Promise((resolve, reject) => {
            const shell = new PythonShell(options.script, shellOptions)
            this.jobs.set(jobId, shell)

            shell.on('message', (message: string) => {
                collected.push(message)
                this.broadcastToRenderer('python:stdout', { jobId, line: message })
            })

            shell.on('stderr', (line: string) => {
                this.broadcastToRenderer('python:stderr', { jobId, line })
            })

            shell.end((err, code, signal) => {
                this.jobs.delete(jobId)
                if (err) {
                    this.broadcastToRenderer('python:error', { jobId, message: err.message })
                    reject(err)
                    return
                }
                const result: PythonJobResult = {
                    jobId,
                    exitCode: code ?? null,
                    output: collected,
                }
                this.broadcastToRenderer('python:done', result)
                resolve(result)
            })
        })
    }

    /**
     * Send a line of text to a running Python process's stdin.
     * Useful for interactive scripts.
     */
    send(jobId: string, message: string): void {
        const shell = this.jobs.get(jobId)
        if (!shell) throw new Error(`No running Python job with id '${jobId}'`)
        shell.send(message)
    }

    /** Terminate a specific job. */
    kill(jobId: string): void {
        const shell = this.jobs.get(jobId)
        if (shell) {
            shell.terminate()
            this.jobs.delete(jobId)
        }
    }

    /** Terminate all running jobs (called on app quit). */
    killAll(): void {
        for (const [jobId, shell] of this.jobs) {
            shell.terminate()
            this.jobs.delete(jobId)
        }
    }

    private broadcastToRenderer(channel: string, payload: unknown): void {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send(channel, payload)
        })
    }
}
