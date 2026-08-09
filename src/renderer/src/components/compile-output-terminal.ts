import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'

export class CompileOutputTerminalCustomElement {
    /** Container div xterm mounts into — set by ref="terminalEl" in template */
    terminalEl!: HTMLElement

    private term!: Terminal
    private fitAddon!: FitAddon
    private resizeObserver?: ResizeObserver

    attached(): void {
        // xterm.js uses a canvas renderer — the font must be fully loaded before
        // Terminal.open() is called or character-cell measurements are taken
        // against the fallback font, producing visibly wrong glyph spacing.
        document.fonts.load('400 12px "JetBrains Mono NF"').finally(() => {
            this.initTerminal()
        })
    }

    detaching(): void {
        this.resizeObserver?.disconnect()
        this.term?.dispose()
    }

    private initTerminal(): void {
        this.term = new Terminal({
            theme: {
                background: '#111827',
                foreground: '#c9d1d9',
                cursor: '#111827',
                selectionBackground: '#264f78',
                black: '#111827',
                brightBlack: '#30363d',
            },
            fontFamily: '"JetBrains Mono NF", "JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
            fontSize: 12,
            lineHeight: 1.4,
            cursorBlink: false,
            disableStdin: true,
            screenReaderMode: true,
            scrollback: 5000,
            convertEol: true,
        })

        this.fitAddon = new FitAddon()
        this.term.loadAddon(this.fitAddon)
        this.term.loadAddon(new CanvasAddon())
        this.term.open(this.terminalEl)

        requestAnimationFrame(() => {
            this.fitAddon.fit()
        })

        this.resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => this.fitAddon?.fit())
        })
        this.resizeObserver.observe(this.terminalEl)
    }

    /** Called imperatively via component.ref from workspace.ts — raw passthrough, preserves ANSI. */
    write(text: string): void {
        this.term?.write(text)
    }

    /** Fully clears the screen and scrollback. */
    reset(): void {
        this.term?.reset()
    }
}
