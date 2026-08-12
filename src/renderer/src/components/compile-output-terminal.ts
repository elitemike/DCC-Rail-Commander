import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export class CompileOutputTerminalCustomElement {
    /** Container div xterm mounts into — set by ref="terminalEl" in template */
    terminalEl!: HTMLElement

    private term!: Terminal
    private fitAddon!: FitAddon
    private resizeObserver?: ResizeObserver
    /**
     * Guards the deferred initTerminal() below. document.fonts.load() can
     * resolve after this component has been torn down and re-attached one or
     * more times (e.g. rapid tab switching) — a plain boolean flag isn't
     * enough here, because a *newer* attached() resets it before an *older*
     * attached()'s pending callback checks it, letting the stale callback
     * slip through and call initTerminal() again on top of the current
     * terminal. Each attached()/detaching() bumps this counter, and a
     * deferred callback only proceeds if it's still the current generation.
     */
    private _attachGeneration = 0

    attached(): void {
        const generation = ++this._attachGeneration
        // xterm.js uses a canvas renderer — the font must be fully loaded before
        // Terminal.open() is called or character-cell measurements are taken
        // against the fallback font, producing visibly wrong glyph spacing.
        document.fonts.load('400 12px "JetBrains Mono NF"').finally(() => {
            if (generation !== this._attachGeneration) return
            this.initTerminal()
        })
    }

    detaching(): void {
        this._attachGeneration++
        this.resizeObserver?.disconnect()
        this.disposeTerminal()
    }

    /**
     * xterm's own dispose() can throw. Traced this down to
     * @xterm/addon-canvas's CanvasAddon: it registers a disposal hook that
     * calls the terminal's private `_core._createRenderer()` to reinstate the
     * default DOM renderer once the canvas renderer goes away, and building
     * that fallback renderer (`new DomRenderer` → `new Linkifier`) throws
     * ("Cannot read properties of undefined (reading 'onShowLinkUnderline')")
     * if the terminal's core services aren't in a fully consistent state —
     * easy to hit when a terminal is disposed very soon after creation, which
     * rapid tab switching does constantly. That's a real bug inside the
     * addon's disposal ordering, not something guardable from here, and left
     * unguarded it aborts detaching() mid-flight, which can abort whatever
     * reactive property change triggered it. CanvasAddon (loaded below) was
     * dropped rather than chasing the addon's internal disposal bug further —
     * it's a rendering optimisation we don't need for a low-throughput
     * compile-log terminal.
     */
    private disposeTerminal(): void {
        try {
            this.term?.dispose()
        } catch {
            // Already torn down as far as we're concerned — nothing to recover.
        }
    }

    private initTerminal(): void {
        this.resizeObserver?.disconnect()
        this.disposeTerminal()

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
