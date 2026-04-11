import {
    bindable,
    BindingMode,
    ICustomElementViewModel,
    resolve,
} from 'aurelia'
import * as monaco from 'monaco-editor'
import { getCompletions } from '../config/file-configs'
import { registerDiagnosticProviders, revalidateModel } from '../config/dccex-validators'
import { ConfigEditorState } from '../models/config-editor-state'
import { buildExrailSymbolSuggestions, isExrailCompletionFile } from '../utils/exrail-completions'

// ── Global filename-aware completion + hover providers (registered once) ──────
// Stored on `window` so Vite HMR module re-evaluation cannot reset the flag.
const WIN = window as Window & {
    __dccexProvidersRegistered?: boolean
    __dccexConfigEditorState?: ConfigEditorState
}

function registerProviders(): void {
    if (WIN.__dccexProvidersRegistered) return
    WIN.__dccexProvidersRegistered = true

    // Diagnostic markers (squiggles) for macro argument validation
    registerDiagnosticProviders()

    // Completion — returns snippets for the file currently open in this model
    monaco.languages.registerCompletionItemProvider('cpp', {
        provideCompletionItems(model, position) {
            const filename = model.uri.path.replace(/^\//, '')
            const snippets = getCompletions(filename)

            const word = model.getWordUntilPosition(position)
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            }

            const suggestions: monaco.languages.CompletionItem[] = snippets.map(s => ({
                label: s.label,
                kind: s.insertText.includes('(')
                    ? monaco.languages.CompletionItemKind.Function
                    : monaco.languages.CompletionItemKind.Keyword,
                detail: s.detail,
                documentation: s.documentation,
                insertText: s.insertText,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
            }))

            // For myRoster.h: also offer #define identifiers already in the file
            // so users can reference a named function list defined above a ROSTER call.
            if (filename === 'myRoster.h') {
                const text = model.getValue()
                const defineRe = /^#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+"([^"]*)"/gm
                let dm: RegExpExecArray | null
                while ((dm = defineRe.exec(text)) !== null) {
                    suggestions.push({
                        label: dm[1],
                        kind: monaco.languages.CompletionItemKind.Variable,
                        detail: `#define — "${dm[2].slice(0, 60)}${dm[2].length > 60 ? '…' : ''}"`,
                        documentation: `Defined function list: "${dm[2]}"`,
                        insertText: dm[1],
                        range,
                    })
                }
            }

            if (isExrailCompletionFile(filename) && WIN.__dccexConfigEditorState) {
                const linePrefix = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: 1,
                    endColumn: position.column,
                })

                const state = WIN.__dccexConfigEditorState
                const dynamicSuggestions = buildExrailSymbolSuggestions(filename, linePrefix, {
                    aliases: state.aliases,
                    roster: state.roster,
                    turnouts: state.turnouts,
                    sensors: state.sensors,
                    routes: state.routes,
                    sequences: state.sequences,
                })

                suggestions.push(
                    ...dynamicSuggestions.map(s => ({
                        label: s.label,
                        kind: s.kind === 'alias'
                            ? monaco.languages.CompletionItemKind.Variable
                            : monaco.languages.CompletionItemKind.Constant,
                        detail: s.detail,
                        documentation: s.documentation,
                        insertText: s.insertText,
                        sortText: s.sortText,
                        range,
                    })),
                )
            }

            return { suggestions }
        },
    })

    // Hover — looks up hover doc from the same config for the active file
    monaco.languages.registerHoverProvider('cpp', {
        provideHover(model, position) {
            const filename = model.uri.path.replace(/^\//, '')
            const snippets = getCompletions(filename)
            const word = model.getWordAtPosition(position)
            if (!word) return null

            const match = snippets.find(s => s.label === word.word)
            if (!match?.hover) return null

            const h = match.hover
            const contents: monaco.IMarkdownString[] = [
                { value: `**${h.title}**` },
                { value: h.description },
            ]
            if (h.example) contents.push({ value: `\`\`\`cpp\n${h.example}\n\`\`\`` })
            if (h.note) contents.push({ value: h.note })
            return { contents }
        },
    })
}

/**
 * `<monaco-editor>` — Aurelia custom element wrapping Monaco editor.
 *
 * Bindables:
 *   value        — two-way string binding (current editor text)
 *   language     — Monaco language id  (default: 'cpp')
 *   readonly     — boolean             (default: false)
 *   filename     — hint for completions (optional)
 *
 * Emits `change` event with updated text each time content changes (debounced).
 */
export class MonacoEditorCustomElement implements ICustomElementViewModel {
    private readonly configEditorState = resolve(ConfigEditorState)
    @bindable({ mode: BindingMode.twoWay }) value = ''
    @bindable language = 'cpp'
    @bindable readonly = false
    @bindable filename = ''
    /** Called directly (no DOM event) each time the debounced content changes. */
    @bindable onTextChange: ((text: string) => void) | null = null

    private container!: HTMLElement
    private editor: monaco.editor.IStandaloneCodeEditor | null = null
    private model: monaco.editor.ITextModel | null = null
    private changeDisposable: monaco.IDisposable | null = null
    private isUpdatingFromBinding = false
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    private _ro: ResizeObserver | null = null

    attached(): void {
        try { console.debug('MonacoEditor attached', { filename: this.filename, containerRect: this.container?.getBoundingClientRect?.() }) } catch { }
        WIN.__dccexConfigEditorState = this.configEditorState
        registerProviders()

        // Define a custom theme based on vs-dark that explicitly sets the
        // squiggle foreground colors. Monaco's registerThemingParticipant
        // only injects SVG squiggle CSS when getColor(editorErrorForeground)
        // returns non-null. In bundled Electron file:// contexts the built-in
        // vs-dark theme sometimes omits those color tokens, so we supply them
        // here to guarantee the CSS is emitted through Monaco's own pipeline.
        // Monaco v0.55.1 renders squiggles via CSS variables:
        //   border-bottom: 4px double var(--vscode-editorError-border)
        // Those variables are only emitted by the theming system when the
        // corresponding color token is non-null in the active theme.  The
        // built-in vs-dark theme omits them in bundled Electron file://
        // contexts, so we define our own theme that explicitly supplies them.
        monaco.editor.defineTheme('dccex-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editorError.foreground': '#f14c4c',
                'editorError.border': '#f14c4c',
                'editorWarning.foreground': '#cca700',
                'editorWarning.border': '#cca700',
                'editorInfo.foreground': '#75beff',
                'editorInfo.border': '#75beff',
                'editorHint.foreground': '#eeeee4',
                'editorHint.border': '#eeeee4',
            },
        })

        // Use a URI based on filename so completion/hover providers can identify
        // which file is active and return the correct per-file suggestions.
        const uri = this.filename
            ? monaco.Uri.file(this.filename)
            : undefined

        // Reuse an existing model for this URI if one already exists (e.g. the
        // same file re-opened after navigation), otherwise create a fresh one.
        this.model = uri
            ? monaco.editor.getModel(uri) ?? monaco.editor.createModel(this.value ?? '', this.language, uri)
            : monaco.editor.createModel(this.value ?? '', this.language)

        // Sync value in case the model was reused with stale content
        if (this.model.getValue() !== (this.value ?? '')) {
            this.model.setValue(this.value ?? '')
        }

        // Ensure document.body has the monaco-editor class so overflow widgets
        // (autocomplete, hover cards) are styled correctly when mounted there.
        if (!document.body.classList.contains('monaco-editor')) {
            document.body.classList.add('monaco-editor')
        }

        this.editor = monaco.editor.create(this.container, {
            model: this.model,
            theme: 'dccex-dark',
            language: this.language,
            readOnly: this.readonly,
            automaticLayout: true,
            fontSize: 13,
            lineHeight: 20,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            renderLineHighlight: 'all',
            bracketPairColorization: { enabled: true },
            scrollbar: {
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
            },
            // Mount overflow widgets (autocomplete, hover cards) on document.body
            // so they are never clipped by ancestor elements with overflow:hidden
            // or stacking contexts near the top of the viewport.
            fixedOverflowWidgets: true,
            overflowWidgetsDomNode: document.body,
        })

        try {
            const rect = this.container.getBoundingClientRect()
            console.debug('MonacoEditor container rect after create', { w: rect.width, h: rect.height })
            // Temporary visual debug aid: outline/background so we can see whether
            // the editor container is sized and visible in the app. Remove if noisy.
            try {
                this.container.style.outline = '1px solid rgba(0,255,0,0.25)'
                this.container.style.background = 'rgba(255,0,0,0.02)'
            } catch { }
        } catch (e) { /* ignore */ }

        try { console.debug('MonacoEditor model uri, hasEditor', { uri: this.model?.uri?.toString?.(), hasEditor: !!this.editor }) } catch { }

        // Force layout after the DOM has fully settled (fixes height:100% chains in flex)
        requestAnimationFrame(() => this.editor?.layout())
        setTimeout(() => this.editor?.layout(), 50)

        // If the container has zero size at attach time (e.g. hidden by parent
        // flex or awaiting layout), observe it and trigger layout when it
        // obtains a non-zero size. Use ResizeObserver when available.
        try {
            if (typeof ResizeObserver !== 'undefined') {
                this._ro = new ResizeObserver(() => {
                    try { this.editor?.layout() } catch { /* ignore */ }
                })
                this._ro.observe(this.container)
            } else {
                const onResize = () => { try { this.editor?.layout() } catch { } }
                window.addEventListener('resize', onResize)
                this._ro = { disconnect: () => window.removeEventListener('resize', onResize) } as unknown as ResizeObserver
            }
        } catch (e) {
            /* ignore */
        }

        // Re-validate after edge layout and Monaco's internal decoration pipeline
        // are both ready. We must fire AFTER the 50ms layout setTimeout above, and
        // after Monaco's MarkerDecorationsService has subscribed to onMarkerChanged
        // (which happens asynchronously post-editor.create). The clear→set pattern
        // guarantees onMarkerChanged fires even when markers are already cached on
        // the model from a prior onDidCreateModel call.
        const modelToValidate = this.model
        const editorInstance = this.editor
        setTimeout(() => {
            if (!modelToValidate || !editorInstance) return
            // Clear first so onMarkerChanged fires unconditionally, then re-set.
            monaco.editor.setModelMarkers(modelToValidate, 'dccex-validator', [])
            revalidateModel(modelToValidate, editorInstance)
        }, 100)

        // Propagate editor changes → binding
        this.changeDisposable = this.model.onDidChangeContent(() => {
            if (this.isUpdatingFromBinding) return
            if (this.debounceTimer) clearTimeout(this.debounceTimer)
            this.debounceTimer = setTimeout(() => {
                const text = this.model!.getValue()
                this.value = text
                this.onTextChange?.(text)
                this.container.dispatchEvent(
                    new CustomEvent('change', { detail: text, bubbles: true }),
                )
            }, 300)
        })
    }

    /**
     * Immediately cancels the debounce and pushes the current editor text into
     * the two-way `value` binding. Returns the current editor text so callers
     * can use it directly without relying on the two-way binding having
     * propagated yet (Aurelia's binding flush may be deferred).
     */
    flush(): string {
        if (!this.model) return this.value
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
        const text = this.model.getValue()
        if (this.value !== text) {
            this.value = text
            this.onTextChange?.(text)
            this.container?.dispatchEvent(
                new CustomEvent('change', { detail: text, bubbles: true }),
            )
        }
        return text
    }

    detaching(): void {
        // Flush any pending debounced change before the element is removed from
        // the DOM.  This fires the 'change' event one final time so that parent
        // components (e.g. roster-editor, turnout-editor) receive the latest
        // text through their normal change.trigger handler — regardless of
        // whether teardown was triggered by a tab switch, route change, etc.
        this.flush()
        this.changeDisposable?.dispose()
        this.editor?.dispose()
        // Only dispose the text model if it has no URI — URI models are cached by
        // Monaco and reused on re-attach, so disposing them causes a re-create
        // on the next visit and accumulates stale state.
        if (!this.model?.uri.path || this.model.uri.path === '/') {
            this.model?.dispose()
        }
        this.editor = null
        this.model = null
    }

    // Binding changed externally → push into editor without triggering change event
    valueChanged(newValue: string): void {
        if (!this.model) return
        const current = this.model.getValue()
        if (current === newValue) return
        this.isUpdatingFromBinding = true
        this.model.setValue(newValue ?? '')
        this.isUpdatingFromBinding = false
    }

    readonlyChanged(val: boolean): void {
        this.editor?.updateOptions({ readOnly: val })
    }

    languageChanged(lang: string): void {
        if (this.model) {
            monaco.editor.setModelLanguage(this.model, lang)
        }
    }
}
