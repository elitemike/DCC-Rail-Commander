import { DI } from 'aurelia'

export const IFileService = DI.createInterface<FileService>('IFileService')

/**
 * FileService
 *
 * Wraps window.files (contextBridge API) for the renderer.
 */
export class FileService {
    async readFile(filePath: string): Promise<string> {
        return window.files.readFile(filePath)
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        return window.files.writeFile(filePath, content)
    }

    async listDir(dirPath: string): Promise<string[]> {
        return window.files.listDir(dirPath)
    }

    async exists(filePath: string): Promise<boolean> {
        return window.files.exists(filePath)
    }

    async mkdir(dirPath: string): Promise<void> {
        return window.files.mkdir(dirPath)
    }

    async copyFiles(src: string, dest: string): Promise<void> {
        return window.files.copyFiles(src, dest)
    }

    async deleteFiles(filePath: string): Promise<void> {
        return window.files.deleteFiles(filePath)
    }

    async getInstallDir(subdir?: string): Promise<string> {
        return window.files.getInstallDir(subdir)
    }

    async selectDirectory(): Promise<string | null> {
        return window.files.selectDirectory()
    }
}
