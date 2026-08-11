import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

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
        // These are externalised CommonJS packages, and Vitest no longer applies
        // a test file's vi.mock('<pkg>', …) to the source modules that import
        // them. Aliasing keeps them inside the module graph so those mocks take
        // effect everywhere — see tests/stubs/README.md.
        alias: Object.fromEntries(
            ['electron', 'python-shell', 'simple-git', 'serialport', 'usb', 'tar'].map((pkg) => [
                pkg,
                fileURLToPath(new URL(`./tests/stubs/${pkg}.ts`, import.meta.url)),
            ]),
        ),
        include: ['tests/main/**/*.test.ts', 'tests/renderer/**/*.test.ts'],
        exclude: ['tests/renderer/compile.integration.test.ts'],
        setupFiles: ['./vitest.setup-env.js'],
    },
})
