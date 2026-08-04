import { describe, it, expect } from 'vitest'
import { isProductUserFile, copyProductSourceFiles } from '../../src/renderer/src/utils/product-source-files'
import type { ProductDetail } from '../../src/renderer/src/models/product-details'
import type { FileService } from '../../src/renderer/src/services/file.service'

const product: ProductDetail = {
    productName: 'EX-CommandStation',
    repoName: 'DCC-EX/CommandStation-EX',
    defaultBranch: 'master',
    repoUrl: 'https://example.invalid/repo.git',
    supportedDevices: [],
    minimumConfigFiles: ['config.h'],
    otherConfigFilePatterns: [String.raw`^my.*\.[^?]*example\.h$|(^my.*\.h$)`],
}

class FakeFileService {
    dirs = new Map<string, string[]>()
    copied: Array<{ src: string; dest: string }> = []
    madeDirs: string[] = []

    async listDir(path: string): Promise<string[]> {
        return this.dirs.get(path) ?? []
    }
    async mkdir(path: string): Promise<void> {
        this.madeDirs.push(path)
    }
    async copyFiles(src: string, dest: string): Promise<void> {
        this.copied.push({ src, dest })
    }
    async readFile(): Promise<string> { return '' }
    async writeFile(): Promise<void> { }
    async exists(): Promise<boolean> { return true }
    async deleteFiles(): Promise<void> { }
    async getInstallDir(): Promise<string> { return '' }
    async selectDirectory(): Promise<string | null> { return null }
}

describe('isProductUserFile', () => {
    it('treats minimumConfigFiles as user files', () => {
        expect(isProductUserFile(product, 'config.h')).toBe(true)
    })

    it('treats files matching otherConfigFilePatterns as user files', () => {
        expect(isProductUserFile(product, 'myAutomation.h')).toBe(true)
        expect(isProductUserFile(product, 'myAutomation.example.h')).toBe(true)
    })

    it('does not treat firmware source files as user files', () => {
        expect(isProductUserFile(product, 'CommandStation-EX.ino')).toBe(false)
        expect(isProductUserFile(product, 'DCCTimer.cpp')).toBe(false)
    })
})

describe('copyProductSourceFiles', () => {
    it('copies source files, skips user files, .example/.template files, and non-source extensions', async () => {
        const files = new FakeFileService()
        files.dirs.set('/repo', [
            'main.cpp', 'config.h', 'myAutomation.h', 'notes.txt', 'src', 'unrelated',
            'config.h.example', 'config.h.template',
        ])
        files.dirs.set('/repo/src', ['helper.cpp'])

        await copyProductSourceFiles(files as unknown as FileService, product, '/repo', '/scratch')

        expect(files.copied).toEqual([
            { src: '/repo/main.cpp', dest: '/scratch/main.cpp' },
            { src: '/repo/src/helper.cpp', dest: '/scratch/src/helper.cpp' },
        ])
    })

    it('recurses into allowed subdirs (src, libraries) but not other directories', async () => {
        const files = new FakeFileService()
        files.dirs.set('/repo', ['src', 'libraries', 'unrelated'])
        files.dirs.set('/repo/src', ['a.h'])
        files.dirs.set('/repo/libraries', ['b.h'])
        files.dirs.set('/repo/unrelated', ['c.h'])

        await copyProductSourceFiles(files as unknown as FileService, product, '/repo', '/scratch')

        expect(files.madeDirs).toEqual(['/scratch/src', '/scratch/libraries'])
        expect(files.copied).toEqual([
            { src: '/repo/src/a.h', dest: '/scratch/src/a.h' },
            { src: '/repo/libraries/b.h', dest: '/scratch/libraries/b.h' },
        ])
    })
})
