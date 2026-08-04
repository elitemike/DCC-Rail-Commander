import { describe, it, expect } from 'vitest'
import {
    extractVersionDetails,
    sortVersionsDescending,
    pickLatestVersion,
} from '../../src/renderer/src/models/product-details'

describe('extractVersionDetails', () => {
    it('parses major/minor/patch and type from a Prod tag', () => {
        expect(extractVersionDetails('v5.2.80-Prod')).toEqual({ major: 5, minor: 2, patch: 80, type: 'Prod' })
    })

    it('parses a Devel tag', () => {
        expect(extractVersionDetails('v5.3.0-Devel')).toEqual({ major: 5, minor: 3, patch: 0, type: 'Devel' })
    })

    it('defaults type to unknown when no suffix is present', () => {
        expect(extractVersionDetails('v0.6.0')).toEqual({ major: 0, minor: 6, patch: 0, type: 'unknown' })
    })

    it('returns all-zero unknown for a non-matching tag', () => {
        expect(extractVersionDetails('not-a-version')).toEqual({ major: 0, minor: 0, patch: 0, type: 'unknown' })
    })
})

describe('sortVersionsDescending', () => {
    it('sorts by major, then minor, then patch, newest first', () => {
        const tags = ['v5.2.80-Prod', 'v5.10.0-Prod', 'v5.2.9-Prod', 'v6.0.0-Devel', 'v5.2.80-Devel']
        expect(sortVersionsDescending(tags)).toEqual([
            'v6.0.0-Devel',
            'v5.10.0-Prod',
            'v5.2.80-Prod',
            'v5.2.80-Devel',
            'v5.2.9-Prod',
        ])
    })

    it('does not mutate the input array', () => {
        const tags = ['v1.0.0-Prod', 'v2.0.0-Prod']
        const copy = [...tags]
        sortVersionsDescending(tags)
        expect(tags).toEqual(copy)
    })

    it('returns an empty array for empty input', () => {
        expect(sortVersionsDescending([])).toEqual([])
    })
})

describe('pickLatestVersion', () => {
    it('picks the newest Prod tag over a newer Devel tag', () => {
        const sorted = sortVersionsDescending(['v5.2.80-Prod', 'v5.10.0-Devel', 'v5.2.9-Prod'])
        expect(pickLatestVersion(sorted)).toBe('v5.2.80-Prod')
    })

    it('falls back to the newest tag when no Prod tag exists', () => {
        const sorted = sortVersionsDescending(['v5.2.80-Devel', 'v5.10.0-Devel'])
        expect(pickLatestVersion(sorted)).toBe('v5.10.0-Devel')
    })

    it('returns null for an empty list', () => {
        expect(pickLatestVersion([])).toBeNull()
    })
})
