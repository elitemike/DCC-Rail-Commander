import type { LocalHistorySnapshot } from '../../../types/ipc'

export type { LocalHistorySnapshot }

/**
 * LocalHistoryService
 *
 * Wraps window.localHistory (contextBridge API) for the renderer. This is a local-only,
 * per-project version history for config file content — see src/main/local-history.ts for why
 * it exists and why it's deliberately never written into the user's project folder.
 */
export class LocalHistoryService {
    async record(projectKey: string, fileName: string, content: string): Promise<void> {
        return window.localHistory.record(projectKey, fileName, content)
    }

    async list(projectKey: string, fileName: string): Promise<LocalHistorySnapshot[]> {
        return window.localHistory.list(projectKey, fileName)
    }
}
