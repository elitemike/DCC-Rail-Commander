/**
 * The app version stamped into generated config headers must always be package.json's `version` —
 * it's injected at build time (`__APP_VERSION__`), not maintained by hand.
 */
import { describe, it, expect } from 'vitest'
import pkg from '../../package.json'
import { InstallerState } from '../../src/renderer/src/models/installer-state'

describe('app version', () => {
    it('InstallerState reports package.json’s version', () => {
        expect(new InstallerState().appVersion).toBe(pkg.version)
    })
})
