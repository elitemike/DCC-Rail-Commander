import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The VS Code Playwright extension (and anyone running `playwright test` directly)
// skips the `pnpm build` step that `pnpm test:e2e` normally does first, which lets
// tests silently run against a stale out/ bundle. Rebuild here whenever src/ (or the
// electron-vite config) is newer than the last build output, so `out/` is always fresh
// no matter how the test run was launched.
const ROOT = join(__dirname, '..', '..')
const BUILD_ENTRY = join(ROOT, 'out', 'main', 'index.js')
const WATCHED = [join(ROOT, 'src'), join(ROOT, 'electron.vite.config.ts')]

function newestMtime(path: string): number {
    const stat = statSync(path)
    if (!stat.isDirectory()) return stat.mtimeMs
    let newest = stat.mtimeMs
    for (const entry of readdirSync(path)) {
        newest = Math.max(newest, newestMtime(join(path, entry)))
    }
    return newest
}

export default async function globalSetup(): Promise<void> {
    const buildMtime = existsSync(BUILD_ENTRY) ? statSync(BUILD_ENTRY).mtimeMs : 0
    const sourceMtime = Math.max(...WATCHED.map(newestMtime))

    if (sourceMtime > buildMtime) {
        console.log('[e2e] Source changed since last build — running `pnpm build`...')
        execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' })
    }
}
