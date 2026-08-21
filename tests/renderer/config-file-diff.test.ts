import { describe, it, expect, vi } from 'vitest'
import { buildFileChangeSet, computeFileChangeStatus } from '../../src/renderer/src/utils/config-file-diff'

describe('computeFileChangeStatus', () => {
    it('returns "new" when the file does not exist on disk', () => {
        expect(computeFileChangeStatus(null, 'anything')).toBe('new')
    })

    it('returns "unchanged" when on-disk content matches the new content', () => {
        expect(computeFileChangeStatus('same', 'same')).toBe('unchanged')
    })

    it('returns "changed" when on-disk content differs from the new content', () => {
        expect(computeFileChangeStatus('old', 'new')).toBe('changed')
    })
})

describe('buildFileChangeSet', () => {
    it('reads from the first root that has the file and stops checking further roots', async () => {
        const exists = vi.fn(async (p: string) => p === '/source/myRoster.h')
        const readFile = vi.fn(async () => 'roster-from-source')

        const result = await buildFileChangeSet(
            [{ name: 'myRoster.h', content: 'roster-from-source' }],
            ['/source', '/scratch'],
            readFile,
            exists,
        )

        expect(result).toEqual([
            { name: 'myRoster.h', before: 'roster-from-source', after: 'roster-from-source', status: 'unchanged' },
        ])
        expect(exists).toHaveBeenCalledWith('/source/myRoster.h')
        expect(exists).not.toHaveBeenCalledWith('/scratch/myRoster.h')
        expect(readFile).toHaveBeenCalledTimes(1)
    })

    it('falls through to the next root when the file is missing on an earlier one', async () => {
        const exists = vi.fn(async (p: string) => p === '/scratch/myTurnouts.h')
        const readFile = vi.fn(async () => 'turnouts-from-scratch')

        const result = await buildFileChangeSet(
            [{ name: 'myTurnouts.h', content: 'turnouts-updated' }],
            ['/source', '/scratch'],
            readFile,
            exists,
        )

        expect(result).toEqual([
            { name: 'myTurnouts.h', before: 'turnouts-from-scratch', after: 'turnouts-updated', status: 'changed' },
        ])
    })

    it('marks a file as "new" with empty "before" when absent from every root', async () => {
        const exists = vi.fn(async () => false)
        const readFile = vi.fn(async () => '')

        const result = await buildFileChangeSet(
            [{ name: 'myNewFile.h', content: 'brand new content' }],
            ['/source', '/scratch'],
            readFile,
            exists,
        )

        expect(result).toEqual([{ name: 'myNewFile.h', before: '', after: 'brand new content', status: 'new' }])
        expect(readFile).not.toHaveBeenCalled()
    })

    it('preserves the input file order in the returned entries', async () => {
        const exists = vi.fn(async () => true)
        const readFile = vi.fn(async (p: string) => `content-of-${p}`)

        const result = await buildFileChangeSet(
            [
                { name: 'a.h', content: 'a' },
                { name: 'b.h', content: 'b' },
                { name: 'c.h', content: 'c' },
            ],
            ['/root'],
            readFile,
            exists,
        )

        expect(result.map((f) => f.name)).toEqual(['a.h', 'b.h', 'c.h'])
    })

    it('treats a file whose generator header timestamp is the only difference as "unchanged"', async () => {
        // buildGeneratorHeader() stamps a fresh "Last saved" line on every
        // syncAll() regardless of real edits — the diff-set builder must not
        // let that alone mark the file as changed.
        const before = [
            '// =============================================================================',
            '// DCCEX-Installer v0.1.0',
            '// This file (myRoster.h) is managed by EX-Installer — manual edits are preserved',
            '// but may be reformatted on the next save. See https://dcc-ex.com for docs.',
            '// Last saved: 2026-08-20T10:00:00.000Z',
            '// =============================================================================',
            'ROSTER(3, "Thomas", "LIGHT/HORN")',
        ].join('\n')
        const after = before.replace('2026-08-20T10:00:00.000Z', '2026-08-21T00:03:30.777Z')

        const exists = vi.fn(async () => true)
        const readFile = vi.fn(async () => before)

        const result = await buildFileChangeSet(
            [{ name: 'myRoster.h', content: after }],
            ['/root'],
            readFile,
            exists,
        )

        expect(result[0].status).toBe('unchanged')
    })

    it('treats config.h as "unchanged" when only the device-header "Updated" timestamp differs', async () => {
        const before = [
            '// ==== DCCEX-Installer Device Configuration ====',
            '//   Name:     Arduino Mega 2560',
            '//   Port:     /dev/ttyACM1',
            '//   FQBN:     arduino:avr:mega',
            '//   Protocol: serial',
            '//   Updated:  2026-08-20T10:00:00.000Z',
            '// ==== DCCEX-Installer Device Configuration ====',
            '#define MAIN_DRIVER_MOTOR_SHIELD STANDARD_MOTOR_SHIELD',
        ].join('\n')
        const after = before.replace('2026-08-20T10:00:00.000Z', '2026-08-21T00:03:30.777Z')

        const exists = vi.fn(async () => true)
        const readFile = vi.fn(async () => before)

        const result = await buildFileChangeSet([{ name: 'config.h', content: after }], ['/root'], readFile, exists)

        expect(result[0].status).toBe('unchanged')
    })

    it('still marks a file as "changed" when real content differs, independent of the timestamp', async () => {
        const before = [
            '// Last saved: 2026-08-20T10:00:00.000Z',
            'ROSTER(3, "Thomas", "LIGHT/HORN")',
        ].join('\n')
        const after = [
            '// Last saved: 2026-08-21T00:03:30.777Z',
            'ROSTER(3, "Thomas", "LIGHT/HORN/BELL")',
        ].join('\n')

        const exists = vi.fn(async () => true)
        const readFile = vi.fn(async () => before)

        const result = await buildFileChangeSet(
            [{ name: 'myRoster.h', content: after }],
            ['/root'],
            readFile,
            exists,
        )

        expect(result[0].status).toBe('changed')
    })
})
