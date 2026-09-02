/**
 * file-configs.ts — Central configuration for all config files.
 *
 * Add or edit entries here to change:
 *   • The friendly display name shown in the sidebar / editor headers
 *   • Monaco completion snippets (only shown when that file is active)
 *   • Hover documentation for each snippet keyword
 *
 * Custom (user-created) files that don't appear here fall back to the
 * generic Monaco editor with no specific completions.
 */
import { baseFilename } from '../utils/exrail-completions'
import { BLOCK_REGISTRY } from '../components/visual-editors/exrail-block-registry'
import type { BlockParamDef, BlockTypeDef } from '../components/visual-editors/exrail-block-compiler'

export interface HoverDoc {
    title: string
    description: string
    /** Optional fenced code example shown in hover popup */
    example?: string
    /** Optional extra note shown below the example */
    note?: string
}

export interface CompletionSnippet {
    /** Text shown in the completion list */
    label: string
    /** Short signature shown to the right of the label */
    detail: string
    /** Plain-text description */
    documentation: string
    /** Monaco snippet string (use ${N:placeholder} and ${N|a,b,c|} for choices) */
    insertText: string
    /** If provided, shows a hover popup when the cursor is over this word */
    hover?: HoverDoc
}

export interface FileConfig {
    /** Human-friendly name shown in the sidebar and editor header */
    friendlyName: string
    /** Completion snippets offered only when this file is the active editor */
    completions?: CompletionSnippet[]
}

const EXRAIL_BODY_COMPLETIONS: CompletionSnippet[] = [
    {
        label: 'AUTOSTART',
        detail: 'AUTOSTART ... DONE',
        documentation: 'Run this EXRAIL block during startup.',
        insertText: 'AUTOSTART\n  ${0}\nDONE',
        hover: {
            title: 'AUTOSTART',
            description: 'Defines EXRAIL commands that run automatically when the command station boots.',
            example: 'AUTOSTART\n  POWERON\nDONE',
        },
    },
    {
        label: 'THROW',
        detail: 'THROW(turnoutId)',
        documentation: 'Throw a turnout by numeric ID or alias.',
        insertText: 'THROW(${1:turnoutId})',
        hover: {
            title: 'THROW',
            description: 'Set a turnout to the thrown position.',
            example: 'THROW(200)',
        },
    },
    {
        label: 'CLOSE',
        detail: 'CLOSE(turnoutId)',
        documentation: 'Close a turnout by numeric ID or alias.',
        insertText: 'CLOSE(${1:turnoutId})',
        hover: {
            title: 'CLOSE',
            description: 'Set a turnout to the closed position.',
            example: 'CLOSE(200)',
        },
    },
    {
        label: 'ONTHROW',
        detail: 'ONTHROW(turnoutId)',
        documentation: 'React when a turnout is thrown.',
        insertText: 'ONTHROW(${1:turnoutId})\n  ${0}\nDONE',
        hover: {
            title: 'ONTHROW',
            description: 'Runs the block when the specified turnout is thrown.',
            example: 'ONTHROW(8)\n  THROW(9)\nDONE',
        },
    },
    {
        label: 'ONCLOSE',
        detail: 'ONCLOSE(turnoutId)',
        documentation: 'React when a turnout is closed.',
        insertText: 'ONCLOSE(${1:turnoutId})\n  ${0}\nDONE',
        hover: {
            title: 'ONCLOSE',
            description: 'Runs the block when the specified turnout is closed.',
            example: 'ONCLOSE(8)\n  CLOSE(9)\nDONE',
        },
    },
    {
        label: 'SETLOCO',
        detail: 'SETLOCO(locoId)',
        documentation: 'Select the active loco by DCC address or alias.',
        insertText: 'SETLOCO(${1:locoId})',
        hover: {
            title: 'SETLOCO',
            description: 'Assign the current automation to the specified locomotive.',
            example: 'SETLOCO(3)',
        },
    },
    {
        label: 'SENDLOCO',
        detail: 'SENDLOCO(locoId, routeOrSequenceId)',
        documentation: 'Start a route or sequence for a specific loco.',
        insertText: 'SENDLOCO(${1:locoId}, ${2:routeOrSequenceId})',
        hover: {
            title: 'SENDLOCO',
            description: 'Starts the specified route or sequence using the given locomotive.',
            example: 'SENDLOCO(3, 13)',
        },
    },
    {
        label: 'START',
        detail: 'START(routeOrSequenceId)',
        documentation: 'Start a route or sequence by ID or alias.',
        insertText: 'START(${1:routeOrSequenceId})',
        hover: {
            title: 'START',
            description: 'Starts the specified route or sequence.',
            example: 'START(66)',
        },
    },
    {
        label: 'FOLLOW',
        detail: 'FOLLOW(routeOrSequenceId)',
        documentation: 'Continue by following another route or sequence.',
        insertText: 'FOLLOW(${1:routeOrSequenceId})',
        hover: {
            title: 'FOLLOW',
            description: 'Transfers execution to another route or sequence.',
            example: 'FOLLOW(13)',
        },
    },
    {
        label: 'IFOCCUPIED',
        detail: 'IFOCCUPIED(sensorId)',
        documentation: 'Branch if a sensor reports occupied.',
        insertText: 'IFOCCUPIED(${1:sensorId})',
        hover: { title: 'IFOCCUPIED', description: 'Executes the following block only if the sensor is occupied.' },
    },
    {
        label: 'IF',
        detail: 'IF(vpin)',
        documentation: 'Branch based on a VPIN/sensor input state.',
        insertText: 'IF(${1:vpin})\n  ${0}\nELSE\n  \nENDIF',
        hover: {
            title: 'IF',
            description: 'Starts a conditional block based on an input pin state.',
            example: 'IF(200)\n  SET(180)\nELSE\n  RESET(180)\nENDIF',
        },
    },
    {
        label: 'ELSE',
        detail: 'ELSE',
        documentation: 'Else branch for IF/IFROUTE blocks.',
        insertText: 'ELSE',
        hover: {
            title: 'ELSE',
            description: 'Starts the alternate branch in a conditional block.',
        },
    },
    {
        label: 'ENDIF',
        detail: 'ENDIF',
        documentation: 'Close an IF/IFROUTE conditional block.',
        insertText: 'ENDIF',
        hover: {
            title: 'ENDIF',
            description: 'Ends a conditional block started by IF or IFROUTE_*.',
        },
    },
    {
        label: 'AT',
        detail: 'AT(sensorId)',
        documentation: 'Wait until a sensor is activated.',
        insertText: 'AT(${1:sensorId})',
        hover: { title: 'AT', description: 'Pauses execution until the specified sensor is activated.' },
    },
    {
        label: 'AFTER',
        detail: 'AFTER(sensorId)',
        documentation: 'Wait until a sensor is deactivated after being activated.',
        insertText: 'AFTER(${1:sensorId})',
        hover: { title: 'AFTER', description: 'Waits for sensor to activate then deactivate.' },
    },
    {
        label: 'FWD',
        detail: 'FWD(speed)',
        documentation: 'Drive the loco forward at the given speed (0-127).',
        insertText: 'FWD(${1:50})',
        hover: { title: 'FWD', description: 'Drive the current loco forward. Speed 0-127.' },
    },
    {
        label: 'REV',
        detail: 'REV(speed)',
        documentation: 'Drive the loco in reverse at the given speed (0-127).',
        insertText: 'REV(${1:50})',
        hover: { title: 'REV', description: 'Drive the current loco in reverse. Speed 0-127.' },
    },
    {
        label: 'STOP',
        detail: 'STOP',
        documentation: 'Stop the current loco (speed 0).',
        insertText: 'STOP',
        hover: { title: 'STOP', description: 'Bring the current loco to a halt.' },
    },
    {
        label: 'SPEED',
        detail: 'SPEED(speed)',
        documentation: 'Set loco speed while preserving direction.',
        insertText: 'SPEED(${1:50})',
        hover: {
            title: 'SPEED',
            description: 'Sets locomotive speed (0-127) without changing direction.',
            example: 'SPEED(55)',
        },
    },
    {
        label: 'ESTOP',
        detail: 'ESTOP',
        documentation: 'Emergency stop for the active loco/task.',
        insertText: 'ESTOP',
        hover: {
            title: 'ESTOP',
            description: 'Immediately stops the locomotive.',
        },
    },
    {
        label: 'POWERON',
        detail: 'POWERON',
        documentation: 'Turn on track power.',
        insertText: 'POWERON',
        hover: { title: 'POWERON', description: 'Turns track power on.' },
    },
    {
        label: 'POWEROFF',
        detail: 'POWEROFF',
        documentation: 'Turn off track power.',
        insertText: 'POWEROFF',
        hover: { title: 'POWEROFF', description: 'Turns track power off.' },
    },
    {
        label: 'DELAY',
        detail: 'DELAY(ms)',
        documentation: 'Wait for the specified number of milliseconds.',
        insertText: 'DELAY(${1:1000})',
        hover: { title: 'DELAY', description: 'Non-blocking delay in milliseconds.' },
    },
    {
        label: 'DELAYRANDOM',
        detail: 'DELAYRANDOM(minMs, maxMs)',
        documentation: 'Wait for a random duration within the given range.',
        insertText: 'DELAYRANDOM(${1:5000}, ${2:20000})',
        hover: {
            title: 'DELAYRANDOM',
            description: 'Non-blocking random delay in milliseconds.',
            example: 'DELAYRANDOM(5000, 20000)',
        },
    },
    {
        label: 'RESERVE',
        detail: 'RESERVE(blockId)',
        documentation: 'Reserve a logical block before entering it.',
        insertText: 'RESERVE(${1:blockId})',
        hover: {
            title: 'RESERVE',
            description: 'Waits until the block is available, then reserves it.',
            example: 'RESERVE(2)',
        },
    },
    {
        label: 'FREE',
        detail: 'FREE(blockId)',
        documentation: 'Release a previously reserved logical block.',
        insertText: 'FREE(${1:blockId})',
        hover: {
            title: 'FREE',
            description: 'Releases a logical block for other routes or sequences.',
            example: 'FREE(2)',
        },
    },
    {
        label: 'SET',
        detail: 'SET(vpin[, count])',
        documentation: 'Set a VPIN output HIGH, optionally as a range.',
        insertText: 'SET(${1:vpin})',
        hover: {
            title: 'SET',
            description: 'Sets a digital/virtual output pin HIGH.',
            example: 'SET(180)',
            note: 'An optional second parameter can set a range: SET(181, 5).',
        },
    },
    {
        label: 'RESET',
        detail: 'RESET(vpin[, count])',
        documentation: 'Set a VPIN output LOW, optionally as a range.',
        insertText: 'RESET(${1:vpin})',
        hover: {
            title: 'RESET',
            description: 'Sets a digital/virtual output pin LOW.',
            example: 'RESET(180)',
            note: 'An optional second parameter can reset a range: RESET(181, 5).',
        },
    },
    {
        label: 'BLINK',
        detail: 'BLINK(vpin, onMs, offMs)',
        documentation: 'Blink a VPIN output with on/off timing.',
        insertText: 'BLINK(${1:vpin}, ${2:250}, ${3:750})',
        hover: {
            title: 'BLINK',
            description: 'Blinks the specified output pin until changed by SET/RESET.',
            example: 'BLINK(180,250,750)',
        },
    },
    {
        label: 'RED',
        detail: 'RED(signalId)',
        documentation: 'Set a signal to red.',
        insertText: 'RED(${1:signalId})',
        hover: {
            title: 'RED',
            description: 'Sets the signal/aspect identified by id to red.',
        },
    },
    {
        label: 'AMBER',
        detail: 'AMBER(signalId)',
        documentation: 'Set a signal to amber/yellow.',
        insertText: 'AMBER(${1:signalId})',
        hover: {
            title: 'AMBER',
            description: 'Sets the signal/aspect identified by id to amber.',
        },
    },
    {
        label: 'GREEN',
        detail: 'GREEN(signalId)',
        documentation: 'Set a signal to green.',
        insertText: 'GREEN(${1:signalId})',
        hover: {
            title: 'GREEN',
            description: 'Sets the signal/aspect identified by id to green.',
        },
    },
    {
        label: 'ONBUTTON',
        detail: 'ONBUTTON(vpin)',
        documentation: 'Run a handler when a button/input pin becomes active.',
        insertText: 'ONBUTTON(${1:vpin})\n  ${0}\nDONE',
        hover: {
            title: 'ONBUTTON',
            description: 'Starts a new task when the specified input pin is activated.',
            example: 'ONBUTTON(202)\n  RED(11)\n  THROW(2)\nDONE',
        },
    },
    {
        label: 'ONSENSOR',
        detail: 'ONSENSOR(vpin)',
        documentation: 'Run a handler when a sensor changes state.',
        insertText: 'ONSENSOR(${1:vpin})\n  ${0}\nDONE',
        hover: {
            title: 'ONSENSOR',
            description: 'Starts a new task when the specified sensor pin changes state.',
        },
    },
    {
        label: 'ROUTE_ACTIVE',
        detail: 'ROUTE_ACTIVE(routeId)',
        documentation: 'Mark route state as active/highlighted.',
        insertText: 'ROUTE_ACTIVE(${1:routeId})',
        hover: {
            title: 'ROUTE_ACTIVE',
            description: 'Sets a route button state to active.',
        },
    },
    {
        label: 'ROUTE_INACTIVE',
        detail: 'ROUTE_INACTIVE(routeId)',
        documentation: 'Mark route state as inactive/visible.',
        insertText: 'ROUTE_INACTIVE(${1:routeId})',
        hover: {
            title: 'ROUTE_INACTIVE',
            description: 'Sets a route button state to inactive.',
        },
    },
    {
        label: 'ROUTE_HIDDEN',
        detail: 'ROUTE_HIDDEN(routeId)',
        documentation: 'Hide a route from the throttle UI.',
        insertText: 'ROUTE_HIDDEN(${1:routeId})',
        hover: {
            title: 'ROUTE_HIDDEN',
            description: 'Hides the route button from the throttle.',
        },
    },
    {
        label: 'ROUTE_DISABLED',
        detail: 'ROUTE_DISABLED(routeId)',
        documentation: 'Disable a route in the throttle UI.',
        insertText: 'ROUTE_DISABLED(${1:routeId})',
        hover: {
            title: 'ROUTE_DISABLED',
            description: 'Disables route selection in the throttle.',
        },
    },
    {
        label: 'IFROUTE_ACTIVE',
        detail: 'IFROUTE_ACTIVE(routeId)',
        documentation: 'Conditional branch when route is active.',
        insertText: 'IFROUTE_ACTIVE(${1:routeId})\n  ${0}\nELSE\n  \nENDIF',
        hover: {
            title: 'IFROUTE_ACTIVE',
            description: 'Checks whether a route is currently active.',
        },
    },
    {
        label: 'IFROUTE_INACTIVE',
        detail: 'IFROUTE_INACTIVE(routeId)',
        documentation: 'Conditional branch when route is inactive.',
        insertText: 'IFROUTE_INACTIVE(${1:routeId})\n  ${0}\nELSE\n  \nENDIF',
        hover: {
            title: 'IFROUTE_INACTIVE',
            description: 'Checks whether a route is currently inactive.',
        },
    },
    {
        label: 'IFROUTE_HIDDEN',
        detail: 'IFROUTE_HIDDEN(routeId)',
        documentation: 'Conditional branch when route is hidden.',
        insertText: 'IFROUTE_HIDDEN(${1:routeId})\n  ${0}\nELSE\n  \nENDIF',
        hover: {
            title: 'IFROUTE_HIDDEN',
            description: 'Checks whether a route is hidden.',
        },
    },
    {
        label: 'IFROUTE_DISABLED',
        detail: 'IFROUTE_DISABLED(routeId)',
        documentation: 'Conditional branch when route is disabled.',
        insertText: 'IFROUTE_DISABLED(${1:routeId})\n  ${0}\nELSE\n  \nENDIF',
        hover: {
            title: 'IFROUTE_DISABLED',
            description: 'Checks whether a route is disabled.',
        },
    },
    {
        label: 'ROUTE_CAPTION',
        detail: 'ROUTE_CAPTION(routeId, "text")',
        documentation: 'Set the route button caption in throttle apps.',
        insertText: 'ROUTE_CAPTION(${1:routeId}, "${2:caption}")',
        hover: {
            title: 'ROUTE_CAPTION',
            description: 'Changes the route button text shown in throttle apps.',
            example: 'ROUTE_CAPTION(600,"Turn on")',
        },
    },
    {
        label: 'PRINT',
        detail: 'PRINT("text")',
        documentation: 'Emit a message to serial/diagnostic output.',
        insertText: 'PRINT("${1:message}")',
        hover: {
            title: 'PRINT',
            description: 'Prints a message during EXRAIL execution.',
            example: 'PRINT("Ready to Rumble")',
        },
    },
    {
        label: 'DONE',
        detail: 'DONE',
        documentation: 'Terminate the current EXRAIL block.',
        insertText: 'DONE',
        hover: {
            title: 'DONE',
            description: 'Ends the current ROUTE, SEQUENCE, AUTOMATION, AUTOSTART, or ON* block.',
            example: 'ROUTE(1, "Main")\n  THROW(27)\n  CLOSE(6)\nDONE',
            note: 'DONE is a standalone keyword and does not take arguments.',
        },
    },
    {
        label: 'HAL',
        detail: 'HAL(deviceType, vpin, pinCount, address)',
        documentation: 'Declare an I2C HAL device (expander, servo driver, multiplexer-attached board) without needing myHal.cpp.',
        insertText: 'HAL(${1:PCA9555}, ${2:164}, ${3:16}, ${4:0x20})',
        hover: {
            title: 'HAL',
            description: 'Declares a HAL device — an I2C GPIO/servo expander or similar accessory board — starting at the given VPin. Behind an I2C multiplexer, replace the address with `{I2CMux_n, SubBus_n, address}`.',
            example: 'HAL(PCA9555, 164, 16, 0x20)\nHAL(PCA9555, 180, 16, {I2CMux_1, SubBus_2, 0x20})',
            note: 'The Accessories row under Device Settings manages this for supported boards — hand-edit here only for devices outside that catalog.',
        },
    },
    {
        label: 'JMRI_SENSOR',
        detail: 'JMRI_SENSOR(vpin[, count])',
        documentation: 'Expose a range of VPins as <S> sensors visible to JMRI.',
        insertText: 'JMRI_SENSOR(${1:164}, ${2:16})',
        hover: {
            title: 'JMRI_SENSOR',
            description: 'Creates JMRI-visible sensors for a VPin (or contiguous range of VPins) — typically the range declared by a HAL() device.',
            example: 'JMRI_SENSOR(164, 16)',
        },
    },
]

const EXRAIL_BLOCK_COMPLETIONS: CompletionSnippet[] = [
    {
        label: 'SEQUENCE',
        detail: 'SEQUENCE(id)',
        documentation: 'Begin a named automation sequence.',
        insertText: 'SEQUENCE(${1:id})\n  ${0}\nDONE',
        hover: {
            title: 'SEQUENCE',
            description: 'Defines a reusable sequence of EX-RAIL commands.',
            example: 'SEQUENCE(1)\n  FWD(50)\n  DELAY(5000)\n  STOP\nDONE',
        },
    },
    {
        label: 'ROUTE',
        detail: 'ROUTE(id, "desc")',
        documentation: 'Define a named route visible to throttle apps.',
        insertText: 'ROUTE(${1:id}, "${2:description}")\n  ${0}\nDONE',
        hover: {
            title: 'ROUTE',
            description: 'Defines a named route that can be activated from a throttle.',
            example: 'ROUTE(1, "Main Line")\n  THROW(1)\n  CLOSE(2)\nDONE',
        },
    },
    {
        label: 'AUTOMATION',
        detail: 'AUTOMATION(id, "desc")',
        documentation: 'Define an automation block that hands off loco control.',
        insertText: 'AUTOMATION(${1:id}, "${2:description}")\n  ${0}\nDONE',
        hover: {
            title: 'AUTOMATION',
            description: 'Like ROUTE but takes over loco control from a throttle.',
        },
    },
]

// ── Auto-generated completions for every BLOCK_REGISTRY command not already ──
// hand-curated above. BLOCK_REGISTRY (exrail-block-registry.ts) is the block
// canvas's single source of truth for every EXRAIL command it supports —
// ~190 entries as of this writing, only a fraction of which have a hand-
// written entry in EXRAIL_BODY_COMPLETIONS/EXRAIL_BLOCK_COMPLETIONS above.
// Without this, a command works fully in the block canvas (palette, drag,
// compile) but silently gets no Monaco autocomplete/hover when typed as raw
// text — which is exactly what happened here: the hand-curated lists had
// already drifted behind the registry before this generator existed (e.g.
// TOGGLE_TURNOUT/AFTEROVERLOAD/DELAYMINS existed in the registry but not
// here). Regenerating from the registry on every module load keeps the two
// permanently in sync instead of relying on someone remembering to update
// both places by hand.
function paramPlaceholder(p: BlockParamDef, index: number): string {
    return `\${${index + 1}:${p.name}}`
}

/** Monaco snippet body for one registry entry — a hat gets the same "header + body + DONE" shape ROUTE/SEQUENCE already use above; anything else is just its own call. */
function snippetInsertTextFor(def: BlockTypeDef): string {
    const args = def.params.map(paramPlaceholder).join(', ')
    const call = def.params.length > 0 ? `${def.id}(${args})` : def.id
    return def.shape === 'hat' ? `${call}\n  \${0}\nDONE` : call
}

/** Short signature shown to the right of the completion label, e.g. "THROW(turnoutId)". */
function detailFor(def: BlockTypeDef): string {
    return def.params.length === 0 ? def.id : `${def.id}(${def.params.map(p => p.name).join(', ')})`
}

/** A plausible fully-substituted call, via the same emit() the block canvas itself compiles through — so the hover example is always a real, valid EXRAIL line for this command, never hand-typed and liable to drift. */
function exampleFor(def: BlockTypeDef): string {
    const sample: Record<string, string | number> = {}
    for (const p of def.params) {
        if (p.variadic) { sample[p.name] = ''; continue }
        sample[p.name] = p.kind === 'string' ? 'text' : 200
    }
    const line = def.emit(sample).replace(/,\s*\)/, ')') // trims a variadic param's empty placeholder cleanly
    return def.shape === 'hat' ? `${line}\n  DONE` : line
}

function generatedCompletionFor(def: BlockTypeDef): CompletionSnippet {
    return {
        label: def.id,
        detail: detailFor(def),
        documentation: def.description ?? def.label,
        insertText: snippetInsertTextFor(def),
        hover: {
            title: def.label,
            description: def.description ?? def.label,
            example: exampleFor(def),
        },
    }
}

const CURATED_EXRAIL_LABELS = new Set([...EXRAIL_BODY_COMPLETIONS, ...EXRAIL_BLOCK_COMPLETIONS].map(c => c.label))

const GENERATED_EXRAIL_COMPLETIONS: CompletionSnippet[] = BLOCK_REGISTRY
    .filter(def => !CURATED_EXRAIL_LABELS.has(def.id))
    .map(generatedCompletionFor)

/** Same generated set, minus hat-shaped (ROUTE/SEQUENCE/ON*) entries — for myStartup.h, which (like the curated EXRAIL_BODY_COMPLETIONS list) only ever holds AUTOSTART...DONE body statements, never a block starter. */
const GENERATED_BODY_ONLY_COMPLETIONS: CompletionSnippet[] = GENERATED_EXRAIL_COMPLETIONS
    .filter(c => BLOCK_REGISTRY.find(def => def.id === c.label)?.shape !== 'hat')

// ─────────────────────────────────────────────────────────────────────────────
// Per-file configuration
// ─────────────────────────────────────────────────────────────────────────────
export const FILE_CONFIGS: Record<string, FileConfig> = {

    'config.h': {
        friendlyName: 'General + WiFi',
        completions: [],
    },

    'myRoster.h': {
        friendlyName: 'Roster',
        completions: [
            {
                label: 'ROSTER',
                detail: 'ROSTER(dccAddress, "Name", "Fn0/Fn1/..." | DEFINE)',
                documentation: 'Define a locomotive roster entry.',
                insertText: 'ROSTER(${1:dccAddress}, "${2:Loco Name}", "${3:Fn0/Fn1/Fn2}")',
                hover: {
                    title: 'ROSTER Macro',
                    description: 'Define a locomotive roster entry visible in throttle apps.',
                    example: 'ROSTER(1234, "My Loco", "Lights/*Bell/*Whistle/Mute")',
                    note: 'Prefix a function name with `*` to make it momentary. The function list can also be a `#define` identifier — define it above with `#define MY_LOCO_F "Fn0/Fn1/..."`.',
                },
            },
        ],
    },
    'mySensors.h': {
        friendlyName: 'Sensors',
        completions: [
            {
                label: 'SENSOR',
                detail: 'SENSOR(id, pin, "desc")',
                documentation: 'Define a sensor connected to a GPIO pin.',
                insertText: 'SENSOR(${1:id}, ${2:pin}, "${3:description}")',
                hover: {
                    title: 'SENSOR Macro',
                    description: 'Define a sensor connected to a GPIO pin.',
                    example: 'SENSOR(1, 17, "Yard Entrance")',
                },
            },
        ],
    },
    'mySignals.h': {
        friendlyName: 'Signals',
        completions: [
            {
                label: 'SIGNAL',
                detail: 'SIGNAL(red_pin, amber_pin, green_pin)',
                documentation: 'Define a signal connected to a GPIO pin.',
                insertText: 'SIGNAL(${1:red_pin}, ${2:amber_pin}, ${3:green_pin})',
                hover: {
                    title: 'SIGNAL Macro',
                    description: 'Define a 3-aspect signal connected to GPIO pins.',
                    example: 'SIGNAL(5, 6, 13) // red=GPIO5, amber=GPIO6, green=GPIO13',
                },
            },
        ],
    },

    'myRoutes.h': {
        friendlyName: 'Routes',
        completions: [EXRAIL_BLOCK_COMPLETIONS[1], ...EXRAIL_BODY_COMPLETIONS, ...GENERATED_EXRAIL_COMPLETIONS],
    },

    'mySequences.h': {
        friendlyName: 'Sequences',
        completions: [EXRAIL_BLOCK_COMPLETIONS[0], ...EXRAIL_BODY_COMPLETIONS, ...GENERATED_EXRAIL_COMPLETIONS],
    },

    'myAutomations.h': {
        friendlyName: 'Automations',
        completions: [EXRAIL_BLOCK_COMPLETIONS[2], ...EXRAIL_BODY_COMPLETIONS, ...GENERATED_EXRAIL_COMPLETIONS],
    },

    'myEvents.h': {
        friendlyName: 'Event Handlers',
        // Includes the generated ON* header-line snippets (ONSENSOR(...), etc.) alongside every
        // body command — the block canvas's Add control is the primary way to create an entry,
        // but the per-row and whole-file Raw tabs are fully hand-editable too, so typing "ONSENSOR"
        // there should snippet-complete the same way ROUTE/SEQUENCE already do in their own files.
        completions: [...EXRAIL_BODY_COMPLETIONS, ...GENERATED_EXRAIL_COMPLETIONS],
    },

    'myAliases.h': {
        friendlyName: 'Aliases',
        completions: [
            {
                label: 'ALIAS',
                detail: 'ALIAS(name[, value])',
                documentation: 'Define a readable name for a numeric ID (turnout, sensor, route, sequence, or roster address).',
                insertText: 'ALIAS(${1:NAME}, ${2:VALUE})',
                hover: {
                    title: 'ALIAS Macro',
                    description: 'Creates a readable name that can be used in place of a numeric ID elsewhere in EX-RAIL. The value is optional — if omitted, EX-RAIL auto-assigns one.',
                    example: 'ALIAS(YARD_SWITCH, 200)',
                    note: 'Names must start with a letter or underscore and contain only letters, numbers, and underscores. Avoid a leading zero on the value (e.g. 010) — C treats it as octal.',
                },
            },
        ],
    },

    'myTurnouts.h': {
        friendlyName: 'Turnouts',
        completions: [
            {
                label: 'SERVO_TURNOUT',
                detail: 'SERVO_TURNOUT(id, pin, activeAngle, inactiveAngle, profile, "desc")',
                documentation: 'Define a servo-controlled turnout / point.',
                insertText: 'SERVO_TURNOUT(${1:id}, ${2:pin}, ${3:400}, ${4:100}, ${5|Instant,Fast,Medium,Slow,Bounce|}, "${6:description}")',
                hover: {
                    title: 'SERVO_TURNOUT Macro',
                    description: 'Define a servo-controlled turnout or point.',
                    example: 'SERVO_TURNOUT(1, 25, 400, 100, Slow, "Platform 1")',
                    note: 'Profiles: `Instant` `Fast` `Medium` `Slow` `Bounce`',
                },
            },
            {
                label: 'TURNOUT',
                detail: 'TURNOUT(id, addr, subAddr, "desc")',
                documentation: 'Define a DCC accessory turnout.',
                insertText: 'TURNOUT(${1:id}, ${2:addr}, ${3:subAddr}, "${4:description}")',
                hover: {
                    title: 'TURNOUT Macro',
                    description: 'Define a DCC accessory decoder-controlled turnout.',
                    example: 'TURNOUT(1, 100, 0, "Yard Exit")',
                },
            },
            {
                label: 'TURNOUTL',
                detail: 'TURNOUTL(id, addr, "desc")',
                documentation: 'Define a DCC accessory turnout with a single linear address.',
                insertText: 'TURNOUTL(${1:id}, ${2:addr}, "${3:description}")',
                hover: {
                    title: 'TURNOUTL Macro',
                    description: 'Define a DCC accessory decoder-controlled turnout using one linear address instead of an addr/subAddr pair.',
                    example: 'TURNOUTL(1, 401, "Yard Exit")',
                },
            },
            {
                label: 'PIN_TURNOUT',
                detail: 'PIN_TURNOUT(id, pin, "desc")',
                documentation: 'Define a GPIO-pin-driven turnout.',
                insertText: 'PIN_TURNOUT(${1:id}, ${2:pin}, "${3:description}")',
                hover: {
                    title: 'PIN_TURNOUT Macro',
                    description: 'Define a turnout driven directly by a GPIO pin.',
                    example: 'PIN_TURNOUT(2, 22, "Siding")',
                },
            },
            {
                label: 'VIRTUAL_TURNOUT',
                detail: 'VIRTUAL_TURNOUT(id, "desc")',
                documentation: 'Define a turnout with no hardware, driven by ONCLOSE/ONTHROW handlers.',
                insertText: 'VIRTUAL_TURNOUT(${1:id}, "${2:description}")',
                hover: {
                    title: 'VIRTUAL_TURNOUT Macro',
                    description: 'Define a virtual turnout with no hardware — simulate it with ONCLOSE/ONTHROW event handlers.',
                    example: 'VIRTUAL_TURNOUT(3, "Simulated Siding")',
                },
            },
        ],
    },

    'myAutomation.h': {
        // Not "Automation" — that name collides with EXRAIL's own AUTOMATION()
        // blocks. This file just links the other config files together; see
        // the Device Settings > Advanced row.
        friendlyName: 'Advanced',
        completions: [...EXRAIL_BLOCK_COMPLETIONS, ...EXRAIL_BODY_COMPLETIONS, ...GENERATED_EXRAIL_COMPLETIONS],
    },

    'myStartup.h': {
        friendlyName: 'Startup',
        // Body-only completions (THROW/CLOSE/POWERON/SETLOCO/etc.) — no block
        // starters like ROUTE/SEQUENCE/AUTOMATION/ON*, since this file only ever
        // contains AUTOSTART...DONE blocks, never those.
        completions: [...EXRAIL_BODY_COMPLETIONS, ...GENERATED_BODY_ONLY_COMPLETIONS],
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions (used by templates and monaco-editor.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the human-friendly display name for a config file.
 * Falls back to the raw filename when no config is defined.
 */
export function friendlyName(filename: string): string {
    return FILE_CONFIGS[filename]?.friendlyName ?? filename
}

/**
 * Returns the completion snippets for the given filename (empty array if none).
 */
export function getCompletions(filename: string): CompletionSnippet[] {
    return FILE_CONFIGS[baseFilename(filename)]?.completions ?? []
}
