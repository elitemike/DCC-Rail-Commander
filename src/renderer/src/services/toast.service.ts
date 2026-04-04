/**
 * A lightweight DOM-based toast service that does not depend on Syncfusion's
 * Toast widget internals.  It uses the same CSS class names (.e-toast-container,
 * .e-toast, .e-toast-close-icon, .e-toast-warning / .e-toast-success /
 * .e-toast-danger) so existing e2e selectors continue to work.
 *
 * Exported as both a plain function (showToast) and a class (ToastService) that
 * delegates to it.  The function is a module-level singleton — no DI required.
 */

export interface ToastOptions {
    title?: string
    content?: string
    cssClass?: string
    timeOut?: number
    showCloseButton?: boolean
}

// ── Module-level container (created once, persisted across calls) ────────────
let _container: HTMLElement | null = null

function _getContainer(): HTMLElement {
    if (!_container || !document.body.contains(_container)) {
        _container = document.createElement('div')
        _container.className = 'e-toast-container e-toast-util e-toast-bottom-right'
        document.body.appendChild(_container)
    }
    return _container
}

function _remove(el: HTMLElement): void {
    if (el.parentNode) el.parentNode.removeChild(el)
}

/** Show a toast notification.  Can be called from anywhere — no DI needed. */
export function showToast(options: ToastOptions = {}): void {
    const container = _getContainer()

    const toast = document.createElement('div')
    toast.className = ['e-toast', options.cssClass].filter(Boolean).join(' ')
    toast.setAttribute('role', 'alert')

    const inner = document.createElement('div')
    inner.className = 'e-toast-message'

    if (options.title) {
        const titleEl = document.createElement('div')
        titleEl.className = 'e-toast-title'
        titleEl.textContent = options.title
        inner.appendChild(titleEl)
    }

    if (options.content) {
        const contentEl = document.createElement('div')
        contentEl.className = 'e-toast-content'
        contentEl.textContent = options.content
        inner.appendChild(contentEl)
    }

    toast.appendChild(inner)

    if (options.showCloseButton !== false) {
        const closeBtn = document.createElement('button')
        closeBtn.className = 'e-toast-close-icon'
        closeBtn.setAttribute('aria-label', 'Close')
        closeBtn.textContent = '×'
        closeBtn.addEventListener('click', () => _remove(toast))
        toast.appendChild(closeBtn)
    }

    container.appendChild(toast)

    const timeout = options.timeOut ?? 5000
    if (timeout > 0) {
        setTimeout(() => _remove(toast), timeout)
    }
}

/**
 * ToastService class — thin wrapper around showToast().
 * Registered as a singleton in main.ts so it can be resolved via DI if needed.
 */
export class ToastService {
    show(options: ToastOptions = {}): void {
        showToast(options)
    }
}
