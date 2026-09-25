/**
 * Release notes arrive as HTML from GitHub's releases feed. The renderer's CSP allows inline
 * scripts and the preload bridge exposes file-system/serial access, so that HTML must never reach
 * the live DOM as-is. It's parsed into an inert document (DOMParser never runs scripts or loads
 * resources), filtered against an allowlist, and the resulting nodes are moved into the target
 * directly — no serialise-and-reparse step for a crafted payload to exploit.
 */

/** Elements kept (attributes stripped). Anything not listed here or in DROPPED is unwrapped to its children. */
const ALLOWED = new Set([
    'P', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'CODE', 'PRE', 'BLOCKQUOTE', 'A',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DETAILS', 'SUMMARY',
])

/** Elements removed together with everything inside them. */
const DROPPED = new Set([
    'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
    'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'MATH', 'IMG', 'PICTURE',
    'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS',
])

function sanitizeChildren(parent: Node): void {
    for (const child of Array.from(parent.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) continue
        if (child.nodeType !== Node.ELEMENT_NODE) {
            child.remove() // comments, processing instructions, …
            continue
        }
        const el = child as Element
        const tag = el.tagName.toUpperCase()
        if (DROPPED.has(tag)) {
            el.remove()
            continue
        }
        sanitizeChildren(el)
        if (!ALLOWED.has(tag)) {
            el.replaceWith(...Array.from(el.childNodes))
            continue
        }
        const href = tag === 'A' ? el.getAttribute('href') : null
        for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name)
        if (href && /^https?:\/\//i.test(href.trim())) {
            // target=_blank routes the click through the main process's setWindowOpenHandler,
            // which opens it in the OS browser instead of navigating the app window.
            el.setAttribute('href', href.trim())
            el.setAttribute('target', '_blank')
            el.setAttribute('rel', 'noopener noreferrer')
        }
    }
}

/** Replaces `target`'s contents with the sanitized rendering of `html`. */
export function renderReleaseNotes(html: string, target: Element): void {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    sanitizeChildren(parsed.body)
    target.replaceChildren(...Array.from(parsed.body.childNodes))
}
