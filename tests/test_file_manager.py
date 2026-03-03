"""
Unit tests for ex_installer/file_manager.py — FileManager static methods

Tests path building, file read/write, directory operations, config-pattern matching,
and list extraction from files. No GUI, no renderer.
"""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from ex_installer.file_manager import FileManager  # noqa: E402


# ---------------------------------------------------------------------------
# get_base_dir()
# ---------------------------------------------------------------------------

class TestGetBaseDir:
    def test_returns_string(self):
        result = FileManager.get_base_dir()
        assert isinstance(result, str)

    def test_path_ends_with_ex_installer(self):
        result = FileManager.get_base_dir()
        assert result.endswith("ex-installer")

    def test_path_is_under_home_dir(self):
        home = os.path.expanduser("~")
        result = FileManager.get_base_dir()
        assert result.startswith(home)


# ---------------------------------------------------------------------------
# get_install_dir()
# ---------------------------------------------------------------------------

class TestGetInstallDir:
    def test_returns_string(self):
        result = FileManager.get_install_dir("EX-CommandStation")
        assert isinstance(result, str)

    def test_contains_product_name(self):
        result = FileManager.get_install_dir("EX-CommandStation")
        assert "EX-CommandStation" in result

    def test_is_under_base_dir(self):
        base = FileManager.get_base_dir()
        result = FileManager.get_install_dir("EX-CommandStation")
        assert result.startswith(base)


# ---------------------------------------------------------------------------
# get_temp_dir()
# ---------------------------------------------------------------------------

class TestGetTempDir:
    def test_returns_string(self):
        result = FileManager.get_temp_dir()
        assert isinstance(result, str)

    def test_returns_existing_directory(self):
        result = FileManager.get_temp_dir()
        assert os.path.isdir(result)

    def test_matches_system_tempdir(self):
        result = FileManager.get_temp_dir()
        assert result == tempfile.gettempdir()


# ---------------------------------------------------------------------------
# is_valid_dir()
# ---------------------------------------------------------------------------

class TestIsValidDir:
    def test_existing_directory_returns_true(self, tmp_path):
        assert FileManager.is_valid_dir(str(tmp_path)) is True

    def test_nonexistent_directory_returns_false(self, tmp_path):
        missing = str(tmp_path / "does_not_exist")
        assert FileManager.is_valid_dir(missing) is False

    def test_file_path_returns_false(self, tmp_path):
        f = tmp_path / "file.txt"
        f.write_text("hello")
        assert FileManager.is_valid_dir(str(f)) is False

    def test_empty_string_returns_false(self):
        assert FileManager.is_valid_dir("") is False


# ---------------------------------------------------------------------------
# write_config_file() / read_config_file()
# ---------------------------------------------------------------------------

class TestWriteReadConfigFile:
    def test_write_returns_file_path_on_success(self, tmp_path):
        fp = str(tmp_path / "config.h")
        result = FileManager.write_config_file(fp, ["// line1\n", "// line2\n"])
        assert result == fp

    def test_written_content_is_readable(self, tmp_path):
        fp = str(tmp_path / "config.h")
        lines = ["#define MOTOR_SHIELD_TYPE STANDARD_MOTOR_SHIELD\n", "#define ENABLE_WIFI true\n"]
        FileManager.write_config_file(fp, lines)
        content = FileManager.read_config_file(fp)
        assert "#define MOTOR_SHIELD_TYPE STANDARD_MOTOR_SHIELD" in content
        assert "#define ENABLE_WIFI true" in content

    def test_write_creates_file(self, tmp_path):
        fp = str(tmp_path / "new_file.h")
        FileManager.write_config_file(fp, ["// test\n"])
        assert os.path.isfile(fp)

    def test_write_returns_error_string_for_invalid_path(self):
        result = FileManager.write_config_file("/nonexistent/dir/file.h", ["content"])
        # Returns error string, not the path
        assert result != "/nonexistent/dir/file.h"
        assert isinstance(result, str)

    def test_read_returns_error_string_for_missing_file(self, tmp_path):
        fp = str(tmp_path / "missing.h")
        result = FileManager.read_config_file(fp)
        assert isinstance(result, str)
        # Should not raise; returns exception message
        assert result != ""

    def test_write_utf8_encoding(self, tmp_path):
        fp = str(tmp_path / "utf8.h")
        content = ["// Ünïcödé cömment\n"]
        FileManager.write_config_file(fp, content)
        result = FileManager.read_config_file(fp)
        assert "Ünïcödé" in result

    def test_overwrite_replaces_contents(self, tmp_path):
        fp = str(tmp_path / "config.h")
        FileManager.write_config_file(fp, ["// old\n"])
        FileManager.write_config_file(fp, ["// new\n"])
        content = FileManager.read_config_file(fp)
        assert "// new" in content
        assert "// old" not in content


# ---------------------------------------------------------------------------
# get_filepath()
# ---------------------------------------------------------------------------

class TestGetFilepath:
    def test_joins_dir_and_filename(self, tmp_path):
        result = FileManager.get_filepath(str(tmp_path), "config.h")
        assert result == os.path.join(str(tmp_path), "config.h")


# ---------------------------------------------------------------------------
# get_config_files()
# ---------------------------------------------------------------------------

class TestGetConfigFiles:
    def test_returns_false_for_nonexistent_dir(self, tmp_path):
        missing = str(tmp_path / "no_dir")
        result = FileManager.get_config_files(missing, ["config.h"])
        assert result is False

    def test_finds_exact_filename(self, tmp_path):
        (tmp_path / "config.h").write_text("// config")
        (tmp_path / "readme.txt").write_text("readme")
        result = FileManager.get_config_files(str(tmp_path), ["config.h"])
        assert "config.h" in result

    def test_does_not_return_non_matching_file(self, tmp_path):
        (tmp_path / "config.h").write_text("")
        result = FileManager.get_config_files(str(tmp_path), ["config.h"])
        assert "readme.txt" not in result

    def test_regex_pattern_with_group(self, tmp_path):
        # Pattern matches myConfig.h but group captures it
        (tmp_path / "myConfig.h").write_text("")
        pattern = r"^(myConfig\.h)$"
        result = FileManager.get_config_files(str(tmp_path), [pattern])
        assert "myConfig.h" in result

    def test_commandstation_myautomation_pattern(self, tmp_path):
        # Matches myAutomation.h via the standard EX-CommandStation pattern
        (tmp_path / "myAutomation.h").write_text("")
        pattern = r"^my.*\.[^?]*example\.h$|(^my.*\.h$)"
        result = FileManager.get_config_files(str(tmp_path), [pattern])
        assert "myAutomation.h" in result

    def test_empty_dir_returns_empty_list(self, tmp_path):
        result = FileManager.get_config_files(str(tmp_path), ["config.h"])
        assert result == []

    def test_multiple_patterns_matched(self, tmp_path):
        (tmp_path / "config.h").write_text("")
        (tmp_path / "myConfig.h").write_text("")
        patterns = ["config.h", r"^(myConfig\.h)$"]
        result = FileManager.get_config_files(str(tmp_path), patterns)
        assert "config.h" in result
        assert "myConfig.h" in result


# ---------------------------------------------------------------------------
# get_list_from_file()
# ---------------------------------------------------------------------------

class TestGetListFromFile:
    def test_returns_false_for_missing_file(self, tmp_path):
        fp = str(tmp_path / "missing.txt")
        result = FileManager.get_list_from_file(fp, r"(.*)")
        assert result is False

    def test_extracts_matching_group(self, tmp_path):
        fp = str(tmp_path / "boards.txt")
        Path(fp).write_text("arduino:avr:mega\narduino:avr:uno\n")
        result = FileManager.get_list_from_file(fp, r"(arduino:avr:\w+)")
        assert "arduino:avr:mega" in result
        assert "arduino:avr:uno" in result

    def test_deduplicates_results(self, tmp_path):
        fp = str(tmp_path / "data.txt")
        Path(fp).write_text("foo\nfoo\nbar\n")
        result = FileManager.get_list_from_file(fp, r"(foo|bar)")
        assert result.count("foo") == 1

    def test_returns_empty_list_when_no_matches(self, tmp_path):
        fp = str(tmp_path / "data.txt")
        Path(fp).write_text("no match here\n")
        result = FileManager.get_list_from_file(fp, r"(NOTFOUND)")
        assert result == []


# ---------------------------------------------------------------------------
# rename_dir()
# ---------------------------------------------------------------------------

class TestRenameDir:
    def test_renames_existing_directory(self, tmp_path):
        src = tmp_path / "source"
        dst = tmp_path / "target"
        src.mkdir()
        result = FileManager.rename_dir(str(src), str(dst))
        assert result is True
        assert dst.is_dir()
        assert not src.exists()

    def test_returns_false_for_nonexistent_source(self, tmp_path):
        src = str(tmp_path / "no_source")
        dst = str(tmp_path / "target")
        result = FileManager.rename_dir(src, dst)
        assert result is False

    def test_returns_false_when_target_already_exists(self, tmp_path):
        src = tmp_path / "source"
        dst = tmp_path / "target"
        src.mkdir()
        dst.mkdir()
        result = FileManager.rename_dir(str(src), str(dst))
        assert result is False


# ---------------------------------------------------------------------------
# copy_config_files() / delete_config_files()
# ---------------------------------------------------------------------------

class TestCopyAndDeleteConfigFiles:
    def test_copy_returns_none_on_success(self, tmp_path):
        src_dir = tmp_path / "src"
        dst_dir = tmp_path / "dst"
        src_dir.mkdir()
        dst_dir.mkdir()
        (src_dir / "config.h").write_text("// config")
        result = FileManager.copy_config_files(str(src_dir), str(dst_dir), ["config.h"])
        assert result is None
        assert (dst_dir / "config.h").is_file()

    def test_copy_returns_failed_list_on_error(self, tmp_path):
        src_dir = str(tmp_path / "src")
        dst_dir = str(tmp_path / "dst")
        os.makedirs(dst_dir)
        result = FileManager.copy_config_files(src_dir, dst_dir, ["missing.h"])
        assert isinstance(result, list)
        assert "missing.h" in result

    def test_delete_returns_none_on_success(self, tmp_path):
        (tmp_path / "config.h").write_text("")
        result = FileManager.delete_config_files(str(tmp_path), ["config.h"])
        assert result is None
        assert not (tmp_path / "config.h").exists()

    def test_delete_returns_failed_list_when_file_missing(self, tmp_path):
        result = FileManager.delete_config_files(str(tmp_path), ["nonexistent.h"])
        assert isinstance(result, list)
        assert "nonexistent.h" in result
