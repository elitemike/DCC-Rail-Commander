# EX-Installer — Feature Plan

---

## Onboarding

### First Load

- Inform the user that Arduino CLI is required, and possibly the ESP32 platform.
- Offer to **download** the CLI or **load from an existing local file**.
  - Open question: can the CLI run if it's already on the user's `PATH`, or do we always need a local copy in the app directory?

### Subsequent Loads

- Check for newer versions of the CLI and related platform files.
- Same options as first load: download or load from a local file.

---

## Home Screen

- Continue with a **previously configured device**.
- Create a **new device**.
- **Import an existing configuration** that hasn't been added to the application yet.

---

## New Device Creation

1. **Select Device** — show supported devices based on installed CLI platforms; prompt to install missing platforms if needed.
2. **Select Product** — choose the DCC-EX product to configure.
3. **Select Version** — choose the target firmware version.
4. **Review** — assign an internal name/description (not visible in the firmware).

---

## Device Configuration

> **Sync requirement:** whenever a visual editor is available, the raw (Monaco) editor must stay in sync with the GUI — changes in either direction are reflected immediately.

### `config.h` — Visual Editor

- GUI form for Wi-Fi credentials and other board-level settings.
- Layout may be product-specific (e.g. EX-CommandStation vs EX-IOExpander).

### `myRoster.h` / `myTurnouts.h` — Visual Editors

- GUI should always be present, even if the user hasn't added any entries yet.
- As soon as entries are created, a `myAutomation.h` file must exist with `#include` directives for each populated file.

### `myAutomation.h` — Auto-managed

- Generated/maintained by the installer.
- Contains `#include` statements for roster and turnout files as they are populated.

### Monaco Editor — Raw View

- Available for all configuration files as a raw fallback.
- **Must stay in sync** with the visual editor.
- Shall include **IntelliSense and validation** for supported file types.
  - Roster and turnout files should be treated as closed schemas: the installer protects users from adding arbitrary content via the GUI, while still allowing freeform edits in Monaco outside of installer-managed sections.
  - Constraining the expected content makes IntelliSense configuration significantly simpler.

> **Note:** The [dcc-ex_ui](https://github.com/elitemike/dcc-ex_ui) project provides a parser that can be used to import and parse existing configurations for users who are migrating into the installer for the first time.