import { resolve } from 'aurelia'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { UsbService } from '../services/usb.service'
import { InstallerState } from '../models/installer-state'

// ── EXRAIL / DCC-EX autocomplete command list ───────────────────────────────
// Source: https://dcc-ex.com/exrail/exrail-command-reference.html
const EXRAIL_COMPLETIONS: string[] = [
    // Flow control — sequences
    'AUTOSTART',
    'AUTOMATION(id, "description")',
    'ROUTE(id, "description")',
    'SEQUENCE(id)',
    'DONE',
    'ENDTASK',
    'CALL(id)',
    'RETURN',
    'FOLLOW(sequence_id)',
    'PAUSE',
    'RESUME',
    'START(id)',
    'START_SEND(id)',
    'START_SHARED(id)',
    'SENDLOCO(loco, route)',
    'DELAY(delay)',
    'DELAYMS(delay)',
    'DELAYMINS(delay)',
    'DELAYRANDOM(min_delay, max_delay)',
    'RANDWAIT(value)',
    'IFRANDOM(percent)',
    'ROUTE_CAPTION(route_id, "caption")',
    'ROUTE_ACTIVE(route_id)',
    'ROUTE_INACTIVE(route_id)',
    'ROUTE_HIDDEN(route_id)',
    'ROUTE_DISABLED(route_id)',
    'STASH(stash_id)',
    'CLEAR_STASH(stash_id)',
    'CLEAR_ALL_STASH',
    'PICKUP_STASH(stash_id)',
    // Conditional statements
    'IF(vpin)',
    'IFNOT(vpin)',
    'ELSE',
    'ENDIF',
    'AT(vpin)',
    'AFTER(vpin)',
    'ATTIMEOUT(vpin, timeout_ms)',
    'IFTIMEOUT',
    'ATGTE(vpin, value)',
    'ATLT(vpin, value)',
    'IFGTE(vpin, value)',
    'IFLT(vpin, value)',
    'IFRESERVE(block_id)',
    'IFLOCO(loco)',
    'IFRED(signal_id)',
    'IFAMBER(signal_id)',
    'IFGREEN(signal_id)',
    'IFCLOSED(turnout_id)',
    'IFTHROWN(turnout_id)',
    'IFTTPOSITION(id, position)',
    'IFRE(vpin, value)',
    // HAL
    'HAL(device, parameters)',
    'HAL_IGNORE_DEFAULTS',
    // Signals
    'SIGNAL(red_pin, amber_pin, green_pin)',
    'SIGNALH(red_pin, amber_pin, green_pin)',
    'SERVO_SIGNAL(vpin, red_pos, amber_pos, green_pos)',
    'DCC_SIGNAL(id, addr, sub_addr)',
    'DCCX_SIGNAL(address, redAspect, amberAspect, greenAspect)',
    'VIRTUAL_SIGNAL(id)',
    'RED(signal_id)',
    'AMBER(signal_id)',
    'GREEN(signal_id)',
    'ASPECT(address, aspect)',
    'ONRED(signal_id)',
    'ONAMBER(signal_id)',
    'ONGREEN(signal_id)',
    // Turnouts
    'TURNOUT(turnout_id, addr, sub_addr, "description")',
    'TURNOUTL(turnout_id, addr, "description")',
    'PIN_TURNOUT(turnout_id, pin, "description")',
    'SERVO_TURNOUT(turnout_id, pin, active_angle, inactive_angle, profile)',
    'VIRTUAL_TURNOUT(turnout_id, "description")',
    'CLOSE(turnout_id)',
    'THROW(turnout_id)',
    'TOGGLE_TURNOUT(turnout_id)',
    'ONCLOSE(turnout_id)',
    'ONTHROW(turnout_id)',
    // Turntables
    'DCC_TURNTABLE(id, home_angle, "description")',
    'EXTT_TURNTABLE(id, vpin, home_angle, "description")',
    'TT_ADDPOSITION(id, position_id, value, angle)',
    'ROTATE(id, position, activity)',
    'ROTATE_DCC(id, position)',
    'WAITFORTT(id)',
    'MOVETT(id, steps, activity)',
    'ONROTATE(id)',
    'ONCHANGE(vpin)',
    // Sensors
    'JMRI_SENSOR(vpin)',
    'LATCH(vpin)',
    'UNLATCH(vpin)',
    'ONBUTTON(vpin)',
    'ONSENSOR(vpin)',
    // Outputs / LEDs
    'SET(vpin)',
    'RESET(vpin)',
    'FADE(vpin, value, ms)',
    'BLINK(vpin, onMs, offMs)',
    'LCN("msg")',
    'CONFIGURE_SERVO(vpin, pos1, pos2, profile)',
    'NEOPIXEL(vpin, red, green, blue)',
    'NEOPIXEL_SIGNAL(signalid, red, green, blue)',
    'ANOUT(vpin, value, param1, param2)',
    'PLAYSOUND(vpin, fileNumber, volume)',
    // Servos
    'SERVO(id, position, profile)',
    'SERVO2(id, position, duration)',
    'WAITFOR(pin)',
    // DCC Accessory decoder
    'ONACTIVATE(addr, sub_addr)',
    'ONACTIVATEL(linear)',
    'ONDEACTIVATE(addr, sub_addr)',
    'ONDEACTIVATEL(linear)',
    'ACTIVATE(addr, sub_addr)',
    'ACTIVATEL(linear)',
    'DEACTIVATE(addr, sub_addr)',
    'DEACTIVATEL(addr)',
    'DCCACTIVATE(addr, sub_addr)',
    // FastClock
    'ONTIME(value)',
    'ONCLOCKTIME(hours, mins)',
    'ONCLOCKMINS(mins)',
    // Locos
    'ESTOP',
    'SETLOCO(loco)',
    'READ_LOCO',
    'FWD(speed)',
    'REV(speed)',
    'SPEED(speed)',
    'STOP',
    'MOMENTUM(accel)',
    'FON(func)',
    'FOFF(func)',
    'FTOGGLE(func)',
    'INVERT_DIRECTION',
    'ROSTER(loco, "name", "func_map")',
    'POM(cv, value)',
    'XFWD(loco, speed)',
    'XREV(loco, speed)',
    'XFON(cab, func)',
    'XFOFF(cab, func)',
    'XFTOGGLE(loco, func)',
    'XPOM(loco, cv, value)',
    'XSAVE_SPEED(loco)',
    'XRESTORE_SPEED(loco)',
    'FORGET',
    // TrackManager
    'SET_TRACK(track, mode)',
    'SET_POWER(track, ON)',
    'SET_POWER(track, OFF)',
    'SETFREQ(frequency)',
    'ONOVERLOAD(track)',
    'AFTEROVERLOAD(track)',
    // Virtual blocks
    'RESERVE(block_id)',
    'FREE(block_id)',
    // System display
    'LCD(row, "msg")',
    'SCREEN(display, row, "msg")',
    'BROADCAST("msg")',
    'PRINT("msg")',
    'SERIAL("msg")',
    'SERIAL1("msg")',
    'SERIAL2("msg")',
    'SERIAL3("msg")',
    'SERIAL4("msg")',
    'SERIAL5("msg")',
    'SERIAL6("msg")',
    'WITHROTTLE("msg")',
    'MESSAGE("msg")',
    // CommandStation
    'POWERON',
    'POWEROFF',
    'JOIN',
    'UNJOIN',
    'KILLALL',
    'PARSE("msg")',
    'DISABLE_PROG',
    'IO_NO_HAL',
    // LCC/CBUS
    'ONLCC(sender, eventid)',
    'LCC(eventid)',
    'LCCX(senderid, eventid)',
    'ACON(eventid)',
    'ACOF(eventid)',
    'ONACON(eventid)',
    'ONACOF(eventid)',
    // DCC-EX native serial commands
    '<s>',
    '<1>',
    '<0>',
    '<1 MAIN>',
    '<0 MAIN>',
    '<1 PROG>',
    '<0 PROG>',
    '<=>',
    '<J T>',
    '<J A>',
    '</PAUSE>',
    '</RESUME>',
    '</>',
    '</ START ',
    '</ KILL ',
    '</ RESERVE ',
    '</ FREE ',
    '</ LATCH ',
    '</ UNLATCH ',
    // DCC-EX native <D ...> diagnostic/control commands
    '<D RESET>',
    '<D SPEED28>',
    '<D SPEED128>',
    '<D SERVO vpin value>',
    '<D SERVO vpin value profile>',
    '<D TT vpin steps>',
    '<D TT vpin steps activity>',
    '<D ACK ON>',
    '<D ACK OFF>',
    '<D ACK LIMIT mA>',
    '<D ACK MIN µS>',
    '<D ACK MAX µS>',
    '<D ACK RETRY num>',
    '<D PROGBOOST>',
    '<D EEPROM>',
    '<D CABS>',
    '<D CMD ON>',
    '<D CMD OFF>',
    '<D ETHERNET ON>',
    '<D ETHERNET OFF>',
    '<D LCN ON>',
    '<D LCN OFF>',
    '<D WIFI ON>',
    '<D WIFI OFF>',
    '<D WIT ON>',
    '<D WIT OFF>',
    '<D HAL SHOW>',
    '<D HAL RESET>',
    '<D RAM>',
    '<D ANIN vpin>',
    '<D ANOUT vpin value>',
    '<D ANOUT vpin value param2>',
    '<D EXRAIL ON>',
    '<D EXRAIL OFF>',
]

// ── DCC-EX native command reference (signature + description for ? help) ──────
// onOff is 1=on / 0=off;  track is MAIN | PROG | JOIN (optional)
const NATIVE_COMMAND_DOCS: Array<{ cmd: string; desc: string }> = [
    // Power
    { cmd: '<1>', desc: 'Power ON  — all tracks' },
    { cmd: '<0>', desc: 'Power OFF — all tracks' },
    { cmd: '<1 MAIN>', desc: 'Power ON  — MAIN track' },
    { cmd: '<0 MAIN>', desc: 'Power OFF — MAIN track' },
    { cmd: '<1 PROG>', desc: 'Power ON  — PROG track' },
    { cmd: '<0 PROG>', desc: 'Power OFF — PROG track' },
    { cmd: '<1 JOIN>', desc: 'Power ON + join PROG to MAIN' },
    { cmd: '<D RESET>', desc: 'Re-boot the command station' },
    // Track Manager
    { cmd: '<= trackletter mode>', desc: 'Set track mode  e.g. <= A MAIN>' },
    { cmd: '<= trackletter DC cab>', desc: 'Set track to DC mode for cab' },
    { cmd: '<=>', desc: 'Query current Track Manager config' },
    // Loco / Cab
    { cmd: '<t cab speed dir>', desc: 'Set cab speed (0-127) dir (1=fwd 0=rev)' },
    { cmd: '<t cab>', desc: 'Request speed/function update for cab' },
    { cmd: '<!>', desc: 'Emergency stop all locos' },
    { cmd: '<F cab funct state>', desc: 'Loco function ON/OFF  e.g. <F 3 0 1>' },
    { cmd: '<- cab>', desc: 'Remove loco from reminders' },
    { cmd: '<->', desc: 'Remove ALL locos from reminders' },
    { cmd: '<D SPEED28>', desc: 'Switch to 28 speed steps' },
    { cmd: '<D SPEED128>', desc: 'Switch to 128 speed steps' },
    // Roster
    { cmd: '<J R>', desc: 'List all roster entry IDs' },
    { cmd: '<J R id>', desc: 'Detail for a specific roster entry' },
    // Turnouts
    { cmd: '<T>', desc: 'List all defined turnouts/points' },
    { cmd: '<T id state>', desc: 'Throw (1/T) or Close (0/C) a turnout' },
    { cmd: '<J T>', desc: 'List turnout IDs' },
    { cmd: '<J T id>', desc: 'Detail for a specific turnout' },
    // Turntables
    { cmd: '<I>', desc: 'List all defined turntables/traversers' },
    { cmd: '<I id position>', desc: 'Rotate DCC turntable to position' },
    { cmd: '<I id position activity>', desc: 'Rotate EX-Turntable to position' },
    { cmd: '<J O>', desc: 'List turntable IDs' },
    { cmd: '<J O id>', desc: 'Detail for a specific turntable' },
    { cmd: '<D TT vpin steps>', desc: 'Test turntable movement' },
    // Routes / Automations
    { cmd: '<J A>', desc: 'List automation/route IDs' },
    { cmd: '<J A id>', desc: 'Detail for a specific route/automation' },
    { cmd: '</ START cab id>', desc: 'Start EXRAIL sequence for cab' },
    { cmd: '</ START id>', desc: 'Start EXRAIL sequence' },
    { cmd: '</ KILL id>', desc: 'Stop an EXRAIL sequence' },
    { cmd: '</ KILL ALL>', desc: 'Stop ALL EXRAIL sequences' },
    // System info
    { cmd: '<s>', desc: 'Version, hardware info, defined turnouts' },
    { cmd: '<c>', desc: 'Current draw on all tracks (mA)' },
    { cmd: '<#>', desc: 'Number of supported cab slots' },
    { cmd: '<J I>', desc: 'Current values per track (mA)' },
    { cmd: '<J G>', desc: 'Max current per track (mA)' },
    // DCC Accessories
    { cmd: '<a addr subaddr activate>', desc: 'Accessory decoder by address+subaddr  (activate 0/1)' },
    { cmd: '<a linearAddr activate>', desc: 'Accessory decoder by linear address (1-2044)' },
    { cmd: '<A address aspect>', desc: 'DCC extended accessory / signal aspect' },
    // Sensors & Outputs
    { cmd: '<Q>', desc: 'List status of all sensors' },
    { cmd: '<S>', desc: 'List all defined sensors' },
    { cmd: '<S id vpin pullup>', desc: 'Create sensor  (pullup: 1=active-low)' },
    { cmd: '<S id>', desc: 'Delete sensor by id' },
    { cmd: '<z vpin>', desc: 'Set output pin HIGH (no pre-definition needed)' },
    { cmd: '<z -vpin>', desc: 'Set output pin LOW' },
    { cmd: '<Z id state>', desc: 'Set defined output ACTIVE(1)/INACTIVE(0)' },
    { cmd: '<Z>', desc: 'List all defined output pins' },
    // Signals
    { cmd: '</ RED signalId>', desc: 'Set signal to RED' },
    { cmd: '</ AMBER signalId>', desc: 'Set signal to AMBER' },
    { cmd: '</ GREEN signalId>', desc: 'Set signal to GREEN' },
    // Servo (direct)
    { cmd: '<D SERVO vpin value>', desc: 'Move servo on vpin to value (102-490)' },
    { cmd: '<D SERVO vpin value profile>', desc: 'Move servo on vpin — profile: 0=instant 1=fast 2=med 3=slow 4=bounce' },
    // Diagnostics
    { cmd: '<D RAM>', desc: 'Show free RAM on command station' },
    { cmd: '<D CABS>', desc: 'Show active cab numbers and speeds' },
    { cmd: '<D HAL SHOW>', desc: 'Show HAL devices (servo boards, GPIO expanders)' },
    { cmd: '<D HAL RESET>', desc: 'Reset all HAL devices' },
    { cmd: '<D ACK ON>', desc: 'Enable ACK diagnostics (for CV read/write)' },
    { cmd: '<D ACK OFF>', desc: 'Disable ACK diagnostics' },
    { cmd: '<D ACK LIMIT mA>', desc: 'Set ACK detection threshold in mA (default 60)' },
    { cmd: '<D ACK MIN µS>', desc: 'Set minimum ACK pulse duration in µS (default 4000)' },
    { cmd: '<D ACK MAX µS>', desc: 'Set maximum ACK pulse duration in µS (default 8500)' },
    { cmd: '<D ACK RETRY num>', desc: 'Set CV read/write retry count (default 2)' },
    { cmd: '<D PROGBOOST>', desc: 'Override 250mA prog track limit while idle' },
    { cmd: '<D CMD ON>', desc: 'Enable command parser diagnostics' },
    { cmd: '<D CMD OFF>', desc: 'Disable command parser diagnostics' },
    { cmd: '<D WIFI ON>', desc: 'Enable WiFi diagnostics' },
    { cmd: '<D WIFI OFF>', desc: 'Disable WiFi diagnostics' },
    { cmd: '<D ETHERNET ON>', desc: 'Enable Ethernet diagnostics' },
    { cmd: '<D ETHERNET OFF>', desc: 'Disable Ethernet diagnostics' },
    { cmd: '<D LCN ON>', desc: 'Enable LCN interface diagnostics' },
    { cmd: '<D LCN OFF>', desc: 'Disable LCN interface diagnostics' },
    { cmd: '<D WIT ON>', desc: 'Enable WiThrottle diagnostics' },
    { cmd: '<D WIT OFF>', desc: 'Disable WiThrottle diagnostics' },
    { cmd: '<D EXRAIL ON>', desc: 'Enable EXRAIL diagnostics' },
    { cmd: '<D EXRAIL OFF>', desc: 'Disable EXRAIL diagnostics' },
    { cmd: '<D ANIN vpin>', desc: 'Read analogue value of vpin' },
    { cmd: '<D ANOUT vpin value>', desc: 'Write analogue value to vpin' },
    { cmd: '<D EEPROM>', desc: 'Dump EEPROM contents to serial monitor' },
    // EEPROM
    { cmd: '<E>', desc: 'Store turnout/sensor/output definitions to EEPROM' },
    { cmd: '<e>', desc: 'Erase ALL definitions from EEPROM' },
    // CV programming
    { cmd: '<R>', desc: 'Read DCC decoder address (prog track)' },
    { cmd: '<R cv>', desc: 'Read CV value (prog track)' },
    { cmd: '<W cv value>', desc: 'Write CV value (prog track)' },
    { cmd: '<W address>', desc: 'Write DCC address to decoder (prog track)' },
    { cmd: '<V cv value>', desc: 'Verify CV value (prog track)' },
    { cmd: '<w cab cv value>', desc: 'Write CV on MAIN track (ops mode)' },
    // Fast clock
    { cmd: '<JC minutes speed>', desc: 'Start fast clock  (minutes since midnight, speed factor)' },
    { cmd: '<JC>', desc: 'Request current fast clock time' },
    // User / misc
    { cmd: '<U cmd>', desc: 'User-defined command (passes through user filter)' },
]

// ── DCC-EX / EXRAIL quick-send commands ──────────────────────────────────────
const QUICK_COMMANDS: Array<{ label: string; cmd: string; group: string }> = [
    // Status / Diagnostics
    { label: 'Status', cmd: '<s>', group: 'status' },
    { label: 'Diagnostics', cmd: '<D>', group: 'status' },
    // Power
    { label: 'Power On', cmd: '<1>', group: 'power' },
    { label: 'Power Off', cmd: '<0>', group: 'power' },
    { label: 'Main On', cmd: '<1 MAIN>', group: 'power' },
    { label: 'Main Off', cmd: '<0 MAIN>', group: 'power' },
    { label: 'Prog On', cmd: '<1 PROG>', group: 'power' },
    { label: 'Prog Off', cmd: '<0 PROG>', group: 'power' },
    // Emergency
    { label: 'E-Stop', cmd: '<=>', group: 'estop' },
    // Lists
    { label: 'List Turnouts', cmd: '<J T>', group: 'list' },
    { label: 'List Automations', cmd: '<J A>', group: 'list' },
    // EXRAIL
    { label: 'EXRAIL List', cmd: '</ LIST>', group: 'exrail' },
    { label: 'EXRAIL Pause', cmd: '</ PAUSE>', group: 'exrail' },
    { label: 'EXRAIL Resume', cmd: '</ RESUME>', group: 'exrail' },
]

// ── ANSI color helpers ────────────────────────────────────────────────────────
const A = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    white: '\x1b[97m',
    // background colours
    bgBlue: '\x1b[44m',
    bgReset: '\x1b[49m',
    // foreground bright
    brightBlue: '\x1b[94m',
}

// VS Code-style powerline prompt:  " dcc-ex "▶  
// bg-blue segment, then a blue foreground chevron on transparent bg
const PROMPT_SEGMENT = `${A.bgBlue}${A.white}${A.bold} dcc-ex ${A.reset}${A.brightBlue}❯${A.reset} `

function colorizeResponse(line: string): string {
    if (!line) return line
    if (line.startsWith('<*')) return `${A.yellow}${line}${A.reset}`          // status messages
    if (line.startsWith('<!')) return `${A.red}${line}${A.reset}`             // errors
    if (line.startsWith('<i')) return `${A.cyan}${line}${A.reset}`            // info (version)
    if (line.startsWith('<p')) return `${A.blue}${line}${A.reset}`            // power state
    if (line.startsWith('<l')) return `${A.green}${line}${A.reset}`           // loco
    if (line.startsWith('<')) return `${A.green}${A.dim}${line}${A.reset}`   // other DCC-EX response
    return `${A.dim}${line}${A.reset}`                                        // firmware/debug text
}

export class SerialMonitorCustomElement {
    readonly quickCommands = QUICK_COMMANDS
    portLabel = ''
    portStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected'

    /** Container div xterm mounts into — set by ref="terminalEl" in template */
    terminalEl!: HTMLElement

    private term!: Terminal
    private fitAddon!: FitAddon
    private resizeObserver?: ResizeObserver

    // Input state
    private inputBuffer = ''
    private commandHistory: string[] = []
    private historyIndex = -1

    // IPC subscriptions
    private unsubData?: () => void
    private unsubError?: () => void
    private unsubClosed?: () => void

    private portOpenedByUs = false

    private readonly usb = resolve(UsbService)
    private readonly state = resolve(InstallerState)

    // ── Aurelia lifecycle ──────────────────────────────────────────────────
    attached(): void {
        // xterm.js uses a canvas renderer — the font must be fully loaded before
        // Terminal.open() is called or it falls back to the system monospace.
        document.fonts.load('400 12px "JetBrains Mono NF"').finally(() => {
            this.initTerminal()
            this.subscribeToPort()
            this.connectPort()
        })
    }

    detaching(): void {
        this.resizeObserver?.disconnect()
        this.unsubData?.()
        this.unsubError?.()
        this.unsubClosed?.()

        if (this.portOpenedByUs) {
            const port = this.state.selectedDevice?.port
            if (port) this.usb.closePort(port).catch(() => { })
            this.portOpenedByUs = false
        }

        this.term?.dispose()
    }

    // ── Init ──────────────────────────────────────────────────────────────
    private initTerminal(): void {
        this.term = new Terminal({
            theme: {
                background: '#0d1117',
                foreground: '#c9d1d9',
                cursor: '#58a6ff',
                selectionBackground: '#264f78',
                black: '#0d1117',
                brightBlack: '#30363d',
            },
            fontFamily: '"JetBrains Mono NF", "JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
            fontSize: 12,
            lineHeight: 1.4,
            cursorBlink: true,
            scrollback: 5000,
            convertEol: true,
        })

        this.fitAddon = new FitAddon()
        this.term.loadAddon(this.fitAddon)
        this.term.open(this.terminalEl)

        requestAnimationFrame(() => {
            this.fitAddon.fit()
        })

        this.resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => this.fitAddon?.fit())
        })
        this.resizeObserver.observe(this.terminalEl)

        this.term.onData(this.handleInput.bind(this))
    }

    private subscribeToPort(): void {
        if (!window.usb) return

        this.unsubData = window.usb.onData(({ path, data }) => {
            if (path !== this.state.selectedDevice?.port) return
            // arduino sends mixed \r\n — split and write each non-empty line
            const lines = data.split(/\r\n|\r|\n/)
            for (const line of lines) {
                if (line.trim()) {
                    this.term.writeln(colorizeResponse(line))
                }
            }
        })

        this.unsubError = window.usb.onError(({ path, message }) => {
            if (path !== this.state.selectedDevice?.port) return
            this.term.writeln(`${A.red}[ERROR] ${message}${A.reset}`)
        })

        this.unsubClosed = window.usb.onClosed(({ path }) => {
            if (path !== this.state.selectedDevice?.port) return
            this.portOpenedByUs = false
            this.portStatus = 'disconnected'
            this.portLabel = ''
            this.term.writeln(`\r\n${A.yellow}[port closed]${A.reset}`)
        })
    }

    private async connectPort(): Promise<void> {
        const port = this.state.selectedDevice?.port
        if (!port) {
            this.term.writeln(`${A.yellow}No device selected — open a device first.${A.reset}`)
            this.portStatus = 'error'
            return
        }

        this.portStatus = 'connecting'
        this.portLabel = port
        this.term.writeln(`${A.cyan}Connecting to ${port} @ 115200 baud...${A.reset}`)

        try {
            await this.usb.openPort(port, 115200)
            this.portOpenedByUs = true
            this.portStatus = 'connected'
            this.term.writeln(`${A.green}${A.bold}Connected.${A.reset}  Type a command or use the quick-send buttons above.`)
            this.term.writeln(`${A.dim}Tip: ↑/↓ history  •  Tab autocomplete  •  Ctrl+C clears input  •  Ctrl+L clears screen  •  ? or ? <prefix> for help${A.reset}`)
        } catch (err) {
            const msg = (err as Error).message
            // Port already open from a previous session (e.g. after upload) — attach anyway
            if (/already open/i.test(msg)) {
                this.portOpenedByUs = false
                this.portStatus = 'connected'
                this.term.writeln(`${A.green}${A.bold}Attached to ${port}.${A.reset}`)
            } else {
                this.portStatus = 'error'
                this.term.writeln(`${A.red}Failed: ${msg}${A.reset}`)
            }
        }

        this.writePrompt()
    }

    // ── Input handling ────────────────────────────────────────────────────
    private handleInput(data: string): void {
        // Enter
        if (data === '\r') {
            const cmd = this.inputBuffer.trim()
            this.inputBuffer = ''
            this.historyIndex = -1
            this.term.write('\r\n')
            if (cmd) {
                if (cmd === '?' || cmd.startsWith('? ')) {
                    this.showHelp(cmd.slice(1).trim())
                } else {
                    if (this.commandHistory[0] !== cmd) {
                        this.commandHistory.unshift(cmd)
                        if (this.commandHistory.length > 100) this.commandHistory.pop()
                    }
                    void this.sendToPort(cmd)
                }
            }
            this.writePrompt()
            return
        }

        // Backspace / Delete
        if (data === '\x7f' || data === '\b') {
            if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1)
                this.term.write('\b \b')
            }
            return
        }

        // Arrow Up — history older
        if (data === '\x1b[A') {
            if (!this.commandHistory.length) return
            this.historyIndex = Math.min(this.historyIndex + 1, this.commandHistory.length - 1)
            this.replaceCurrentInput(this.commandHistory[this.historyIndex])
            return
        }

        // Arrow Down — history newer
        if (data === '\x1b[B') {
            if (this.historyIndex <= 0) {
                this.historyIndex = -1
                this.replaceCurrentInput('')
                return
            }
            this.historyIndex--
            this.replaceCurrentInput(this.commandHistory[this.historyIndex])
            return
        }

        // Ctrl+C — clear input line
        if (data === '\x03') {
            this.term.write('^C')
            this.inputBuffer = ''
            this.historyIndex = -1
            this.writePrompt()
            return
        }

        // Ctrl+L — clear screen
        if (data === '\x0c') {
            this.term.clear()
            this.writePrompt()
            return
        }

        // Tab — autocomplete
        if (data === '\t') {
            this.handleTabComplete()
            return
        }

        // Ignore other control characters
        if (data.charCodeAt(0) < 32) return

        // Printable characters
        this.inputBuffer += data
        this.term.write(data)
    }

    private showHelp(filter: string): void {
        const normalised = filter.toLowerCase()

        // Search native docs table first (has descriptions)
        const nativeDocs = NATIVE_COMMAND_DOCS.filter(
            ({ cmd, desc }) =>
                cmd.toLowerCase().includes(normalised) || desc.toLowerCase().includes(normalised)
        )
        // Then search EXRAIL completions (non-native)
        const exrailMatches = EXRAIL_COMPLETIONS.filter(
            c => !c.startsWith('<') && c.toLowerCase().includes(normalised)
        )

        if (nativeDocs.length === 0 && exrailMatches.length === 0) {
            this.term.writeln(`${A.yellow}No commands matching "${filter || '*'}" — try: ? power  ? servo  ? turnout  ? cv${A.reset}`)
            return
        }

        if (nativeDocs.length) {
            this.term.writeln(`${A.bold}${A.cyan}── DCC-EX native commands ──────────────────────────────────────${A.reset}`)
            for (const { cmd, desc } of nativeDocs) {
                const padded = cmd.padEnd(32)
                this.term.writeln(`  ${A.white}${padded}${A.reset}${A.dim}  ${desc}${A.reset}`)
            }
        }
        if (exrailMatches.length) {
            this.term.writeln(`${A.bold}${A.cyan}── EXRAIL commands ─────────────────────────────────────────────${A.reset}`)
            for (const c of exrailMatches) this.term.writeln(`  ${A.dim}${c}${A.reset}`)
        }
    }

    private handleTabComplete(): void {
        const input = this.inputBuffer
        if (!input) return

        const matches = EXRAIL_COMPLETIONS.filter(c =>
            c.toLowerCase().startsWith(input.toLowerCase())
        )

        if (matches.length === 0) {
            // No matches — bell
            this.term.write('\x07')
            return
        }

        if (matches.length === 1) {
            // Unique match — complete it
            this.replaceCurrentInput(matches[0])
            return
        }

        // Find longest common prefix among matches
        let prefix = matches[0]
        for (const m of matches.slice(1)) {
            let i = 0
            while (i < prefix.length && i < m.length && prefix[i].toLowerCase() === m[i].toLowerCase()) i++
            prefix = prefix.slice(0, i)
        }

        if (prefix.length > input.length) {
            // Can extend input to the common prefix
            this.replaceCurrentInput(prefix)
            return
        }

        // Show all options below current line
        this.term.write('\r\n')
        const cols = this.term.cols || 80
        let line = ''
        for (const m of matches) {
            const entry = m.split('(')[0] + '  '
            if (line.length + entry.length > cols) {
                this.term.writeln(`${A.dim}${line.trimEnd()}${A.reset}`)
                line = ''
            }
            line += entry
        }
        if (line.trim()) this.term.writeln(`${A.dim}${line.trimEnd()}${A.reset}`)
        this.writePromptInline()
        this.term.write(this.inputBuffer)
    }

    private replaceCurrentInput(newInput: string): void {
        // \r returns cursor to start of line; \x1b[K erases to end of line
        this.term.write('\r\x1b[K')
        this.writePromptInline()
        this.inputBuffer = newInput
        this.term.write(newInput)
    }

    private writePrompt(): void {
        this.term.write(`\r\n${PROMPT_SEGMENT}`)
    }

    private writePromptInline(): void {
        this.term.write(`${PROMPT_SEGMENT}`)
    }

    // ── Send ──────────────────────────────────────────────────────────────
    private async sendToPort(cmd: string): Promise<void> {
        if (!cmd.startsWith('<') || !cmd.endsWith('>')) {
            this.term.writeln(`${A.yellow}Invalid command — DCC-EX commands must start with < and end with >${A.reset}`)
            return
        }
        const port = this.state.selectedDevice?.port
        if (!port || this.portStatus !== 'connected') {
            this.term.writeln(`${A.yellow}Not connected.${A.reset}`)
            return
        }
        try {
            await this.usb.write(port, cmd + '\n')
        } catch (err) {
            this.term.writeln(`${A.red}[SEND ERROR] ${(err as Error).message}${A.reset}`)
        }
    }

    /** Called from the quick-send toolbar buttons in the template */
    async sendQuickCommand(cmd: string): Promise<void> {
        if (!this.term) return
        this.term.writeln(`${A.bold}${A.white}> ${cmd}${A.reset}`)
        this.writePrompt()
        await this.sendToPort(cmd)
    }

    get statusColor(): string {
        switch (this.portStatus) {
            case 'connected': return 'text-green-400'
            case 'connecting': return 'text-yellow-400'
            case 'error': return 'text-red-400'
            default: return 'text-gray-500'
        }
    }

    get statusText(): string {
        switch (this.portStatus) {
            case 'connected': return `Connected · ${this.portLabel}`
            case 'connecting': return `Connecting to ${this.portLabel}...`
            case 'error': return 'Not connected'
            default: return 'Disconnected'
        }
    }
}
