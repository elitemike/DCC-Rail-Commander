import { join } from 'path'
import { app } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'

export class GitService {
    private getGit(repoPath?: string): SimpleGit {
        if (repoPath) {
            return simpleGit({ baseDir: repoPath })
        }
        return simpleGit()
    }

    /** Base directory for cloned repos */
    get reposDir(): string {
        const dir = join(app.getPath('home'), 'ex-installer', 'repos')
        return dir
    }

    async clone(url: string, dest: string, branch?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const options = branch ? ['--branch', branch] : []
            await this.getGit().clone(url, dest, options)
            return { success: true }
        } catch (err) {
            return { success: false, error: (err as Error).message }
        }
    }

    async pull(repoPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.getGit(repoPath).pull()
            return { success: true }
        } catch (err) {
            return { success: false, error: (err as Error).message }
        }
    }

    async listTags(repoPath: string): Promise<string[]> {
        try {
            const result = await this.getGit(repoPath).tags()
            return result.all
        } catch {
            return []
        }
    }

    async checkout(repoPath: string, ref: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.getGit(repoPath).checkout(ref)
            return { success: true }
        } catch (err) {
            return { success: false, error: (err as Error).message }
        }
    }

    async checkLocalChanges(repoPath: string): Promise<{ hasChanges: boolean; files: string[] }> {
        try {
            const status = await this.getGit(repoPath).status()
            return {
                hasChanges: !status.isClean(),
                files: [...status.modified, ...status.not_added, ...status.deleted],
            }
        } catch {
            return { hasChanges: false, files: [] }
        }
    }

    async hardReset(repoPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.getGit(repoPath).reset(['--hard', 'HEAD'])
            await this.getGit(repoPath).clean('f', ['-d'])
            return { success: true }
        } catch (err) {
            return { success: false, error: (err as Error).message }
        }
    }
}
