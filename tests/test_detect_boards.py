"""
Unit tests for src/python/detect_boards.py

Tests serial port enumeration, JSON output format, port filtering, and error handling.
No renderer, no Electron, no GUI — pure Python logic tested in isolation.
"""
import builtins
import importlib.util
import io
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).parent.parent
DETECT_BOARDS_PATH = REPO_ROOT / "src" / "python" / "detect_boards.py"


def _make_port(device, description, manufacturer=None, vid=None, pid=None, serial_number=None):
    """Create a mock serial port object."""
    port = MagicMock()
    port.device = device
    port.description = description
    port.manufacturer = manufacturer
    port.vid = vid
    port.pid = pid
    port.serial_number = serial_number
    return port


def _load_module():
    """Load detect_boards module fresh each call (avoids cached import state)."""
    spec = importlib.util.spec_from_file_location("detect_boards", DETECT_BOARDS_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_main(comports_return, argv=None):
    """Run detect_boards.main() with mocked comports(); return list of parsed JSON records."""
    detect_boards = _load_module()
    mock_comports = MagicMock(return_value=comports_return)

    with patch.object(detect_boards.list_ports, "comports", mock_comports):
        with patch.object(sys, "argv", ["detect_boards.py"] + (argv or [])):
            captured = io.StringIO()
            with patch("sys.stdout", captured):
                detect_boards.main()

    lines = [ln.strip() for ln in captured.getvalue().splitlines() if ln.strip()]
    return [json.loads(line) for line in lines]


# ---------------------------------------------------------------------------
# Output format
# ---------------------------------------------------------------------------

class TestOutputFormat:
    def test_single_port_outputs_one_record(self):
        records = _run_main([_make_port("/dev/ttyUSB0", "USB Serial Device")])
        assert len(records) == 1

    def test_multiple_ports_one_record_each(self):
        ports = [
            _make_port("/dev/ttyUSB0", "USB Serial Device"),
            _make_port("/dev/ttyACM0", "Arduino Mega"),
        ]
        assert len(_run_main(ports)) == 2

    def test_record_has_all_required_keys(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc")])[0]
        for key in ("path", "description", "manufacturer", "vid", "pid", "serial_number"):
            assert key in record, f"Missing key: {key}"

    def test_path_field_matches_device(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc")])[0]
        assert record["path"] == "/dev/ttyUSB0"

    def test_description_field(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "Arduino Uno")])[0]
        assert record["description"] == "Arduino Uno"

    def test_manufacturer_field(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", manufacturer="Arduino LLC")])[0]
        assert record["manufacturer"] == "Arduino LLC"

    def test_manufacturer_none_serialises_as_null(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", manufacturer=None)])[0]
        assert record["manufacturer"] is None

    def test_serial_number_field(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", serial_number="ABC123")])[0]
        assert record["serial_number"] == "ABC123"

    def test_output_is_valid_json_on_each_line(self):
        ports = [_make_port(f"/dev/ttyUSB{i}", f"Device {i}") for i in range(3)]
        detect_boards = _load_module()
        with patch.object(detect_boards.list_ports, "comports", return_value=ports):
            with patch.object(sys, "argv", ["detect_boards.py"]):
                captured = io.StringIO()
                with patch("sys.stdout", captured):
                    detect_boards.main()
        for line in captured.getvalue().splitlines():
            json.loads(line)  # must not raise


# ---------------------------------------------------------------------------
# VID / PID hex formatting
# ---------------------------------------------------------------------------

class TestVidPidFormatting:
    def test_vid_formatted_as_4_digit_uppercase_hex(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", vid=0x2341)])[0]
        assert record["vid"] == "2341"

    def test_pid_formatted_as_4_digit_uppercase_hex(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", pid=0x0043)])[0]
        assert record["pid"] == "0043"

    def test_small_vid_padded_to_4_digits(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", vid=0x0001)])[0]
        assert record["vid"] == "0001"
        assert len(record["vid"]) == 4

    def test_large_vid_hex(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", vid=0x10C4)])[0]
        assert record["vid"] == "10C4"

    def test_vid_none_is_null(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", vid=None)])[0]
        assert record["vid"] is None

    def test_pid_none_is_null(self):
        record = _run_main([_make_port("/dev/ttyUSB0", "desc", pid=None)])[0]
        assert record["pid"] is None

    def test_well_known_arduino_uno_vid_pid(self):
        record = _run_main([_make_port("/dev/ttyACM0", "desc", vid=0x2341, pid=0x0043)])[0]
        assert record["vid"] == "2341"
        assert record["pid"] == "0043"


# ---------------------------------------------------------------------------
# No devices
# ---------------------------------------------------------------------------

class TestNoDevices:
    def test_no_ports_outputs_one_record(self):
        records = _run_main([])
        assert len(records) == 1

    def test_no_ports_record_has_info_key(self):
        records = _run_main([])
        assert "info" in records[0]

    def test_no_ports_info_message(self):
        records = _run_main([])
        assert records[0]["info"] == "no devices found"

    def test_no_ports_record_has_no_error_key(self):
        records = _run_main([])
        assert "error" not in records[0]

    def test_no_ports_record_has_no_path_key(self):
        records = _run_main([])
        assert "path" not in records[0]


# ---------------------------------------------------------------------------
# Port filter (--port)
# ---------------------------------------------------------------------------

class TestPortFilter:
    def test_filter_returns_only_matching_port(self):
        ports = [
            _make_port("/dev/ttyUSB0", "Device A"),
            _make_port("/dev/ttyACM0", "Device B"),
        ]
        records = _run_main(ports, argv=["--port", "/dev/ttyUSB0"])
        assert len(records) == 1
        assert records[0]["path"] == "/dev/ttyUSB0"

    def test_filter_no_match_emits_no_devices(self):
        ports = [_make_port("/dev/ttyUSB0", "Device A")]
        records = _run_main(ports, argv=["--port", "/dev/ttyACM99"])
        assert "info" in records[0]

    def test_filter_exact_device_match_only(self):
        ports = [
            _make_port("/dev/ttyUSB0", "Device A"),
            _make_port("/dev/ttyUSB1", "Device B"),
        ]
        records = _run_main(ports, argv=["--port", "/dev/ttyUSB0"])
        assert len(records) == 1
        assert records[0]["path"] == "/dev/ttyUSB0"

    def test_no_filter_returns_all_ports(self):
        ports = [_make_port(f"/dev/ttyUSB{i}", f"Device {i}") for i in range(4)]
        assert len(_run_main(ports)) == 4

    def test_filter_preserves_full_record_content(self):
        ports = [
            _make_port("/dev/ttyUSB0", "Correct", manufacturer="Mfr", vid=0x1234, pid=0xABCD),
            _make_port("/dev/ttyUSB1", "Wrong"),
        ]
        records = _run_main(ports, argv=["--port", "/dev/ttyUSB0"])
        assert records[0]["description"] == "Correct"
        assert records[0]["vid"] == "1234"
        assert records[0]["pid"] == "ABCD"


# ---------------------------------------------------------------------------
# pyserial not installed
# ---------------------------------------------------------------------------

class TestPyserialMissing:
    def test_missing_pyserial_exits_with_code_1(self):
        """Module-level ImportError causes print+exit(1)."""
        real_import = builtins.__import__

        serial_cache = {k: v for k, v in list(sys.modules.items())
                        if k == "serial" or k.startswith("serial.")}
        for key in serial_cache:
            del sys.modules[key]

        def blocking_import(name, *args, **kwargs):
            if name == "serial.tools.list_ports" or name == "serial":
                raise ImportError(f"No module named '{name}'")
            return real_import(name, *args, **kwargs)

        captured = io.StringIO()
        with patch("builtins.__import__", side_effect=blocking_import):
            with pytest.raises(SystemExit) as exc_info:
                with patch("sys.stdout", captured):
                    spec = importlib.util.spec_from_file_location(
                        "detect_boards_err", DETECT_BOARDS_PATH
                    )
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)

        assert exc_info.value.code == 1
        sys.modules.update(serial_cache)

    def test_missing_pyserial_outputs_error_json(self):
        """Module-level ImportError causes {"error": "pyserial not installed"} output."""
        real_import = builtins.__import__
        serial_cache = {k: v for k, v in list(sys.modules.items())
                        if k == "serial" or k.startswith("serial.")}
        for key in serial_cache:
            del sys.modules[key]

        def blocking_import(name, *args, **kwargs):
            if name == "serial.tools.list_ports" or name == "serial":
                raise ImportError(f"No module named '{name}'")
            return real_import(name, *args, **kwargs)

        captured = io.StringIO()
        with patch("builtins.__import__", side_effect=blocking_import):
            with pytest.raises(SystemExit):
                with patch("sys.stdout", captured):
                    spec = importlib.util.spec_from_file_location(
                        "detect_boards_err2", DETECT_BOARDS_PATH
                    )
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)

        output = json.loads(captured.getvalue().strip())
        assert "error" in output
        assert "pyserial" in output["error"].lower()
        sys.modules.update(serial_cache)
