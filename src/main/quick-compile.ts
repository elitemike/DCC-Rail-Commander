/**
 * Pure helpers for Quick Compile — a syntax-only check of the user's own sketch
 * files, run automatically after every Save (when the preference is on). See
 * `PlatformIoService.quickCompile()` in `platformio.ts`, which orchestrates
 * these against a real `compile_commands.json` and real compiler processes.
 *
 * Kept side-effect-free (no fs/child_process) so the filtering and diagnostic
 * parsing can be unit-tested against fixture data without spawning a compiler
 * or a PlatformIO project.
 */

import type { QuickCompileDiagnostic } from '../types/ipc'

/** One entry of a PlatformIO-generated `compile_commands.json`. */
export interface CompileDbEntry {
    directory: string
    command: string
    file: string
}

/**
 * Every entry whose `file` is a bare relative filename (no `/` or `\`) lives at
 * the project root — PlatformIO's `src_dir = .` convention (see
 * `writeProjectConfig()`) — which is exactly the user's own sketch source
 * (config.h, myAutomation.h, any custom EXRAIL file, and the product's own
 * `.cpp` files). Every other entry lives under an absolute path into the
 * bundled framework/library packages and is deliberately excluded — checking
 * those is what a real Compile is for.
 *
 * The one bare-filename entry that's still excluded is `<Sketch>.ino.cpp` —
 * the Arduino-preprocessed wrapper. Unlike every other project-root entry,
 * compiledb only *describes* it; PlatformIO doesn't actually write it to disk
 * until a real build has run at least once for that environment, and where it
 * ends up is a builder-internal detail that differs across platforms
 * (confirmed empirically: running the compiledb command as-is against the
 * bare name it reports fails with "No such file or directory" on a project
 * that's never been compiled for real). It's also not something the user
 * edits directly through this app — every real product ships other `.cpp`
 * files that `#include` the same headers (config.h, myAutomation.h, ...), so
 * skipping just this one entry loses no real coverage.
 */
export function filterSketchEntries(entries: CompileDbEntry[]): CompileDbEntry[] {
    return entries.filter((e) => !e.file.includes('/') && !e.file.includes('\\') && !/\.ino\.cpp$/i.test(e.file))
}

/** Appends `-fsyntax-only` to a compiledb command — parses+typechecks with the real compiler, no codegen/link. */
export function toSyntaxOnlyCommand(command: string): string {
    return `${command} -fsyntax-only`
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*[A-Za-z]/g

/** Matches a GCC/Clang diagnostic line, e.g. `config.h:15:1: error: expected unqualified-id before 'this'`. */
const DIAGNOSTIC_LINE = /^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.+)$/

/**
 * Parses every `file:line:col: error|warning: message` line out of a compiler's
 * combined stdout+stderr. Multi-line context (`In file included from ...`,
 * caret/underline lines) is ignored — only the diagnostic's own line is a real
 * error location; everything else is include-chain context pointing at it.
 */
export function parseDiagnostics(output: string): QuickCompileDiagnostic[] {
    const diagnostics: QuickCompileDiagnostic[] = []
    for (const rawLine of output.split(/\r\n|\r|\n/)) {
        const line = rawLine.replace(ANSI, '')
        const match = DIAGNOSTIC_LINE.exec(line)
        if (!match) continue
        const [, file, lineNo, col, severity, message] = match
        diagnostics.push({
            file: file.replace(/^\.\//, ''),
            line: Number(lineNo),
            column: Number(col),
            severity: severity as 'error' | 'warning',
            message: message.trim(),
        })
    }
    return diagnostics
}

/**
 * A broken header cascades into the same `file:line: error` across every
 * translation unit that includes it (directly or transitively) — dedupe by
 * the (file, line, message) the diagnostic actually points at, keeping the
 * first occurrence's column.
 */
export function dedupeDiagnostics(diagnostics: QuickCompileDiagnostic[]): QuickCompileDiagnostic[] {
    const seen = new Map<string, QuickCompileDiagnostic>()
    for (const d of diagnostics) {
        const key = `${d.file}:${d.line}:${d.message}`
        if (!seen.has(key)) seen.set(key, d)
    }
    return [...seen.values()]
}
