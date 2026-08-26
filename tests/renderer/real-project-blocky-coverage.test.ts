/**
 * Runs the real 15-file hand-written project (tests/fixtures/rosscoe-original/ — the exact
 * files this feature was built against) through the importer, then checks whether every
 * resulting ROUTE/SEQUENCE body can actually render in the visual Blocks canvas.
 *
 * parseBody() is all-or-nothing per body (see exrail-block-compiler.ts's own doc comment): one
 * unrecognized command, one `//` comment, one case mismatch anywhere in a body fails the whole
 * thing back to Raw-mode-only, with no partial rendering. This suite exists to answer, with real
 * numbers instead of a guess, "do any blockys not display" — expect real failures here. A failing
 * test in this file is a checklist entry for follow-up work, not a regression to silence.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { importExistingProject } from '../../src/renderer/src/models/project-importer'
import { parseRoutesFromFile, parseSequencesFromFile, parseAutomationsFromFile } from '../../src/renderer/src/utils/myAutomationParser'
import { parseBody } from '../../src/renderer/src/components/visual-editors/exrail-block-compiler'
import { BLOCK_REGISTRY } from '../../src/renderer/src/components/visual-editors/exrail-block-registry'

const FIXTURE_DIR = join(__dirname, '../fixtures/rosscoe-original')

function loadRealProject() {
    const names = readdirSync(FIXTURE_DIR)
    const files = names.map(name => ({ name, content: readFileSync(join(FIXTURE_DIR, name), 'utf-8') }))
    return importExistingProject(files)
}

describe('Real project fixture — sanity', () => {
    it('loads all 15 files and imports without throwing', () => {
        const names = readdirSync(FIXTURE_DIR)
        expect(names).toHaveLength(15)
        expect(() => loadRealProject()).not.toThrow()
    })
})

describe('Real project — every ROUTE body renders in the Blocks canvas', () => {
    const result = loadRealProject()
    const routesFile = result.configFiles.find(f => f.name === 'myRoutes.h')?.content ?? ''
    const routes = parseRoutesFromFile(routesFile)

    it('found at least one route to check', () => {
        expect(routes.length).toBeGreaterThan(0)
    })

    for (const route of routes) {
        it(`ROUTE(${route.id}) "${route.description}"`, () => {
            const parsed = parseBody(route.body, 'ROUTE', BLOCK_REGISTRY)
            expect(parsed.ok, !parsed.ok ? parsed.reason : undefined).toBe(true)
        })
    }
})

describe('Real project — every SEQUENCE body renders in the Blocks canvas', () => {
    const result = loadRealProject()
    const sequencesFile = result.configFiles.find(f => f.name === 'mySequences.h')?.content ?? ''
    const sequences = parseSequencesFromFile(sequencesFile)

    it('found at least one sequence to check', () => {
        expect(sequences.length).toBeGreaterThan(0)
    })

    for (const seq of sequences) {
        it(`SEQUENCE(${seq.id}) "${seq.description ?? ''}"`, () => {
            const parsed = parseBody(seq.body, 'SEQUENCE', BLOCK_REGISTRY)
            expect(parsed.ok, !parsed.ok ? parsed.reason : undefined).toBe(true)
        })
    }
})

describe('Real project — every AUTOMATION body renders in the Blocks canvas', () => {
    const result = loadRealProject()
    const automationsFile = result.configFiles.find(f => f.name === 'myAutomations.h')?.content ?? ''
    const automations = parseAutomationsFromFile(automationsFile)

    it('AUTOMATION blocks land in myAutomations.h, not myRoutes.h/mySequences.h/a leftover file', () => {
        // myAutomation_shunting.h declares 5 real AUTOMATION(...) blocks (ATM_COAL_TRUCKS_COLLECT,
        // _DELIVER, _LOAD, ATM_ES_LEFT_BAY, ATM_ES_RIGHT_BAY) — now merged into myAutomations.h
        // like ROUTE/SEQUENCE, not left behind in their originating file.
        const routesFile = result.configFiles.find(f => f.name === 'myRoutes.h')?.content ?? ''
        const sequencesFile = result.configFiles.find(f => f.name === 'mySequences.h')?.content ?? ''
        expect(routesFile).not.toContain('AUTOMATION(')
        expect(sequencesFile).not.toContain('AUTOMATION(')

        const shuntingLeftover = result.configFiles.find(f => f.name === 'myAutomation_shunting.h')?.content
        expect(shuntingLeftover === undefined || !shuntingLeftover.includes('AUTOMATION(')).toBe(true)

        expect(automations.length).toBeGreaterThan(0)
    })

    for (const automation of automations) {
        it(`AUTOMATION(${automation.id}) "${automation.description}"`, () => {
            const parsed = parseBody(automation.body, 'AUTOMATION', BLOCK_REGISTRY)
            expect(parsed.ok, !parsed.ok ? parsed.reason : undefined).toBe(true)
        })
    }
})
