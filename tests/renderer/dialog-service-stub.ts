import { vi } from 'vitest'

/**
 * Stand-in for Aurelia's IDialogService that answers every dialog the same way. Pass 'ok' to
 * simulate clicking the confirm button, 'cancel' to simulate dismissing it. `open` is a spy,
 * so a test can assert the dialog was shown (and with what title/message).
 */
export function makeDialogService(status: 'ok' | 'cancel') {
    return {
        open: vi.fn().mockResolvedValue({ dialog: { closed: Promise.resolve({ status }) } }),
    }
}
