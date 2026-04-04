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

// ─────────────────────────────────────────────────────────────────────────────
// Per-file configuration
// ─────────────────────────────────────────────────────────────────────────────
export const FILE_CONFIGS: Record<string, FileConfig> = {

    'config.h': {
        friendlyName: 'Device Settings',
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
        completions: [
            {
                label: 'ROUTE',
                detail: 'ROUTE(id, "desc")',
                documentation: 'Define a named route visible to throttle apps.',
                insertText: 'ROUTE(${1:id}, "${2:description}")\n  ${0}\nDONE',
                hover: { title: 'ROUTE', description: 'Defines a named route that can be activated from a throttle.' },
            },
        ],
    },

    'mySequences.h': {
        friendlyName: 'Sequences',
        completions: [
            {
                label: 'SEQUENCE',
                detail: 'SEQUENCE(id)',
                documentation: 'Begin a named automation sequence.',
                insertText: 'SEQUENCE(${1:id})\n  ${0}\nDONE',
                hover: { title: 'SEQUENCE', description: 'Defines a reusable sequence of EX-RAIL commands.' },
            },
        ],
    },

    'myAliases.h': {
        friendlyName: 'Aliases',
        completions: [
            {
                label: 'ALIAS',
                detail: '#define alias',
                documentation: 'Define a named alias or #define used elsewhere.',
                insertText: '#define ${1:NAME} ${2:VALUE}',
                hover: { title: 'ALIAS / #define', description: 'Define a preprocessor alias or helper constant.' },
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
        ],
    },

    'myAutomation.h': {
        friendlyName: 'Automation',
        completions: [
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
            {
                label: 'IFOCCUPIED',
                detail: 'IFOCCUPIED(sensorId)',
                documentation: 'Branch if a sensor reports occupied.',
                insertText: 'IFOCCUPIED(${1:sensorId})',
                hover: { title: 'IFOCCUPIED', description: 'Executes the following block only if the sensor is occupied.' },
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
                documentation: 'Drive the loco forward at the given speed (0–127).',
                insertText: 'FWD(${1:50})',
                hover: { title: 'FWD', description: 'Drive the current loco forward. Speed 0–127.' },
            },
            {
                label: 'REV',
                detail: 'REV(speed)',
                documentation: 'Drive the loco in reverse at the given speed (0–127).',
                insertText: 'REV(${1:50})',
                hover: { title: 'REV', description: 'Drive the current loco in reverse. Speed 0–127.' },
            },
            {
                label: 'STOP',
                detail: 'STOP',
                documentation: 'Stop the current loco (speed 0).',
                insertText: 'STOP',
                hover: { title: 'STOP', description: 'Bring the current loco to a halt.' },
            },
            {
                label: 'DELAY',
                detail: 'DELAY(ms)',
                documentation: 'Wait for the specified number of milliseconds.',
                insertText: 'DELAY(${1:1000})',
                hover: { title: 'DELAY', description: 'Non-blocking delay in milliseconds.' },
            },
        ],
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
    return FILE_CONFIGS[filename]?.completions ?? []
}
