import { describe, it, expect, vi } from 'vitest'
import { createLineSplitter } from '../../src/renderer/src/utils/serial-line-buffer'

describe('createLineSplitter', () => {
    it('emits complete lines from a single chunk', () => {
        const onLine = vi.fn()
        const splitter = createLineSplitter(onLine)
        splitter.feed('<l 3 0 128 0>\r\n<p1>\r\n')
        expect(onLine).toHaveBeenNthCalledWith(1, '<l 3 0 128 0>')
        expect(onLine).toHaveBeenNthCalledWith(2, '<p1>')
    })

    it('buffers a partial trailing line until more data arrives', () => {
        const onLine = vi.fn()
        const splitter = createLineSplitter(onLine)
        splitter.feed('<l 3 0 12')
        expect(onLine).not.toHaveBeenCalled()
        splitter.feed('8 0>\r\n')
        expect(onLine).toHaveBeenCalledOnce()
        expect(onLine).toHaveBeenCalledWith('<l 3 0 128 0>')
    })

    it('handles bare \\n and \\r as line separators', () => {
        const onLine = vi.fn()
        const splitter = createLineSplitter(onLine)
        splitter.feed('a\nb\rc')
        expect(onLine).toHaveBeenNthCalledWith(1, 'a')
        expect(onLine).toHaveBeenNthCalledWith(2, 'b')
    })

    it('skips empty lines', () => {
        const onLine = vi.fn()
        const splitter = createLineSplitter(onLine)
        splitter.feed('\r\n\r\na\r\n')
        expect(onLine).toHaveBeenCalledOnce()
        expect(onLine).toHaveBeenCalledWith('a')
    })

    it('flush() emits a remaining partial line', () => {
        const onLine = vi.fn()
        const splitter = createLineSplitter(onLine)
        splitter.feed('<p1>')
        expect(onLine).not.toHaveBeenCalled()
        splitter.flush()
        expect(onLine).toHaveBeenCalledOnce()
        expect(onLine).toHaveBeenCalledWith('<p1>')
    })

    it('flush() is a no-op when the buffer is empty', () => {
        const onLine = vi.fn()
        const splitter = createLineSplitter(onLine)
        splitter.feed('a\n')
        onLine.mockClear()
        splitter.flush()
        expect(onLine).not.toHaveBeenCalled()
    })
})
