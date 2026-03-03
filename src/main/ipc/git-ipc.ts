import { ipcMain } from 'electron'
import type { GitService } from '../git-client'

export function registerGitIpcHandlers(gitService: GitService): void {
    ipcMain.handle('git:clone', async (_event, url: string, dest: string, _branch?: string) => {
        return gitService.clone(url, dest, _branch)
    })

    ipcMain.handle('git:pull', async (_event, repoPath: string) => {
        return gitService.pull(repoPath)
    })

    ipcMain.handle('git:list-tags', async (_event, repoPath: string) => {
        return gitService.listTags(repoPath)
    })

    ipcMain.handle('git:checkout', async (_event, repoPath: string, ref: string) => {
        return gitService.checkout(repoPath, ref)
    })

    ipcMain.handle('git:check-local-changes', async (_event, repoPath: string) => {
        return gitService.checkLocalChanges(repoPath)
    })

    ipcMain.handle('git:hard-reset', async (_event, repoPath: string) => {
        return gitService.hardReset(repoPath)
    })
}
