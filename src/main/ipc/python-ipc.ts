import { ipcMain } from 'electron'
import { pythonRunner } from '../index'
import type { PythonJobOptions } from '../python-runner'

/**
 * IPC handlers for Python sub-process management.
 *
 * Renderer → Main (invoke / handle):
 *  python:run    (options: PythonJobOptions) → PythonJobResult
 *  python:send   (jobId: string, message: string) → void
 *  python:kill   (jobId: string) → void
 *
 * Main → Renderer push events:
 *  python:stdout  { jobId, line }
 *  python:stderr  { jobId, line }
 *  python:error   { jobId, message }
 *  python:done    PythonJobResult
 */
export function registerPythonIpcHandlers(): void {
    ipcMain.handle('python:run', async (_event, options: PythonJobOptions) => {
        return pythonRunner.run(options)
    })

    ipcMain.handle('python:send', (_event, jobId: string, message: string) => {
        pythonRunner.send(jobId, message)
    })

    ipcMain.handle('python:kill', (_event, jobId: string) => {
        pythonRunner.kill(jobId)
    })
}
