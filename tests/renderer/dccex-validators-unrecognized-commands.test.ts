import { describe, it, expect, vi } from 'vitest'

// Minimal Monaco mock — findUnrecognizedExrailCommands doesn't touch Monaco directly, but the
// module it lives in imports monaco-editor at the top level, same as dccex-validators.test.ts.
vi.mock('monaco-editor', () => ({
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
        setModelMarkers: vi.fn(),
        getModels: () => [],
        onDidCreateModel: vi.fn(),
        getModelMarkers: () => [],
        onDidChangeMarkers: vi.fn(() => ({ dispose: vi.fn() })),
    },
}))

import { findUnrecognizedExrailCommands } from '../../src/renderer/src/config/dccex-validators'

describe('findUnrecognizedExrailCommands', () => {
    it('finds no issues in a file using only real EXRAIL commands', () => {
        const files = [
            { name: 'myAutomation.h', content: 'AUTOSTART SEQUENCE(1)\n  ONSENSOR(180)\n    IF(180) SET(200) ELSE RESET(200) ENDIF\n  DONE\nFOLLOW(1)\n' },
        ]
        expect(findUnrecognizedExrailCommands(files)).toEqual([])
    })

    it('flags ONBEFORE/ONAFTER — never valid EXRAIL syntax at any released CommandStation-EX version', () => {
        const files = [
            {
                name: 'myAutomation.h',
                content: [
                    'ONBEFORE(IR_SENSOR)',
                    '  SET(100)',
                    'DONE',
                    '',
                    'ONAFTER(IR_SENSOR)',
                    '  RESET(100)',
                    'DONE',
                ].join('\n'),
            },
        ]

        const found = findUnrecognizedExrailCommands(files)
        expect(found.map(f => f.command)).toEqual(['ONBEFORE', 'ONAFTER'])
        expect(found[0].fileName).toBe('myAutomation.h')
        expect(found[0].line).toBe(1)
        expect(found[1].line).toBe(5)
    })

    it('does not flag a real command used as a bare paren-less keyword (DONE) or a known block starter', () => {
        const files = [
            { name: 'myCustomExrail.h', content: 'AUTOMATION(5, "Test")\n  PRINT("hi")\nDONE\nFOLLOW(5)\n' },
        ]
        expect(findUnrecognizedExrailCommands(files)).toEqual([])
    })

    it('does not flag identifiers used only as arguments (aliases, ids) — only genuine command position', () => {
        const files = [
            { name: 'myAutomation.h', content: 'ALIAS(MY_SIG_GREEN, 100)\nSET(MY_SIG_GREEN)\nDONE\n' },
        ]
        expect(findUnrecognizedExrailCommands(files)).toEqual([])
    })

    it('ignores a commented-out unknown command', () => {
        const files = [
            { name: 'myAutomation.h', content: '// ONBEFORE(IR_SENSOR)\nAUTOSTART\nDONE\n' },
        ]
        expect(findUnrecognizedExrailCommands(files)).toEqual([])
    })

    it('scans every file passed in, not just myAutomation.h', () => {
        const files = [
            { name: 'myAutomation.h', content: 'AUTOSTART\nDONE\n' },
            { name: 'myAutomation_imported.h', content: 'ONBEFORE(IR_SENSOR)\nDONE\n' },
        ]
        const found = findUnrecognizedExrailCommands(files)
        expect(found).toEqual([{ fileName: 'myAutomation_imported.h', command: 'ONBEFORE', line: 1 }])
    })
})

describe('findUnrecognizedExrailCommands — real-world file regression', () => {
    it('flags only ONBEFORE/ONAFTER in the full real Gibson myAutomation.h content (no other false positives)', () => {
        const content = [
            '  HAL(PCA9685,100,16, {I2CMux_0, SubBus_7, 0x40})',
            '  HAL(PCF8574, 200,8, {I2CMux_0, SubBus_5, 0x23},-1, 255)',
            '  HAL(MCP23017, 180, 16, {I2CMux_0, SubBus_1, 0x21})',
            '  AUTOSTART',
            '  ONOVERLOAD(B)',
            '  POWEROFF',
            '  DONE',
            '  ONOVERLOAD(A)',
            '  SET_POWER( A,OFF )',
            '  DONE',
            '   SIGNAL(102, 0, 103)',
            '   SIGNAL(110,111,112)',
            'ALIAS(MY_SIG_GREEN, 100)',
            'ALIAS(MY_SIG_RED,   101)',
            'ALIAS(IR_SENSOR,    180)',
            '  SET(MY_SIG_GREEN)',
            '  RESET(MY_SIG_RED)',
            'DONE',
            'ONBEFORE(IR_SENSOR)',
            '  RESET(MY_SIG_GREEN)',
            '  LOOP(5)',
            '    SET(MY_SIG_RED)',
            '    DELAY(1000)',
            '    RESET(MY_SIG_RED)',
            '    DELAY(1000)',
            '  ENDLOOP',
            '  SET(MY_SIG_RED)',
            'DONE',
            'ONAFTER(IR_SENSOR)',
            '  LOOP(5)',
            '    RESET(MY_SIG_RED)',
            '    DELAY(1000)',
            '  ENDLOOP',
            '  DELAY(3000)',
            'DONE',
            'AUTOSTART SEQUENCE(95)',
            '  AT(29)',
            '  RESET(108)',
            '  SERVO(105, 375, Slow)',
            '  AT(-29)',
            '  BLINK(108, 500, 500)',
            '  SET(115)',
            '  DELAY(5000)',
            'FOLLOW(95)',
            'AUTOSTART SEQUENCE(180)',
            '  ONSENSOR(180)',
            '    IF(180)',
            '      SET(200)',
            '    ELSE',
            '      RESET(200)',
            '    ENDIF',
            '  DONE',
            'FOLLOW(180)',
            'AUTOMATION(89, "test gesture sensing")',
            '  IF(CAM 010)',
            '    ATTIMEOUT(CAM 011, 1000)',
            '    IFTIMEOUT',
            '    ELSE',
            '      PRINT("close")',
            '      DELAY(3000)',
            '    ENDIF',
            '  ENDIF',
            'FOLLOW(89)',
            'ROSTER(1232,"10 New ","Headlight/Bell")',
        ].join('\n')

        // LOOP/ENDLOOP are correctly flagged too — confirmed absent from CommandStation-EX's
        // EXRAILMacros.h entirely (real project's own invented "repeat N times" construct;
        // BLINK(vpin, onMs, offMs) is the real EXRAIL equivalent for a repeating blink).
        const found = findUnrecognizedExrailCommands([{ name: 'myAutomation.h', content }])
        expect(found.map(f => f.command)).toEqual(['ONBEFORE', 'LOOP', 'ENDLOOP', 'ONAFTER', 'LOOP', 'ENDLOOP'])
    })
})
