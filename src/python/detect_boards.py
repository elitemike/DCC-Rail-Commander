#!/usr/bin/env python3
"""
detect_boards.py  –  Enumerate USB serial devices and output JSON lines.

Usage
-----
  python3 detect_boards.py [--port PATH]

Each detected device is printed as a single JSON object per line so that
python-shell (mode='json') can parse it in the Electron main process.
"""
from __future__ import annotations

import json
import sys

try:
    import serial.tools.list_ports as list_ports
except ImportError:
    print(json.dumps({"error": "pyserial not installed"}))
    sys.exit(1)


def main() -> None:
    port_filter: str | None = None
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        if idx + 1 < len(sys.argv):
            port_filter = sys.argv[idx + 1]

    ports = list(list_ports.comports())
    if port_filter:
        ports = [p for p in ports if p.device == port_filter]

    for port in ports:
        record = {
            "path": port.device,
            "description": port.description,
            "manufacturer": port.manufacturer,
            "vid": f"{port.vid:04X}" if port.vid is not None else None,
            "pid": f"{port.pid:04X}" if port.pid is not None else None,
            "serial_number": port.serial_number,
        }
        # python-shell reads one JSON object per stdout line
        print(json.dumps(record), flush=True)

    if not ports:
        print(json.dumps({"info": "no devices found"}), flush=True)


if __name__ == "__main__":
    main()
