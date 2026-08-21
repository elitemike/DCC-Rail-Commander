import { normalizeGeneratorTimestamp } from './myAutomationParser'
import { normalizeDeviceHeaderTimestamp } from './configHeaderParser'

export type FileChangeStatus = 'new' | 'changed' | 'unchanged'

/** Strips every known dynamic timestamp line so comparisons reflect real edits, not housekeeping. */
function normalizeForComparison(text: string): string {
    return normalizeDeviceHeaderTimestamp(normalizeGeneratorTimestamp(text))
}

export interface FileChangeEntry {
    name: string
    before: string
    after: string
    status: FileChangeStatus
}

export function computeFileChangeStatus(before: string | null, after: string): FileChangeStatus {
    if (before === null) return 'new'
    return before === after ? 'unchanged' : 'changed'
}

export async function buildFileChangeSet(
    configFiles: Array<{ name: string; content: string }>,
    roots: string[],
    readFile: (path: string) => Promise<string>,
    exists: (path: string) => Promise<boolean>,
): Promise<FileChangeEntry[]> {
    // Each file's before/after is independent, so resolve them concurrently —
    // this used to be a single sequential loop (files × roots IPC round-trips
    // in series), which is the dialog's dominant latency source on a slower
    // or antivirus-contended disk. Promise.all preserves configFiles' order.
    return Promise.all(
        configFiles.map(async (f) => {
            let before: string | null = null
            for (const root of roots) {
                const candidate = `${root}/${f.name}`
                if (await exists(candidate)) {
                    before = await readFile(candidate)
                    break
                }
            }
            // Normalize away dynamic timestamp lines before comparing — they're
            // rewritten to "now" on every save regardless of whether the user
            // made a real edit, so an unnormalized comparison would mark nearly
            // every managed file as changed every time.
            const normalizedBefore = before === null ? null : normalizeForComparison(before)
            const normalizedAfter = normalizeForComparison(f.content)
            return {
                name: f.name,
                before: normalizedBefore ?? '',
                after: normalizedAfter,
                status: computeFileChangeStatus(normalizedBefore, normalizedAfter),
            }
        }),
    )
}
