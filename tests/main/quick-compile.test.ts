/**
 * Unit tests for main/quick-compile.ts — the pure helpers Quick Compile uses to
 * filter a PlatformIO compile_commands.json down to the user's own sketch files
 * and parse compiler diagnostics out of raw stdout/stderr. No fs/child_process
 * involved — see platformio.ts's quickCompile() for the orchestration that
 * actually spawns processes.
 */
import { describe, it, expect } from 'vitest'
import {
    filterSketchEntries,
    toSyntaxOnlyCommand,
    parseDiagnostics,
    dedupeDiagnostics,
    type CompileDbEntry,
} from '../../src/main/quick-compile'

function entry(file: string, command = `g++ -o ${file}.o -c ${file}`): CompileDbEntry {
    return { directory: '/scratch/CommandStation-EX', command, file }
}

describe('filterSketchEntries', () => {
    it('keeps bare-filename entries — the user\'s own project-root source', () => {
        const entries = [entry('config.h'), entry('DCC.cpp'), entry('CommandDistributor.cpp')]
        expect(filterSketchEntries(entries).map((e) => e.file)).toEqual(['config.h', 'DCC.cpp', 'CommandDistributor.cpp'])
    })

    it('excludes entries under the bundled framework/library packages (absolute paths)', () => {
        const entries = [
            entry('config.h'),
            entry('/home/user/dcc-rail-commander/platformio/packages/framework-arduinoespressif32/cores/esp32/Esp.cpp'),
            entry('/home/user/source/DCC-Rail-Commander/resources/pio-libs/Ethernet/src/Ethernet.cpp'),
        ]
        expect(filterSketchEntries(entries).map((e) => e.file)).toEqual(['config.h'])
    })

    it('excludes the Arduino-preprocessed <Sketch>.ino.cpp wrapper', () => {
        const entries = [entry('config.h'), entry('CommandStation-EX.ino.cpp')]
        expect(filterSketchEntries(entries).map((e) => e.file)).toEqual(['config.h'])
    })

    it('is case-insensitive about the .ino.cpp suffix', () => {
        expect(filterSketchEntries([entry('Sketch.INO.CPP')])).toEqual([])
    })
})

describe('toSyntaxOnlyCommand', () => {
    it('appends -fsyntax-only to the compiledb command', () => {
        expect(toSyntaxOnlyCommand('g++ -o out.o -c config.h')).toBe('g++ -o out.o -c config.h -fsyntax-only')
    })
})

describe('parseDiagnostics', () => {
    it('parses a real GCC error line', () => {
        const output = "config.h:15:1: error: expected unqualified-id before 'this'\n this is not valid C++ syntax !!!\n ^~~~"
        expect(parseDiagnostics(output)).toEqual([
            { file: 'config.h', line: 15, column: 1, severity: 'error', message: "expected unqualified-id before 'this'" },
        ])
    })

    it('parses a warning line distinctly from an error', () => {
        const output = 'DCC.cpp:42:10: warning: unused variable \'x\' [-Wunused-variable]'
        expect(parseDiagnostics(output)).toEqual([
            { file: 'DCC.cpp', line: 42, column: 10, severity: 'warning', message: "unused variable 'x' [-Wunused-variable]" },
        ])
    })

    it('ignores "In file included from" context lines and caret/underline noise', () => {
        const output = [
            'In file included from defines.h:32,',
            '                 from DCCRMT.cpp:40:',
            "config.h:15:1: error: expected unqualified-id before 'this'",
            ' this is not valid C++ syntax !!!',
            ' ^~~~',
        ].join('\n')
        expect(parseDiagnostics(output)).toEqual([
            { file: 'config.h', line: 15, column: 1, severity: 'error', message: "expected unqualified-id before 'this'" },
        ])
    })

    it('returns an empty array for clean output', () => {
        expect(parseDiagnostics('Compiling .pio/build/ESP32/src/DCC.cpp.o\n')).toEqual([])
    })

    it('strips ANSI color codes before matching', () => {
        const output = '[01m[Kconfig.h:15:1:[m[K [01;31m[Kerror: [m[Kexpected \';\''
        expect(parseDiagnostics(output)).toEqual([
            { file: 'config.h', line: 15, column: 1, severity: 'error', message: "expected ';'" },
        ])
    })
})

describe('dedupeDiagnostics', () => {
    it('collapses the same (file, line, message) reported across many included-from chains', () => {
        const d = { file: 'config.h', line: 15, column: 1, severity: 'error' as const, message: "expected ';'" }
        const cascaded = [d, { ...d, column: 3 }, { ...d, column: 7 }]
        expect(dedupeDiagnostics(cascaded)).toEqual([d])
    })

    it('keeps distinct diagnostics on different lines or with different messages', () => {
        const a = { file: 'config.h', line: 15, column: 1, severity: 'error' as const, message: 'first' }
        const b = { file: 'config.h', line: 16, column: 1, severity: 'error' as const, message: 'first' }
        const c = { file: 'config.h', line: 15, column: 1, severity: 'error' as const, message: 'second' }
        expect(dedupeDiagnostics([a, b, c])).toEqual([a, b, c])
    })
})
