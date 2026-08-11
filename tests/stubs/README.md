# Test module stubs

`electron`, `python-shell`, `simple-git`, `serialport` and `usb` are CommonJS
packages that Vitest externalises. Since Vitest 4.1 a `vi.mock('<pkg>', …)`
factory declared in a test file no longer reaches the *source* modules that
import that package — they receive an empty namespace and blow up with "Cannot
read properties of undefined", or (worse) run against the real package.

Aliasing each of them to a local stub (see `vitest.config.ts`) keeps them inside
Vitest's module graph so the mocks apply everywhere.

These stubs deliberately implement nothing: every test that needs behaviour
declares its own `vi.mock()` with just the surface it exercises. A stub only has
to export the right *names*.
