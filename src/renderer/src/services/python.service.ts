import { DI } from 'aurelia'
import type { PythonJobOptions, PythonJobResult } from '../../../types/ipc'

export interface JobState {
    jobId: string
    script: string
    stdout: string[]
    stderr: string[]
    done: boolean
    exitCode: number | null
    error?: string
}

/**
 * PythonService
 *
 * Wraps window.python (the contextBridge API) and maintains a reactive job
 * registry so components can track multiple concurrent Python jobs.
 */
export const IPythonService = DI.createInterface<PythonService>('IPythonService')

export class PythonService {
    /** All jobs that have been started since app launch. */
    jobs: Map<string, JobState> = new Map()

    private readonly unsubscribers: Array<() => void> = []

    constructor() {
        if (window.python) {
            this.unsubscribers.push(
                window.python.onStdout(({ jobId, line }) => {
                    this.jobs.get(jobId)?.stdout.push(line)
                }),
                window.python.onStderr(({ jobId, line }) => {
                    this.jobs.get(jobId)?.stderr.push(line)
                }),
                window.python.onDone((result) => {
                    const job = this.jobs.get(result.jobId)
                    if (job) {
                        job.done = true
                        job.exitCode = result.exitCode
                    }
                }),
                window.python.onError(({ jobId, message }) => {
                    const job = this.jobs.get(jobId)
                    if (job) {
                        job.done = true
                        job.error = message
                    }
                }),
            )
        }
    }

    /**
     * Run a Python script and track its state reactively.
     * Returns the final job result when the process exits.
     */
    async run(options: PythonJobOptions): Promise<PythonJobResult> {
        // Register a provisional job state before the IPC call resolves so that
        // streaming stdout/stderr events arrive in the right bucket.
        const provisionalId = `pending-${Date.now()}`
        const state: JobState = {
            jobId: provisionalId,
            script: options.script,
            stdout: [],
            stderr: [],
            done: false,
            exitCode: null,
        }
        this.jobs.set(provisionalId, state)

        try {
            const result = await window.python.run(options)
            // Update the map key to the real jobId assigned by the main process.
            this.jobs.delete(provisionalId)
            state.jobId = result.jobId
            state.done = true
            state.exitCode = result.exitCode
            this.jobs.set(result.jobId, state)
            return result
        } catch (err) {
            state.done = true
            state.error = (err as Error).message
            throw err
        }
    }

    /** Send stdin to a running job. */
    async send(jobId: string, message: string): Promise<void> {
        await window.python.send(jobId, message)
    }

    /** Kill a specific job. */
    async kill(jobId: string): Promise<void> {
        await window.python.kill(jobId)
        const job = this.jobs.get(jobId)
        if (job) {
            job.done = true
            job.error = 'killed'
        }
    }

    /** Kill all tracked jobs (called on app unbind). */
    cancelAll(): void {
        for (const jobId of this.jobs.keys()) {
            const job = this.jobs.get(jobId)
            if (job && !job.done) {
                window.python.kill(jobId).catch(() => { })
            }
        }
        this.unsubscribers.forEach((fn) => fn())
        this.unsubscribers.length = 0
    }
}
