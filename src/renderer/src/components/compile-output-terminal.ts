import { resolve } from 'aurelia'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { ThemeService } from '../services/theme.service'

const DARK_THEME: ITheme = {
    background: '#111827',
    foreground: '#c9d1d9',
    cursor: '#111827',
    selectionBackground: '#264f78',
    black: '#111827',
    brightBlack: '#30363d',
}

const LIGHT_THEME: ITheme = {
    background: '#f9fafb',
    foreground: '#1f2937',
    cursor: '#f9fafb',
    selectionBackground: '#bfdbfe',
    black: '#f9fafb',
    brightBlack: '#9ca3af',
}

export class CompileOutputTerminalCustomElement {
    /** Container div xterm mounts into — set by ref="terminalEl" in template */
    terminalEl!: HTMLElement

    private readonly themeService = resolve(ThemeService)
    private term!: Terminal
    private fitAddon!: FitAddon
    private resizeObserver?: ResizeObserver
    private _unsubTheme: (() => void) | null = null
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
        this._unsubTheme?.()
        this._unsubTheme = null
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
     * reactive property change triggered it. CanvasAddon (loaded below) stays
     * in use despite this — the default DOM renderer has its own real bug:
     * it measures each glyph's actual rendered width and corrects with
     * per-span CSS letter-spacing to force alignment to the fixed cell grid,
     * and for the bundled Nerd Font at this size that correction swings wide
     * enough (several px on a 12px font) to visibly space characters apart.
     * The canvas renderer draws glyphs directly at their measured
     * positions, sidestepping that DOM-layout compensation entirely — so the
     * disposal bug above is the one being worked around (via the try/catch),
     * not avoided by dropping the addon.
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
            theme: this.themeService.effective === 'dark' ? DARK_THEME : LIGHT_THEME,
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
        this.term.loadAddon(new CanvasAddon())

        this._unsubTheme?.()
        this._unsubTheme = this.themeService.onChange((effective) => {
            this.term.options.theme = effective === 'dark' ? DARK_THEME : LIGHT_THEME
        })

        // disableStdin only blocks input, not selection — but with nothing to
        // send a browser's native Ctrl/Cmd+C never reaches this terminal, since
        // xterm doesn't otherwise treat that combo as a copy shortcut. Intercept
        // it directly: if there's an active selection, copy it and swallow the
        // event; otherwise fall through so xterm/the browser handle it as usual.
        this.term.attachCustomKeyEventHandler((event) => {
            if (event.type !== 'keydown') return true
            const isCopyChord = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c'
            if (!isCopyChord) return true
            const selection = this.term.getSelection()
            if (!selection) return true
            void navigator.clipboard.writeText(selection)
            return false
        })

        requestAnimationFrame(() => {
            this.fitAddon.fit()
        })

        this.resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => this.fitAddon?.fit())
        })
        this.resizeObserver.observe(this.terminalEl)
    }

    /**
     * Resolves once every write() queued so far has been fully parsed into the buffer.
     * xterm's Terminal.write() is asynchronous — during a large burst (e.g. a real,
     * non-incremental compile streaming hundreds of lines) the buffer can still be
     * mid-parse when getText() would otherwise read it immediately afterward, racing
     * ahead and returning partial or empty content. Await this before getText().
     */
    private pendingWrite: Promise<void> = Promise.resolve()

    /** Called imperatively via component.ref from workspace.ts — raw passthrough, preserves ANSI. */
    write(text: string): void {
        const term = this.term
        if (!term) return
        this.pendingWrite = this.pendingWrite.then(() => new Promise<void>((resolve) => {
            term.write(text, resolve)
        }))
    }

    /** Fully clears the screen and scrollback. */
    reset(): void {
        this.term?.reset()
    }

    /** Waits for all writes queued so far to finish before the caller reads the buffer. */
    async flush(): Promise<void> {
        await this.pendingWrite
    }

    /** Full buffer content (scrollback + screen) as plain text, ANSI stripped — used for copy-all/save-to-file. */
    getText(): string {
        if (!this.term) return ''
        const buffer = this.term.buffer.active
        const lines: string[] = []
        for (let i = 0; i < buffer.length; i++) {
            lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
        }
        while (lines.length && lines[lines.length - 1] === '') lines.pop()
        return lines.join('\n')
    }
}
