import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import aurelia from '@aurelia/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

export default defineConfig({
    // ── Main process ──────────────────────────────────────────────────────────
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            lib: {
                entry: resolve(__dirname, 'src/main/index.ts'),
            },
        },
    },

    // ── Preload script ────────────────────────────────────────────────────────
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            lib: {
                entry: resolve(__dirname, 'src/preload/index.ts'),
            },
        },
    },

    // ── Renderer (Aurelia 2 + Vite) ───────────────────────────────────────────
    renderer: {
        root: resolve(__dirname, 'src/renderer'),
        plugins: [
            tailwindcss(),
            aurelia({
                // Use a relative POSIX-style glob so the plugin matches on Windows and WSL.
                // The plugin resolves paths relative to process.cwd(), so keep this relative.
                include: 'src/renderer/src/**/*.{ts,js,html}',
                useDev: false,
            }),
            (monacoEditorPlugin as unknown as typeof monacoEditorPlugin.default).default({
                languageWorkers: ['editorWorkerService'],
                // Ensure the plugin writes worker files into the resolved `outDir` on Windows.
                // This avoids joining an absolute/drive-prefixed segment onto the renderer root.
                customDistPath: (root, outDir, base) => {
                    // outDir provided by electron-vite is already absolute; use it directly.
                    return resolve(outDir, 'monacoeditorwork');
                },
            }),
        ],
        resolve: {
            alias: {
                '@renderer': resolve(__dirname, 'src/renderer/src'),
                '@services': resolve(__dirname, 'src/renderer/src/services'),
                '@components': resolve(__dirname, 'src/renderer/src/components'),
                // Force all Aurelia imports to resolve to the single node_modules copy
                // to avoid duplicate runtime instances on Windows.
                'aurelia': resolve(__dirname, 'node_modules', 'aurelia'),
                '@aurelia': resolve(__dirname, 'node_modules', '@aurelia'),
            },
        },
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/renderer/index.html'),
                },
            },
        },
    },
})
