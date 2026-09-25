/**
 * Unit tests for scripts/merge-update-info.mjs — combining the per-arch
 * auto-update channel files `pnpm release` produces into one.
 */
import { describe, it, expect } from 'vitest'
import { isChannelFile, mergeUpdateInfo } from '../../scripts/merge-update-info.mjs'

const x64 = {
    version: '0.1.0-alpha.3',
    files: [{ url: 'DCC-Rail-Commander-Setup-0.1.0-alpha.3-x64.exe', sha512: 'aaa', size: 1 }],
    path: 'DCC-Rail-Commander-Setup-0.1.0-alpha.3-x64.exe',
    sha512: 'aaa',
    releaseDate: '2026-09-24T00:00:00.000Z',
}

const arm64 = {
    version: '0.1.0-alpha.3',
    files: [{ url: 'DCC-Rail-Commander-Setup-0.1.0-alpha.3-arm64.exe', sha512: 'bbb', size: 2 }],
    path: 'DCC-Rail-Commander-Setup-0.1.0-alpha.3-arm64.exe',
    sha512: 'bbb',
    releaseDate: '2026-09-24T00:05:00.000Z',
}

describe('mergeUpdateInfo', () => {
    it('lists both arch installers, keeping the first run’s legacy single-file fields', () => {
        expect(mergeUpdateInfo(x64, arm64)).toEqual({
            ...x64,
            files: [...x64.files, ...arm64.files],
        })
    })

    it('does not duplicate a file present in both', () => {
        expect(mergeUpdateInfo(x64, x64).files).toEqual(x64.files)
    })

    it('refuses to merge different versions', () => {
        expect(() => mergeUpdateInfo(x64, { ...arm64, version: '0.1.0-alpha.4' })).toThrow(/different versions/)
    })
})

describe('isChannelFile', () => {
    it('matches the channel files electron-builder writes, but not its build log', () => {
        expect(isChannelFile('latest.yml')).toBe(true)
        expect(isChannelFile('alpha.yml')).toBe(true)
        expect(isChannelFile('builder-debug.yml')).toBe(false)
        expect(isChannelFile('builder-effective-config.yaml')).toBe(false)
        expect(isChannelFile('DCC-Rail-Commander-Setup-0.1.0-x64.exe.blockmap')).toBe(false)
    })
})
