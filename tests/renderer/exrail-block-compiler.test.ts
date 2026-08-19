import { describe, it, expect } from 'vitest'
import { parseBody, compileBody, type ParsedGraph } from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'
import { BLOCK_REGISTRY } from '../../src/renderer/src/components/visual-editors/exrail-block-registry'

function parseOk(body: string, kind: 'route' | 'sequence' = 'route'): ParsedGraph {
    const result = parseBody(body, kind, BLOCK_REGISTRY)
    if (!result.ok) throw new Error(`expected parse to succeed, got: ${result.reason}`)
    return result.graph
}

describe('parseBody / compileBody round-trip', () => {
    it('round-trips a flat stack sequence', () => {
        const body = 'THROW(200)\nCLOSE(201)\nDELAY(500)'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('round-trips TOGGLE_TURNOUT', () => {
        const body = 'TOGGLE_TURNOUT(200)\nDELAY(500)'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('round-trips a single IF/ENDIF', () => {
        const body = 'IF(1)\n  THROW(200)\nENDIF'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('round-trips IF/ELSE/ENDIF', () => {
        const body = 'IF(1)\n  THROW(200)\nELSE\n  CLOSE(200)\nENDIF'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('round-trips a nested IF inside IF', () => {
        const body = 'IF(1)\n  IF(2)\n    THROW(200)\n  ENDIF\nENDIF'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('round-trips a stack followed by a FOLLOW terminal cap', () => {
        const body = 'THROW(200)\nFOLLOW(5)'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('round-trips a DONE nested inside a branch', () => {
        const body = 'IF(1)\n  DONE\nENDIF'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('round-trips a chain that continues after an ENDIF', () => {
        const body = 'IF(1)\n  THROW(200)\nENDIF\nCLOSE(201)'
        const graph = parseOk(body)
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('allows an empty body (no statements)', () => {
        const graph = parseOk('')
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe('')
    })

    it('parses an alias identifier as a ref param value, not NaN', () => {
        const body = 'THROW(mysidingpoint)\nCLOSE(201)'
        const graph = parseOk(body)
        const throwNode = graph.nodes.find((n) => n.info.blockTypeId === 'THROW')
        expect(throwNode?.info.paramValues.turnoutId).toBe('mysidingpoint')
        expect(compileBody(graph, BLOCK_REGISTRY)).toBe(body)
    })

    it('parses a numeric ref param value as a number', () => {
        const graph = parseOk('THROW(200)')
        const throwNode = graph.nodes.find((n) => n.info.blockTypeId === 'THROW')
        expect(throwNode?.info.paramValues.turnoutId).toBe(200)
    })

    it('graph structure is preserved through parseBody(compileBody(graph))', () => {
        const body = 'IF(1)\n  THROW(200)\nELSE\n  CLOSE(200)\nENDIF\nDELAY(100)'
        const graph = parseOk(body)
        const reparsed = parseOk(compileBody(graph, BLOCK_REGISTRY))
        expect(reparsed.nodes.map((n) => n.info.blockTypeId)).toEqual(graph.nodes.map((n) => n.info.blockTypeId))
        expect(reparsed.nodes.map((n) => n.info.paramValues)).toEqual(graph.nodes.map((n) => n.info.paramValues))
    })
})

describe('parseBody failure modes', () => {
    it('rejects an unbalanced ENDIF', () => {
        const result = parseBody('THROW(200)\nENDIF', 'route', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/ENDIF/)
    })

    it('rejects a stray ELSE', () => {
        const result = parseBody('ELSE\nTHROW(200)', 'route', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/ELSE/)
    })

    it('rejects an unknown command', () => {
        const result = parseBody('FROBNICATE(1)', 'route', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/FROBNICATE/)
    })

    it('rejects a missing ENDIF', () => {
        const result = parseBody('IF(1)\n  THROW(200)', 'route', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/ENDIF/)
    })

    it('rejects mis-cased commands rather than silently correcting them', () => {
        const result = parseBody('Throw(200)', 'route', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/case-sensitive/)
    })

    it('rejects a wrong argument count', () => {
        const result = parseBody('THROW(200, 201)', 'route', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/THROW/)
    })

    it('rejects a body containing a comment rather than dropping it silently', () => {
        const result = parseBody('THROW(200) // yard switch', 'route', BLOCK_REGISTRY)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toMatch(/omment/)
    })

    // Fuzz coverage for "an unknown word must never crash the parser" — see
    // exrail-block-canvas.ts's parseError fallback, which depends on parseBody() always
    // returning rather than throwing, no matter how garbled the input.
    it('never throws on random unknown words, whatever shape they take', () => {
        const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-. "()/\\'
        function randomWord(maxLen: number): string {
            const len = 1 + Math.floor(Math.random() * maxLen)
            let s = ''
            for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]
            return s
        }
        function randomBody(): string {
            const lineCount = 1 + Math.floor(Math.random() * 5)
            const lines: string[] = []
            for (let i = 0; i < lineCount; i++) {
                const word = randomWord(15)
                lines.push(Math.random() < 0.5 ? word : `${word}(${randomWord(8)}, ${randomWord(8)})`)
            }
            return lines.join('\n')
        }

        for (let i = 0; i < 300; i++) {
            const body = randomBody()
            let result: ReturnType<typeof parseBody>
            expect(() => { result = parseBody(body, Math.random() < 0.5 ? 'route' : 'sequence', BLOCK_REGISTRY) }).not.toThrow()
            expect(typeof result!.ok).toBe('boolean')
            if (!result!.ok) expect(typeof result!.reason).toBe('string')
        }
    })
})
