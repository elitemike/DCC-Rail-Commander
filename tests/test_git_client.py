"""
Unit tests for ex_installer/git_client.py — GitClient static methods

Tests pure logic: version string parsing, directory validation, helper functions.
No network, no real repository cloning, no GUI.
"""
import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from ex_installer.git_client import GitClient, get_exception  # noqa: E402


# ---------------------------------------------------------------------------
# get_exception()
# ---------------------------------------------------------------------------

class TestGetException:
    def test_returns_string(self):
        result = get_exception(ValueError("test message"))
        assert isinstance(result, str)

    def test_includes_exception_type(self):
        result = get_exception(ValueError("oops"))
        assert "ValueError" in result

    def test_includes_exception_args(self):
        result = get_exception(RuntimeError("something went wrong"))
        assert "something went wrong" in result

    def test_works_with_ioerror(self):
        result = get_exception(IOError("disk full"))
        assert isinstance(result, str)
        assert len(result) > 0


# ---------------------------------------------------------------------------
# extract_version_details()
# ---------------------------------------------------------------------------

class TestExtractVersionDetails:
    def test_parses_prod_version(self):
        result = GitClient.extract_version_details("v5.0.0-Prod")
        assert result == (5, 0, 0)

    def test_parses_devel_version(self):
        result = GitClient.extract_version_details("v4.2.67-Devel")
        assert result == (4, 2, 67)

    def test_parses_major_version(self):
        major, minor, patch = GitClient.extract_version_details("v10.0.0-Prod")
        assert major == 10

    def test_parses_minor_version(self):
        major, minor, patch = GitClient.extract_version_details("v1.3.0-Prod")
        assert minor == 3

    def test_parses_patch_version(self):
        major, minor, patch = GitClient.extract_version_details("v1.0.7-Prod")
        assert patch == 7

    def test_returns_none_tuple_for_invalid_string(self):
        result = GitClient.extract_version_details("not-a-version")
        assert result == (None, None, None)

    def test_returns_none_tuple_for_empty_string(self):
        result = GitClient.extract_version_details("")
        assert result == (None, None, None)

    def test_returns_none_for_partial_version(self):
        # Missing -Prod/-Devel suffix
        result = GitClient.extract_version_details("v1.2.3")
        assert result == (None, None, None)

    def test_returns_none_for_wrong_tag_type(self):
        # "Beta" is not a recognised type
        result = GitClient.extract_version_details("v1.2.3-Beta")
        assert result == (None, None, None)

    def test_multi_digit_patch(self):
        major, minor, patch = GitClient.extract_version_details("v4.2.258-Devel")
        assert patch == 258

    def test_returns_integers_not_strings(self):
        major, minor, patch = GitClient.extract_version_details("v3.1.4-Prod")
        assert isinstance(major, int)
        assert isinstance(minor, int)
        assert isinstance(patch, int)


# ---------------------------------------------------------------------------
# dir_is_git_repo()
# ---------------------------------------------------------------------------

class TestDirIsGitRepo:
    def test_returns_true_for_dir_with_dot_git(self, tmp_path):
        git_file = tmp_path / ".git"
        git_file.write_text("gitdir: ...")
        assert GitClient.dir_is_git_repo(str(tmp_path)) is True

    def test_returns_false_for_dir_without_dot_git(self, tmp_path):
        assert GitClient.dir_is_git_repo(str(tmp_path)) is False

    def test_returns_false_for_nonexistent_dir(self, tmp_path):
        missing = str(tmp_path / "no_such_dir")
        assert GitClient.dir_is_git_repo(missing) is False

    def test_dot_git_as_directory_also_works(self, tmp_path):
        git_dir = tmp_path / ".git"
        git_dir.mkdir()
        assert GitClient.dir_is_git_repo(str(tmp_path)) is True

    def test_returns_false_for_empty_string(self):
        assert GitClient.dir_is_git_repo("") is False
