"""
Unit tests for ex_installer/product_details.py

Verifies the product registry schema, URLs, device support, and required config files.
No GUI, no renderer — pure data structure validation.
"""
import sys
from pathlib import Path

import pytest

# Allow importing ex_installer as a package from the repo root
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

from ex_installer.product_details import product_details  # noqa: E402


REQUIRED_PRODUCT_KEYS = {
    "product_name",
    "repo_name",
    "repo_url",
    "default_branch",
    "supported_devices",
    "minimum_config_files",
}

KNOWN_PRODUCTS = ["ex_commandstation", "ex_ioexpander", "ex_turntable"]


# ---------------------------------------------------------------------------
# Registry completeness
# ---------------------------------------------------------------------------

class TestRegistryCompleteness:
    def test_all_known_products_present(self):
        for product in KNOWN_PRODUCTS:
            assert product in product_details, f"Missing product: {product}"

    def test_no_empty_registry(self):
        assert len(product_details) > 0

    @pytest.mark.parametrize("product", KNOWN_PRODUCTS)
    def test_product_has_all_required_keys(self, product):
        entry = product_details[product]
        for key in REQUIRED_PRODUCT_KEYS:
            assert key in entry, f"Product '{product}' missing key: {key}"

    @pytest.mark.parametrize("product", KNOWN_PRODUCTS)
    def test_product_name_is_non_empty_string(self, product):
        assert isinstance(product_details[product]["product_name"], str)
        assert len(product_details[product]["product_name"]) > 0

    @pytest.mark.parametrize("product", KNOWN_PRODUCTS)
    def test_repo_url_points_to_github(self, product):
        url = product_details[product]["repo_url"]
        assert url.startswith("https://github.com/DCC-EX/"), f"Unexpected URL: {url}"

    @pytest.mark.parametrize("product", KNOWN_PRODUCTS)
    def test_repo_url_ends_with_git(self, product):
        url = product_details[product]["repo_url"]
        assert url.endswith(".git"), f"URL does not end with .git: {url}"

    @pytest.mark.parametrize("product", KNOWN_PRODUCTS)
    def test_supported_devices_is_non_empty_list(self, product):
        devices = product_details[product]["supported_devices"]
        assert isinstance(devices, list)
        assert len(devices) > 0

    @pytest.mark.parametrize("product", KNOWN_PRODUCTS)
    def test_minimum_config_files_is_non_empty_list(self, product):
        files = product_details[product]["minimum_config_files"]
        assert isinstance(files, list)
        assert len(files) > 0


# ---------------------------------------------------------------------------
# EX-CommandStation specifics
# ---------------------------------------------------------------------------

class TestCommandStation:
    def setup_method(self):
        self.entry = product_details["ex_commandstation"]

    def test_product_name(self):
        assert self.entry["product_name"] == "EX-CommandStation"

    def test_default_branch_is_master(self):
        assert self.entry["default_branch"] == "master"

    def test_repo_name(self):
        assert self.entry["repo_name"] == "DCC-EX/CommandStation-EX"

    def test_supports_arduino_mega(self):
        assert "arduino:avr:mega" in self.entry["supported_devices"]

    def test_supports_arduino_uno(self):
        assert "arduino:avr:uno" in self.entry["supported_devices"]

    def test_supports_arduino_nano(self):
        assert "arduino:avr:nano" in self.entry["supported_devices"]

    def test_supports_esp32(self):
        assert "esp32:esp32:esp32" in self.entry["supported_devices"]

    def test_supports_nucleo_f411re(self):
        assert "STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F411RE" in self.entry["supported_devices"]

    def test_supports_nucleo_f446re(self):
        assert "STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE" in self.entry["supported_devices"]

    def test_minimum_config_files_includes_config_h(self):
        assert "config.h" in self.entry["minimum_config_files"]


# ---------------------------------------------------------------------------
# EX-IOExpander specifics
# ---------------------------------------------------------------------------

class TestIOExpander:
    def setup_method(self):
        self.entry = product_details["ex_ioexpander"]

    def test_product_name(self):
        assert self.entry["product_name"] == "EX-IOExpander"

    def test_default_branch_is_main(self):
        assert self.entry["default_branch"] == "main"

    def test_minimum_config_files_includes_myconfig_h(self):
        assert "myConfig.h" in self.entry["minimum_config_files"]

    def test_supports_arduino_nano(self):
        assert "arduino:avr:nano" in self.entry["supported_devices"]

    def test_does_not_support_esp32(self):
        # IOExpander is AVR/STM32 only — no ESP32 in its supported list
        assert "esp32:esp32:esp32" not in self.entry["supported_devices"]


# ---------------------------------------------------------------------------
# EX-Turntable specifics
# ---------------------------------------------------------------------------

class TestTurntable:
    def setup_method(self):
        self.entry = product_details["ex_turntable"]

    def test_product_name(self):
        assert self.entry["product_name"] == "EX-Turntable"

    def test_default_branch_is_main(self):
        assert self.entry["default_branch"] == "main"

    def test_minimum_config_files_includes_config_h(self):
        assert "config.h" in self.entry["minimum_config_files"]

    def test_supports_arduino_uno(self):
        assert "arduino:avr:uno" in self.entry["supported_devices"]

    def test_supports_arduino_nano(self):
        assert "arduino:avr:nano" in self.entry["supported_devices"]
