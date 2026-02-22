import { app, dialog, BrowserWindow } from 'electron'
import { join } from 'path'
import { readFile, writeFile, readdir, access, mkdir, cp, rm } from 'fs/promises'

export class FileService {
    get baseDir(): string {
        return join(app.getPath('home'), 'ex-installer')
    }

    async getInstallDir(subdir?: string): Promise<string> {
        const dir = subdir ? join(this.baseDir, subdir) : this.baseDir
        await mkdir(dir, { recursive: true })
        return dir
    }

    async readFile(filePath: string): Promise<string> {
        return readFile(filePath, 'utf-8')
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        await writeFile(filePath, content, 'utf-8')
    }

    async listDir(dirPath: string): Promise<string[]> {
        try {
            return await readdir(dirPath)
        } catch {
            return []
        }
    }

    async exists(filePath: string): Promise<boolean> {
        try {
            await access(filePath)
            return true
        } catch {
            return false
        }
    }

    async mkdir(dirPath: string): Promise<void> {
        await mkdir(dirPath, { recursive: true })
    }

    async copyFiles(src: string, dest: string): Promise<void> {
        await cp(src, dest, { recursive: true })
    }

    async deleteFiles(filePath: string): Promise<void> {
        await rm(filePath, { recursive: true, force: true })
    }

    async selectDirectory(): Promise<string | null> {
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return null
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
        })
        return result.canceled ? null : result.filePaths[0] ?? null
    }
}
