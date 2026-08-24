import { join } from 'path'
import { app } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'

/**
 * simple-git just forwards whatever child_process.spawn('git', ...) throws, which for
 * the most common Windows failure (git.exe not on PATH) is an opaque "spawn git ENOENT".
 * Give the user something actionable instead of a bare Node error code.
 */
function describeGitError(err: Error): string {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || /spawn git ENOENT/i.test(err.message)) {
        return 'Git was not found on your system PATH. Install Git for Windows (https://git-scm.com/download/win) and restart DCC-Rail-Commander.'
    }
    if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|Could not resolve host/i.test(err.message)) {
        return `Could not reach the remote repository — check your internet connection or proxy settings.\n${err.message}`
    }
    return err.message
}

export class GitService {
    private getGit(repoPath?: string): SimpleGit {
        if (repoPath) {
            return simpleGit({ baseDir: repoPath })
        }
        return simpleGit()
    }

    /** Base directory for cloned repos */
    get reposDir(): string {
        const dir = join(app.getPath('home'), 'dcc-rail-commander', 'repos')
        return dir
    }

    async clone(url: string, dest: string, branch?: string): Promise<{ success: boolean; error?: string }> {
        try {
            // Always do a full, recursive clone (no --depth, include submodules)
            const options = [];
            if (branch) {
                options.push('--branch', branch);
            }
            options.push('--recurse-submodules');
            await this.getGit().clone(url, dest, options);
            // Also update/init submodules just in case
            const git = this.getGit(dest);
            await git.submoduleUpdate(['--init', '--recursive']);
            return { success: true };
        } catch (err) {
            return { success: false, error: describeGitError(err as Error) };
        }
    }

    async pull(repoPath: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.getGit(repoPath).pull()
            return { success: true }
        } catch (err) {
            return { success: false, error: describeGitError(err as Error) }
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
