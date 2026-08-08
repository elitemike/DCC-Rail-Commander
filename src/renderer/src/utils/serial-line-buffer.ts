/**
 * Buffers raw serial chunks into complete lines, holding back a trailing
 * partial line until more data arrives (or `flush()` is called) so a
 * `<l ...>` response split across two `usb:data` events isn't handed to the
 * caller as two malformed fragments.
 */
export function createLineSplitter(onLine: (line: string) => void): {
    feed(chunk: string): void
    flush(): void
} {
    let buffer = ''
    return {
        feed(chunk: string): void {
            buffer += chunk
            const lines = buffer.split(/\r\n|\r|\n/)
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                if (line.length > 0) onLine(line)
            }
        },
        flush(): void {
            if (buffer.length > 0) onLine(buffer)
            buffer = ''
        },
    }
}
