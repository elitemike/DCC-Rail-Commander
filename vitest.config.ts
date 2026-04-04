import { defineConfig } from 'vitest/config'

export default defineConfig({
    // Aurelia 2 relies on legacy decorator semantics: class-field declarations
    // must NOT overwrite what decorators set.  Apply globally — harmless for
    // plain Node tests but required for any Aurelia ViewModel import.
    esbuild: {
        tsconfigRaw: {
            compilerOptions: {
                useDefineForClassFields: false,
                experimentalDecorators: true,
            },
        },
    },
    test: {
        environment: 'node',
        include: ['tests/main/**/*.test.ts', 'tests/renderer/**/*.test.ts'],
        exclude: ['tests/renderer/compile.integration.test.ts'],
        setupFiles: ['./vitest.setup-env.js'],
    },
})
