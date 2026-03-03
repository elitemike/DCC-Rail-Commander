"""
Unit tests for ex_installer/arduino_cli.py — ArduinoCLI class

Tests pure logic (path building, installed check, param construction, class data)
without spawning real subprocesses. No renderer, no Electron, no GUI.
"""
import os
import platform
import queue
import stat
import sys
import tempfile
from pathlib import Path
from queue import Queue
from unittest.mock import MagicMock, patch, call

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from ex_installer.arduino_cli import ArduinoCLI, ThreadedArduinoCLI, QueueMessage  # noqa: E402


# ---------------------------------------------------------------------------
# Class-level constants
# ---------------------------------------------------------------------------

class TestClassConstants:
    def test_arduino_cli_version_is_0_35_3(self):
        assert ArduinoCLI.arduino_cli_version == "0.35.3"

    def test_base_platforms_has_arduino_avr(self):
        assert "Arduino AVR" in ArduinoCLI.base_platforms

    def test_arduino_avr_platform_id(self):
        assert ArduinoCLI.base_platforms["Arduino AVR"]["platform_id"] == "arduino:avr"

    def test_extra_platforms_has_esp32(self):
        assert "Espressif ESP32" in ArduinoCLI.extra_platforms

    def test_esp32_platform_id(self):
        assert ArduinoCLI.extra_platforms["Espressif ESP32"]["platform_id"] == "esp32:esp32"

    def test_esp32_locked_to_2_0_17(self):
        # Must stay locked to avoid 3.x compile errors with EX-CommandStation
        assert ArduinoCLI.extra_platforms["Espressif ESP32"]["version"] == "2.0.17"

    def test_extra_platforms_has_stm32(self):
        assert "STMicroelectronics Nucleo/STM32" in ArduinoCLI.extra_platforms

    def test_supported_devices_has_mega(self):
        assert "Arduino Mega or Mega 2560" in ArduinoCLI.supported_devices

    def test_mega_fqbn(self):
        assert ArduinoCLI.supported_devices["Arduino Mega or Mega 2560"] == "arduino:avr:mega"

    def test_supported_devices_has_esp32_devkit(self):
        assert "ESP32 Dev Kit" in ArduinoCLI.supported_devices

    def test_arduino_libraries_has_ethernet(self):
        assert "Ethernet" in ArduinoCLI.arduino_libraries

    def test_dccex_devices_has_csb1(self):
        assert "DCC-EX EX-CSB1" in ArduinoCLI.dccex_devices


# ---------------------------------------------------------------------------
# cli_file_path()
# ---------------------------------------------------------------------------

class TestCliFilePath:
    def test_returns_string(self):
        cli = ArduinoCLI()
        result = cli.cli_file_path()
        assert isinstance(result, str)

    def test_path_contains_ex_installer(self):
        cli = ArduinoCLI()
        result = cli.cli_file_path()
        assert "ex-installer" in result

    def test_path_contains_arduino_cli_dir(self):
        cli = ArduinoCLI()
        result = cli.cli_file_path()
        assert "arduino-cli" in result

    def test_path_ends_with_executable_name(self):
        cli = ArduinoCLI()
        result = cli.cli_file_path()
        if platform.system() == "Windows":
            assert result.endswith("arduino-cli.exe")
        else:
            assert result.endswith("arduino-cli")

    def test_path_is_under_home_directory(self):
        cli = ArduinoCLI()
        result = cli.cli_file_path()
        home = os.path.expanduser("~")
        assert result.startswith(home)


# ---------------------------------------------------------------------------
# is_installed()
# ---------------------------------------------------------------------------

class TestIsInstalled:
    def test_returns_false_for_nonexistent_file(self):
        cli = ArduinoCLI()
        assert cli.is_installed("/nonexistent/path/arduino-cli") is False

    def test_returns_false_for_directory(self, tmp_path):
        cli = ArduinoCLI()
        assert cli.is_installed(str(tmp_path)) is False

    def test_returns_true_for_executable_file(self, tmp_path):
        exe = tmp_path / "arduino-cli"
        exe.write_text("#!/bin/sh\necho hi\n")
        exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
        cli = ArduinoCLI()
        assert cli.is_installed(str(exe)) is True

    def test_returns_false_for_non_executable_file(self, tmp_path):
        f = tmp_path / "arduino-cli"
        f.write_text("not executable")
        # Remove execute permission
        f.chmod(0o644)
        cli = ArduinoCLI()
        assert cli.is_installed(str(f)) is False


# ---------------------------------------------------------------------------
# compile_sketch() — parameter construction
# ---------------------------------------------------------------------------

class TestCompileSketch:
    def _compile_params(self, fqbn, sketch_dir):
        """Run compile_sketch with a mocked ThreadedArduinoCLI; return captured params."""
        cli = ArduinoCLI()
        q = Queue()
        captured = {}

        class FakeThread:
            def __init__(self, path, params, queue, *args, **kwargs):
                captured["path"] = path
                captured["params"] = params

            def start(self):
                pass

        with patch("ex_installer.arduino_cli.ThreadedArduinoCLI", FakeThread):
            with patch.object(cli, "is_installed", return_value=True):
                cli.compile_sketch("/fake/arduino-cli", fqbn, sketch_dir, q)

        return captured["params"]

    def test_compile_uses_compile_subcommand(self):
        params = self._compile_params("arduino:avr:mega", "/sketch")
        assert params[0] == "compile"

    def test_compile_includes_fqbn_flag(self):
        params = self._compile_params("arduino:avr:mega", "/sketch")
        assert "-b" in params
        idx = params.index("-b")
        assert params[idx + 1] == "arduino:avr:mega"

    def test_compile_includes_sketch_dir(self):
        params = self._compile_params("arduino:avr:mega", "/my/sketch")
        assert "/my/sketch" in params

    def test_compile_uses_jsonmini_format(self):
        params = self._compile_params("arduino:avr:mega", "/sketch")
        assert "--format" in params
        idx = params.index("--format")
        assert params[idx + 1] == "jsonmini"

    def test_compile_always_starts_thread_regardless_of_path(self):
        """compile_sketch does not gate on is_installed; it always spawns a thread."""
        cli = ArduinoCLI()
        q = Queue()
        started = []

        class FakeThread:
            def __init__(self, path, params, queue, *args, **kwargs):
                pass

            def start(self):
                started.append(True)

        with patch("ex_installer.arduino_cli.ThreadedArduinoCLI", FakeThread):
            cli.compile_sketch("/fake/arduino-cli", "arduino:avr:mega", "/sketch", q)

        assert len(started) == 1


# ---------------------------------------------------------------------------
# upload_sketch() — parameter construction
# ---------------------------------------------------------------------------

class TestUploadSketch:
    def _upload_params(self, fqbn, port="/dev/ttyACM0", sketch_dir="/sketch"):
        cli = ArduinoCLI()
        q = Queue()
        captured = {}

        class FakeThread:
            def __init__(self, path, params, queue, *args, **kwargs):
                captured["params"] = params

            def start(self):
                pass

        with patch("ex_installer.arduino_cli.ThreadedArduinoCLI", FakeThread):
            with patch.object(cli, "is_installed", return_value=True):
                cli.upload_sketch("/fake/arduino-cli", fqbn, port, sketch_dir, q)

        return captured["params"]

    def test_upload_uses_upload_subcommand(self):
        params = self._upload_params("arduino:avr:mega")
        assert params[0] == "upload"

    def test_upload_includes_fqbn(self):
        params = self._upload_params("arduino:avr:mega")
        assert "-b" in params
        assert params[params.index("-b") + 1] == "arduino:avr:mega"

    def test_upload_includes_port(self):
        params = self._upload_params("arduino:avr:mega", port="/dev/ttyUSB0")
        assert "-p" in params
        assert params[params.index("-p") + 1] == "/dev/ttyUSB0"

    def test_upload_includes_sketch_dir(self):
        params = self._upload_params("arduino:avr:mega", sketch_dir="/my/sketch")
        assert "/my/sketch" in params

    def test_upload_uses_jsonmini_format(self):
        params = self._upload_params("arduino:avr:mega")
        assert "--format" in params
        assert params[params.index("--format") + 1] == "jsonmini"

    def test_esp32_upload_includes_upload_speed(self):
        params = self._upload_params("esp32:esp32:esp32")
        assert "--board-options" in params
        idx = params.index("--board-options")
        assert params[idx + 1] == "UploadSpeed=115200"

    def test_non_esp32_upload_has_no_board_options(self):
        params = self._upload_params("arduino:avr:mega")
        assert "--board-options" not in params

    def test_esp32_csb1_also_gets_upload_speed(self):
        # Any FQBN starting with esp32:esp32 should get the option
        params = self._upload_params("esp32:esp32:esp32s3")
        assert "--board-options" in params

    def test_upload_always_starts_thread_regardless_of_path(self):
        """upload_sketch does not gate on is_installed; it always spawns a thread."""
        cli = ArduinoCLI()
        q = Queue()
        started = []

        class FakeThread:
            def __init__(self, path, params, queue, *args, **kwargs):
                pass

            def start(self):
                started.append(True)

        with patch("ex_installer.arduino_cli.ThreadedArduinoCLI", FakeThread):
            cli.upload_sketch("/fake/arduino-cli", "arduino:avr:mega", "/dev/ttyACM0", "/sketch", q)

        assert len(started) == 1


# ---------------------------------------------------------------------------
# get_version() / get_platforms() — error path when not installed
# ---------------------------------------------------------------------------

class TestNotInstalledErrors:
    @pytest.mark.parametrize("method_name,args", [
        ("get_version",    ["/fake/path", Queue()]),
        ("get_platforms",  ["/fake/path", Queue()]),
        ("get_libraries",  ["/fake/path", Queue()]),
    ])
    def test_queues_error_message_when_not_installed(self, method_name, args):
        cli = ArduinoCLI()
        with patch.object(cli, "is_installed", return_value=False):
            getattr(cli, method_name)(*args)
        q = args[-1]
        msg = q.get_nowait()
        assert msg.status == "error"
        assert "not installed" in msg.topic.lower() or "not installed" in msg.data.lower()


# ---------------------------------------------------------------------------
# download_cli() — URL selection
# ---------------------------------------------------------------------------

class TestDownloadCli:
    def test_selects_linux64_url_on_linux_64bit(self):
        cli = ArduinoCLI()
        q = Queue()

        captured = {}

        class FakeDownloader:
            def __init__(self, url, target, queue):
                captured["url"] = url

            def start(self):
                pass

        with patch("ex_installer.arduino_cli.ThreadedDownloader", FakeDownloader):
            with patch("platform.system", return_value="Linux"):
                with patch("sys.maxsize", 2**63):
                    cli.download_cli(q)

        assert "Linux_64bit" in captured.get("url", "")

    def test_queues_error_for_unsupported_platform(self):
        cli = ArduinoCLI()
        q = Queue()
        with patch("platform.system", return_value=""):
            cli.download_cli(q)
        msg = q.get_nowait()
        assert msg.status == "error"
