import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import aurelia from '@aurelia/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    // ── Main process ──────────────────────────────────────────────────────────
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            lib: {
                entry: resolve(__dirname, 'main/index.ts'),
            },
        },
    },

    // ── Preload script ────────────────────────────────────────────────────────
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            lib: {
                entry: resolve(__dirname, 'preload/index.ts'),
            },
        },
    },

    // ── Renderer (Aurelia 2 + Vite) ───────────────────────────────────────────
    renderer: {
        root: resolve(__dirname, 'renderer'),
        plugins: [
            tailwindcss(),
            aurelia({
                // Match files under renderer/src so the plugin filter resolves
                // correctly relative to process.cwd() (which is src/).
                include: resolve(__dirname, 'renderer/src/**/*.{ts,js,html}'),
                useDev: false,
            }),
        ],
        resolve: {
            alias: {
                '@renderer': resolve(__dirname, 'renderer/src'),
                '@services': resolve(__dirname, 'renderer/src/services'),
                '@components': resolve(__dirname, 'renderer/src/components'),
            },
        },
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'renderer/index.html'),
                },
            },
        },
    },
})
