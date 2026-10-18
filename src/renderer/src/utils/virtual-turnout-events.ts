/**
 * Keeps a VIRTUAL turnout's EXRAIL event handlers in step with its tree children.
 *
 * A VIRTUAL turnout has no hardware; whatever it should do is written in myEvents.h as
 *
 *     ONCLOSE(300)
 *     CLOSE(200)
 *     CLOSE(201)
 *     DONE
 *
 * (and the same with ONTHROW/THROW). When a turnout is placed under virtual turnout 300 in the
 * tree, any such handler that already exists gets a matching CLOSE()/THROW() line; when the child
 * leaves, is deleted or is renumbered, the line goes (or follows). If the parent has no ONCLOSE
 * and/or no ONTHROW handler yet, the missing one is created — placing a turnout under a virtual
 * turnout in the tree is what wires it up, so the user never has to write the handlers by hand.
 *
 * Aliases: a turnout that has an alias (myAliases.h) is written by that name —
 * `ONCLOSE(YARD_HUB)` / `CLOSE(MAIN_JUNCTION)` — falling back to the number. Existing handlers
 * are recognised in either spelling, so a hand-written `ONCLOSE(300)` and a generated
 * `ONCLOSE(YARD_HUB)` are the same handler. The `alias` argument everywhere below maps a turnout
 * id to its alias name ('' when it has none).
 *
 * A handler is only touched when *every* header line of its block is the same ON<CMD>(parent):
 * stacked headers for other triggers (ONCLOSE(300) + ONCLOSE(301) sharing one body) mean the body
 * isn't this parent's alone, so editing it would also change the other trigger.
 */

import type { EventHandlerEntry } from './myAutomationParser'

export interface ParentChildPair {
    parentId: number
    childId: number
}

/**
 * Maps a turnout id to its alias name; '' when it has none. May return several names (current and
 * previous) when *matching* existing text — the first non-empty one is what gets written.
 */
export type AliasLookup = (id: number) => string | string[]

const namesOf = (alias: AliasLookup, id: number): string[] => {
    const v = alias(id)
    return (Array.isArray(v) ? v : [v]).map(n => n.trim()).filter(Boolean)
}

const noAlias: AliasLookup = () => ''

/** ONCLOSE drives CLOSE(), ONTHROW drives THROW(). */
const ACTION_FOR: Record<string, 'CLOSE' | 'THROW'> = { ONCLOSE: 'CLOSE', ONTHROW: 'THROW' }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** How `id` is written in generated EXRAIL: its alias if it has one, else the number. */
const ref = (id: number, alias: AliasLookup) => namesOf(alias, id)[0] ?? String(id)

/** Regex source matching `id` spelled as its number or as its alias. */
function idPattern(id: number, alias: AliasLookup): string {
    const names = namesOf(alias, id)
    return names.length ? `(?:${id}|${names.map(escapeRe).join('|')})` : String(id)
}

/** The CLOSE/THROW action a handler block runs for `parentId`, or null if it isn't solely that parent's. */
function ownedAction(handler: EventHandlerEntry, parentId: number, alias: AliasLookup): 'CLOSE' | 'THROW' | null {
    const header = new RegExp(`^\\s*(ONCLOSE|ONTHROW)\\s*\\(\\s*${idPattern(parentId, alias)}\\s*\\)\\s*$`)
    const anyHeader = /^\s*ON[A-Z0-9_]*\s*(?:\([^)]*\))?\s*$/
    let action: 'CLOSE' | 'THROW' | null = null
    let headers = 0
    for (const line of handler.text.split('\n')) {
        if (!anyHeader.test(line)) break // first non-header line starts the body
        const m = line.match(header)
        if (!m) return null // a header for some other trigger shares this body
        const a = ACTION_FOR[m[1]]
        if (action && action !== a) return null
        action = a
        headers++
    }
    return headers > 0 ? action : null
}

const actionLine = (action: string, id: number, alias: AliasLookup) =>
    new RegExp(`^\\s*${action}\\s*\\(\\s*${idPattern(id, alias)}\\s*\\)\\s*$`)

function addAction(text: string, action: 'CLOSE' | 'THROW', childId: number, alias: AliasLookup): string {
    const lines = text.split('\n')
    const re = actionLine(action, childId, alias)
    if (lines.some(l => re.test(l))) return text

    // Insert above the closing DONE (the normal shape), otherwise at the end of the block.
    let at = lines.length
    while (at > 0 && lines[at - 1].trim() === '') at--
    if (at > 0 && lines[at - 1].trim() === 'DONE') at--

    const prev = lines[at - 1] ?? ''
    const indent = /^\s*ON[A-Z0-9_]*\s*\(/.test(prev) ? '' : (prev.match(/^\s*/)?.[0] ?? '')
    lines.splice(at, 0, `${indent}${action}(${ref(childId, alias)})`)
    return lines.join('\n')
}

function removeAction(text: string, action: 'CLOSE' | 'THROW', childId: number, alias: AliasLookup): string {
    const re = actionLine(action, childId, alias)
    return text.split('\n').filter(l => !re.test(l)).join('\n')
}

function editHandlers(
    handlers: EventHandlerEntry[],
    parentId: number,
    alias: AliasLookup,
    edit: (text: string, action: 'CLOSE' | 'THROW') => string,
): EventHandlerEntry[] {
    let changed = false
    const next = handlers.map(h => {
        const action = ownedAction(h, parentId, alias)
        if (!action) return h
        const text = edit(h.text, action)
        if (text === h.text) return h
        changed = true
        return { ...h, text }
    })
    return changed ? next : handlers
}

/** True if `handlers` has an ONCLOSE/ONTHROW block wired to virtual turnout `parentId`. */
export function hasVirtualEvents(handlers: EventHandlerEntry[], parentId: number, alias: AliasLookup = noAlias): boolean {
    return handlers.some(h => ownedAction(h, parentId, alias) !== null)
}

/**
 * Adds CLOSE(child)/THROW(child) to the parent's handlers, creating the ONCLOSE(parent) and/or
 * ONTHROW(parent) handler first if it doesn't exist. Returns the same array if nothing changed.
 */
export function addChildToVirtualEvents(
    handlers: EventHandlerEntry[],
    parentId: number,
    childId: number,
    alias: AliasLookup = noAlias,
): EventHandlerEntry[] {
    let result = handlers
    for (const command of ['ONCLOSE', 'ONTHROW']) {
        const exists = result.some(h => ownedAction(h, parentId, alias) === ACTION_FOR[command])
        if (!exists) result = [...result, { command, text: `${command}(${ref(parentId, alias)})\nDONE` }]
    }
    return editHandlers(result, parentId, alias, (text, action) => addAction(text, action, childId, alias))
}

/** Removes CLOSE(child)/THROW(child) from the parent's handlers. Returns the same array if nothing changed. */
export function removeChildFromVirtualEvents(
    handlers: EventHandlerEntry[],
    parentId: number,
    childId: number,
    alias: AliasLookup = noAlias,
): EventHandlerEntry[] {
    return editHandlers(handlers, parentId, alias, (text, action) => removeAction(text, action, childId, alias))
}

export interface VirtualEventStatus {
    /** The parent has an ONCLOSE handler it solely owns. */
    hasClose: boolean
    /** The parent has an ONTHROW handler it solely owns. */
    hasThrow: boolean
    /** Children whose CLOSE()/THROW() line is missing from one of those handlers (or a handler is missing). */
    missing: number[]
}

/** How well `handlers` cover virtual turnout `parentId`'s tree children — drives the editor's hint. */
export function virtualEventStatus(
    handlers: EventHandlerEntry[],
    parentId: number,
    childIds: number[],
    alias: AliasLookup = noAlias,
): VirtualEventStatus {
    const owned = (a: 'CLOSE' | 'THROW') => handlers.filter(h => ownedAction(h, parentId, alias) === a)
    const close = owned('CLOSE')
    const thr = owned('THROW')
    const covers = (list: EventHandlerEntry[], a: string, id: number) => {
        const re = actionLine(a, id, alias)
        return list.some(h => h.text.split('\n').some(l => re.test(l)))
    }
    const missing = childIds.filter(id => !covers(close, 'CLOSE', id) || !covers(thr, 'THROW', id))
    return { hasClose: close.length > 0, hasThrow: thr.length > 0, missing }
}

interface TurnoutLike {
    id: number
    type?: string
    parentId?: number
}

/** Every (virtual parent, child) link in a turnout list. */
export function parentChildPairs(turnouts: TurnoutLike[]): ParentChildPair[] {
    return turnouts
        .filter(t => t.parentId !== undefined)
        .map(t => ({ parentId: t.parentId as number, childId: t.id }))
}

/**
 * Applies the difference between two turnout lists to the event handlers: links that appeared are
 * added, links that disappeared are removed. A link lost only because its parent was deleted,
 * renumbered or turned into another kind is left alone — the handler still names the old id, and
 * deleting its lines would destroy the user's work for no reason.
 */
export function syncVirtualEvents(
    handlers: EventHandlerEntry[],
    before: TurnoutLike[],
    after: TurnoutLike[],
    alias: AliasLookup = noAlias,
): EventHandlerEntry[] {
    const key = (p: ParentChildPair) => `${p.parentId}:${p.childId}`
    const beforePairs = parentChildPairs(before)
    const afterPairs = parentChildPairs(after)
    const beforeKeys = new Set(beforePairs.map(key))
    const afterKeys = new Set(afterPairs.map(key))
    const parentsAfter = new Set(after.filter(t => t.type === 'VIRTUAL').map(t => t.id))

    let result = handlers
    for (const p of beforePairs) {
        if (afterKeys.has(key(p)) || !parentsAfter.has(p.parentId)) continue
        result = removeChildFromVirtualEvents(result, p.parentId, p.childId, alias)
    }
    for (const p of afterPairs) {
        if (beforeKeys.has(key(p))) continue
        result = addChildToVirtualEvents(result, p.parentId, p.childId, alias)
    }
    return result
}

/**
 * Rewrites the tree-managed references in the handlers of every VIRTUAL parent so each turnout is
 * spelled by its *current* alias (or number when it has none): headers (`ONCLOSE(300)` ->
 * `ONCLOSE(YARD_HUB)`) and the CLOSE()/THROW() lines of its tree children. Needed because a turnout
 * usually gets its alias after it was placed in the tree, and because the block editor treats a raw
 * number as unknown once an alias covers it. `previousAlias` lets a renamed alias still be found.
 * Lines for turnouts that aren't tree children of the parent are left exactly as written.
 */
export function canonicalizeVirtualEvents(
    handlers: EventHandlerEntry[],
    turnouts: TurnoutLike[],
    alias: AliasLookup,
    previousAlias?: AliasLookup,
): EventHandlerEntry[] {
    const match: AliasLookup = id => [...namesOf(alias, id), ...(previousAlias ? namesOf(previousAlias, id) : [])]
    let result = handlers
    for (const parent of turnouts.filter(t => t.type === 'VIRTUAL')) {
        const children = turnouts.filter(t => t.parentId === parent.id)
        if (children.length === 0) continue
        const headerRe = new RegExp(`^(\\s*)(ONCLOSE|ONTHROW)\\s*\\(\\s*${idPattern(parent.id, match)}\\s*\\)(\\s*)$`)
        result = result.map(h => {
            const action = ownedAction(h, parent.id, match)
            if (!action) return h
            const lines = h.text.split('\n').map(line => {
                const hm = line.match(headerRe)
                if (hm) return `${hm[1]}${hm[2]}(${ref(parent.id, alias)})${hm[3]}`
                for (const c of children) {
                    const lm = line.match(new RegExp(`^(\\s*)${action}\\s*\\(\\s*${idPattern(c.id, match)}\\s*\\)(\\s*)$`))
                    if (lm) return `${lm[1]}${action}(${ref(c.id, alias)})${lm[2]}`
                }
                return line
            })
            const text = lines.join('\n')
            return text === h.text ? h : { ...h, text }
        })
    }
    return result.every((h, i) => h === handlers[i]) ? handlers : result
}
