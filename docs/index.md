# DCC Rail Commander

**DCC Rail Commander** is a cross-platform desktop app for configuring, building, and flashing firmware for
[DCC-EX](https://dcc-ex.com) Arduino-based products. It replaces hand-editing `#define`s and EX-RAIL scripts
with visual editors, while still letting you drop into raw text whenever you want to.

!!! warning "Not an official DCC-EX project"
    DCC Rail Commander works with DCC-EX products, but it is developed and maintained **independently**. It
    receives no support from the DCC-EX team. For official DCC-EX support, see [dcc-ex.com](https://dcc-ex.com).

!!! note "Current support"
    Right now, **EX-CommandStation** is the only officially supported product, and only on the **EX-CSB1**
    board, set up through the [New Device Wizard](device-wizard.md)'s guided visual setup. Other boards and
    products (EX-IOExpander, EX-Turntable) aren't officially supported yet.

## What this guide covers

This is a **user guide** — how to use the app once it's installed. For build-from-source instructions, see the
[repository README](https://github.com/elitemike/DCC-Rail-Commander#readme).

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } **Getting Started**

    ---

    Install the app, launch it for the first time, and understand the three ways to bring a device into it.

    [:octicons-arrow-right-24: Getting Started](getting-started.md)

-   :material-usb-port:{ .lg .middle } **New Device Wizard**

    ---

    Walk a fresh board through device selection, firmware version, WiFi, hardware, and track power.

    [:octicons-arrow-right-24: New Device Wizard](device-wizard.md)

-   :material-view-dashboard:{ .lg .middle } **Workspace Overview**

    ---

    The main editing screen: file navigation, Save, Compile, Connect, and the Monitor/Output panel.

    [:octicons-arrow-right-24: Workspace Overview](workspace-overview.md)

-   :material-file-cog:{ .lg .middle } **Configuration Files**

    ---

    Visual editors for your roster, turnouts, sensors, signals, routes, sequences, and more.

    [:octicons-arrow-right-24: Configuration Files](config/roster.md)

</div>

## How it fits together

Every board you set up gets its own independent, isolated configuration — even two configurations for the
exact same physical board never share files. Editing is split between:

- **Device Settings** — hardware-level things: WiFi, motor driver, display, HAL accessory boards, track power
  at startup, and the low-level file that links everything together.
- **Configuration Files** — the EX-RAIL side: your roster of locomotives, turnouts, sensors, signals, routes,
  automation sequences, and event handlers.

Every visual editor has a **Raw** view beside it, showing the exact text that gets written to your device's
config files — nothing is hidden from you, and you can hand-edit at any time.

## Compile is always real

Even when no hardware is attached, DCC Rail Commander compiles firmware for real against a bundled, fully
offline PlatformIO toolchain — no network access required after first install, and no cloud build service in
the loop. Only the final upload step needs a connected board.
