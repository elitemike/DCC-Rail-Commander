import { describe, it, expect } from 'vitest'
import { isProductUserFile, isExampleConfigFile, collectExampleConfigFiles, copyProductSourceFiles } from '../../src/renderer/src/utils/product-source-files'
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
    fileContents = new Map<string, string>()
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
    async readFile(path: string): Promise<string> { return this.fileContents.get(path) ?? '' }
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
    it('copies source files and example config files, skips real user files, .template files, and non-source extensions', async () => {
        const files = new FakeFileService()
        files.dirs.set('/repo', [
            'main.cpp', 'config.h', 'myAutomation.h', 'notes.txt', 'src', 'unrelated',
            'config.h.example', 'config.h.template', 'myAutomation.example.h',
        ])
        files.dirs.set('/repo/src', ['helper.cpp'])

        await copyProductSourceFiles(files as unknown as FileService, product, '/repo', '/scratch')

        expect(files.copied).toEqual([
            { src: '/repo/main.cpp', dest: '/scratch/main.cpp' },
            { src: '/repo/src/helper.cpp', dest: '/scratch/src/helper.cpp' },
            { src: '/repo/config.h.example', dest: '/scratch/config.h.example' },
            { src: '/repo/myAutomation.example.h', dest: '/scratch/myAutomation.example.h' },
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

// ── isExampleConfigFile ──────────────────────────────────────────────────────

describe('isExampleConfigFile', () => {
    it('matches the "name.example.ext" convention', () => {
        expect(isExampleConfigFile('myAutomation.example.h')).toBe(true)
        expect(isExampleConfigFile('config.example.h')).toBe(true)
    })

    it('matches the "name.ext.example" convention', () => {
        expect(isExampleConfigFile('config.h.example')).toBe(true)
    })

    it('does not match real config or source files', () => {
        expect(isExampleConfigFile('myAutomation.h')).toBe(false)
        expect(isExampleConfigFile('config.h')).toBe(false)
        expect(isExampleConfigFile('DCCTimer.cpp')).toBe(false)
    })
})

// ── collectExampleConfigFiles ────────────────────────────────────────────────

describe('collectExampleConfigFiles', () => {
    it('reads every example file in the given directory, non-recursively', async () => {
        const files = new FakeFileService()
        files.dirs.set('/scratch', [
            'config.h', 'myAutomation.h', 'myAutomation.example.h', 'config.example.h', 'src',
        ])
        files.dirs.set('/scratch/src', ['nested.example.h']) // must not be picked up — non-recursive
        files.fileContents.set('/scratch/myAutomation.example.h', '// automation example')
        files.fileContents.set('/scratch/config.example.h', '// config example')

        const result = await collectExampleConfigFiles(files as unknown as FileService, '/scratch')

        expect(result).toEqual([
            { name: 'myAutomation.example.h', content: '// automation example' },
            { name: 'config.example.h', content: '// config example' },
        ])
    })
})
