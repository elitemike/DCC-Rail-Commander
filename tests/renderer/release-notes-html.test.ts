// @vitest-environment jsdom
/**
 * Unit tests for utils/release-notes-html.ts — GitHub release notes HTML must
 * render as readable prose without ever carrying script into the renderer.
 */
import { describe, it, expect } from 'vitest'
import { renderReleaseNotes } from '../../src/renderer/src/utils/release-notes-html'

function render(html: string): HTMLElement {
    const target = document.createElement('div')
    renderReleaseNotes(html, target)
    return target
}

describe('renderReleaseNotes', () => {
    it('keeps ordinary Markdown-rendered formatting', () => {
        const html =
            '<h2>Highlights</h2><ul><li><strong>New</strong> <em>thing</em> with <code>code</code></li></ul><p>Done.</p>'
        expect(render(html).innerHTML).toBe(html)
    })

    it('replaces existing content rather than appending', () => {
        const target = document.createElement('div')
        target.innerHTML = '<p>old</p>'
        renderReleaseNotes('<p>new</p>', target)
        expect(target.innerHTML).toBe('<p>new</p>')
    })

    it('drops scripts, styles, frames and images along with their content', () => {
        const out = render(
            '<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="https://x"></iframe>' +
                '<img src=x onerror="alert(1)"><svg><script>alert(1)</script></svg><p>b</p>',
        )
        expect(out.innerHTML).toBe('<p>a</p><p>b</p>')
    })

    it('strips every attribute, including event handlers and inline styles', () => {
        const out = render('<p onclick="alert(1)" style="color:red" class="x" id="y">hi</p>')
        expect(out.innerHTML).toBe('<p>hi</p>')
    })

    it('unwraps unknown elements but keeps their text', () => {
        const out = render('<div><span data-x="1">kept</span> <marquee>too</marquee></div>')
        expect(out.innerHTML).toBe('kept too')
    })

    it('opens http(s) links externally', () => {
        const link = render('<a href="https://github.com/x" title="t">x</a>').querySelector('a')!
        expect(link.getAttribute('href')).toBe('https://github.com/x')
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toBe('noopener noreferrer')
        expect(link.hasAttribute('title')).toBe(false)
    })

    it('removes non-http link targets such as javascript: and file:', () => {
        for (const href of ['javascript:alert(1)', ' JavaScript:alert(1)', 'file:///C:/x', 'data:text/html,x', '#frag']) {
            const link = render(`<a href="${href}">x</a>`).querySelector('a')!
            expect(link.hasAttribute('href')).toBe(false)
            expect(link.textContent).toBe('x')
        }
    })

    it('removes comments', () => {
        expect(render('<p>a<!-- hidden --></p>').innerHTML).toBe('<p>a</p>')
    })

    it('treats plain text as text', () => {
        expect(render('1 < 2 & done').textContent).toBe('1 < 2 & done')
    })
})
