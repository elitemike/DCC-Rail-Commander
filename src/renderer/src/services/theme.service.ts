import { resolve } from 'aurelia'
import { PreferencesService } from './preferences.service'
import ej2DarkHref from '../styles/ej2-theme-dark.css?url'
import ej2LightHref from '../styles/ej2-theme-light.css?url'

export type ThemeMode = 'light' | 'dark' | 'system'
export type EffectiveTheme = 'light' | 'dark'

/** Read synchronously by index.html's inline bootstrap script to avoid a flash of the wrong theme on cold start — see that file. */
export const THEME_STORAGE_KEY = 'ex-installer-theme-effective'

const EJ2_LINK_ID = 'ej2-theme-stylesheet'

/**
 * App-wide Light/Dark/System theme. Persisted via PreferencesService (not
 * per-device). Applying a theme means three things, all handled here:
 *   1. Toggle `.dark` on <html> — Tailwind's `dark:` utilities key off this
 *      (see the `@custom-variant dark` override in styles.css).
 *   2. Swap the Syncfusion EJ2 stylesheet <link> between the light/dark
 *      builds — EJ2's two themes define the same global selectors, so both
 *      can't be loaded at once (see styles.css for why this isn't a
 *      static import).
 *   3. Notify subscribers (Monaco, xterm) that keep their own theme objects
 *      and need to re-theme already-mounted instances live.
 */
export class ThemeService {
    private readonly preferences = resolve(PreferencesService)
    private readonly media = window.matchMedia('(prefers-color-scheme: dark)')
    private readonly listeners = new Set<(effective: EffectiveTheme) => void>()
    private ej2Link: HTMLLinkElement | null = null
    private mediaListenerAttached = false

    mode: ThemeMode = 'dark'

    get effective(): EffectiveTheme {
        return this.mode === 'system' ? (this.media.matches ? 'dark' : 'light') : this.mode
    }

    /** Loads the persisted preference and applies it. Call once at startup. */
    async init(): Promise<void> {
        this.mode = (await this.preferences.get<ThemeMode>('theme')) ?? 'dark'
        this.apply()
        if (!this.mediaListenerAttached) {
            this.mediaListenerAttached = true
            this.media.addEventListener('change', () => {
                if (this.mode === 'system') this.apply()
            })
        }
    }

    /** Persists and applies a new mode — called from the Settings dialog. */
    async setMode(mode: ThemeMode): Promise<void> {
        this.mode = mode
        await this.preferences.set('theme', mode)
        this.apply()
    }

    /** Registers a callback fired with the new effective theme whenever it changes (including a 'system' OS-level flip). Returns an unsubscribe function. */
    onChange(callback: (effective: EffectiveTheme) => void): () => void {
        this.listeners.add(callback)
        return () => this.listeners.delete(callback)
    }

    private apply(): void {
        const effective = this.effective
        document.documentElement.classList.toggle('dark', effective === 'dark')
        // Syncfusion components (e.g. popup dropdowns rendered into <body>)
        // use this body class as their own dark-mode signal.
        document.body.classList.toggle('e-dark-mode', effective === 'dark')
        this.getEj2Link().href = effective === 'dark' ? ej2DarkHref : ej2LightHref
        try {
            localStorage.setItem(THEME_STORAGE_KEY, effective)
        } catch {
            // Storage can be unavailable (e.g. disabled) — the inline bootstrap
            // script just falls back to dark, matching today's default.
        }
        this.listeners.forEach((callback) => callback(effective))
    }

    private getEj2Link(): HTMLLinkElement {
        if (this.ej2Link) return this.ej2Link
        let link = document.getElementById(EJ2_LINK_ID) as HTMLLinkElement | null
        if (!link) {
            link = document.createElement('link')
            link.id = EJ2_LINK_ID
            link.rel = 'stylesheet'
            document.head.appendChild(link)
        }
        this.ej2Link = link
        return link
    }
}
