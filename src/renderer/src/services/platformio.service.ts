import type {
    PioPlatformInfo,
    DetectedBoardInfo,
    CompileResult,
    UploadResult,
} from '../../../types/ipc'

/** Wraps window.platformio (contextBridge API) for the renderer. */
export class PlatformIoService {
    async isRuntimeReady(): Promise<boolean> {
        return window.platformio.isRuntimeReady()
    }

    async seedRuntime(): Promise<{ success: boolean; error?: string }> {
        return window.platformio.seedRuntime()
    }

    async getVersion(): Promise<string | null> {
        return window.platformio.getVersion()
    }

    async getBundledVersion(): Promise<string> {
        return window.platformio.getBundledVersion()
    }

    async getPlatforms(): Promise<PioPlatformInfo[]> {
        return window.platformio.getPlatforms()
    }

    async checkToolchain(fqbn: string): Promise<{ installed: boolean; version: string | null }> {
        return window.platformio.checkToolchain(fqbn)
    }

    async listBoards(): Promise<DetectedBoardInfo[]> {
        return window.platformio.listBoards()
    }

    subscribeToProgress(cb: (payload: { phase: string; message: string }) => void): () => void {
        if (!window.platformio) return () => { }
        return window.platformio.onProgress(cb)
    }

    async compile(sketchPath: string, fqbn: string): Promise<CompileResult> {
        return window.platformio.compile(sketchPath, fqbn)
    }

    async upload(sketchPath: string, fqbn: string, port: string): Promise<UploadResult> {
        return window.platformio.upload(sketchPath, fqbn, port)
    }

    async browseToolchainPack(): Promise<string | null> {
        return window.platformio.browseToolchainPack()
    }

    async importToolchainPack(archivePath: string): Promise<{ success: boolean; error?: string }> {
        return window.platformio.importToolchainPack(archivePath)
    }
}
