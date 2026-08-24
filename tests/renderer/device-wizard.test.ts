import { describe, it, expect, vi } from 'vitest'
import { DeviceWizard } from '../../src/renderer/src/components/device-wizard'

// ── Factory ───────────────────────────────────────────────────────────────────
// Built like tests/renderer/device-picker-dialog.test.ts: a bare prototype
// instance with fields assigned manually, avoiding a full Aurelia DI bootstrap.

function makeWizard(opts: { repoExists: boolean; checkoutSuccess?: boolean }) {
    const wizard = Object.create(DeviceWizard.prototype) as DeviceWizard

    const git = {
        checkout: vi.fn().mockResolvedValue({ success: opts.checkoutSuccess ?? true }),
        pull: vi.fn().mockResolvedValue({ success: true }),
        clone: vi.fn().mockResolvedValue({ success: true }),
        listTags: vi.fn().mockResolvedValue(['1.0.0', '2.0.0']),
    }
    const files = {
        getInstallDir: vi.fn().mockResolvedValue('/home/user/ex-commander/repos'),
        exists: vi.fn().mockResolvedValue(opts.repoExists),
    }

    Object.assign(wizard, {
        git,
        files,
        selectedProduct: 'ex_commandstation',
        versions: [],
        selectedVersion: null,
        versionBusy: false,
        versionStatus: '',
        versionError: null,
    })

    return { wizard, git, files }
}

describe('DeviceWizard.loadVersions', () => {
    it('checks out the default branch before pulling an existing repo', async () => {
        // Regression: a prior device setup checks out a version tag (device-wizard.ts
        // confirm step), leaving the repo in detached HEAD. Pulling straight away then
        // fails with git's "You are not currently on a branch" error. Returning to the
        // default branch first keeps `pull` working on repeat setups.
        const { wizard, git } = makeWizard({ repoExists: true })

        await wizard.loadVersions()

        expect(git.checkout).toHaveBeenCalledWith(expect.stringContaining('CommandStation-EX'), 'master')
        expect(git.pull).toHaveBeenCalled()
        expect(git.clone).not.toHaveBeenCalled()
        expect(wizard.versionError).toBeNull()
        expect(wizard.versions).toHaveLength(2)
    })

    it('surfaces an error if returning to the default branch fails', async () => {
        const { wizard, git } = makeWizard({ repoExists: true, checkoutSuccess: false })

        await wizard.loadVersions()

        expect(git.pull).not.toHaveBeenCalled()
        expect(wizard.versionError).toBeTruthy()
    })

    it('clones instead of pulling when the repo does not exist yet', async () => {
        const { wizard, git } = makeWizard({ repoExists: false })

        await wizard.loadVersions()

        expect(git.clone).toHaveBeenCalled()
        expect(git.checkout).not.toHaveBeenCalled()
        expect(git.pull).not.toHaveBeenCalled()
        expect(wizard.versionError).toBeNull()
    })
})
