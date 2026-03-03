import { DI } from 'aurelia'

export const IGitService = DI.createInterface<GitService>('IGitService')

/** Wraps window.git (contextBridge API) for the renderer. */
export class GitService {
    async clone(url: string, dest: string, branch?: string): Promise<{ success: boolean; error?: string }> {
        return window.git.clone(url, dest, branch)
    }

    async pull(repoPath: string): Promise<{ success: boolean; error?: string }> {
        return window.git.pull(repoPath)
    }

    async listTags(repoPath: string): Promise<string[]> {
        return window.git.listTags(repoPath)
    }

    async checkout(repoPath: string, ref: string): Promise<{ success: boolean; error?: string }> {
        return window.git.checkout(repoPath, ref)
    }

    async checkLocalChanges(repoPath: string): Promise<{ hasChanges: boolean; files: string[] }> {
        return window.git.checkLocalChanges(repoPath)
    }

    async hardReset(repoPath: string): Promise<{ success: boolean; error?: string }> {
        return window.git.hardReset(repoPath)
    }
}
