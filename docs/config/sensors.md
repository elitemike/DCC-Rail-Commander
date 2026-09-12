# Sensors

The Sensors editor manages `mySensors.h` — a friendly-name lookup for the VPins your sensors live on. It's
purely bookkeeping for this app's own Visual editor: EXRAIL has no sensor-declaration macro at all, and a
VPin needs no declaration to be usable in `ONSENSOR`/`AT`/`IF` — see Raw view below.

![Sensors editor, showing the list of sensor rows with Pin, Description, and Alias fields](../assets/screenshots/sensors-editor.png)

## Visual and Raw views

Like other config files, Sensors has a **Visual** tab (the row list described below) and a **Raw** tab — a
Monaco text editor showing `mySensors.h` exactly as it will be written to disk. Edits made in either tab sync to
the other.

## Adding a sensor

Click **Add Sensor**. A new row is created with:

- **Pin** — the next free VPin at or above 100 (VPins 0–99 are conventionally reserved for physical MCU pins).
- **Description** — "New Sensor".

## Sensor fields

| Field | Notes |
|---|---|
| **Pin** | The VPin the sensor reads — also the sensor's number, as referenced elsewhere in EX-RAIL (`ONSENSOR`, `AT`, `IF`, ...). Either type a raw pin number directly, or pick one of your configured accessory boards and a channel — the VPin is computed for you. See [Accessories](accessories.md). |
| **Description** | Free-text friendly name, shown only in this app's Visual editor — see Raw view below. |
| **Alias** | Optional name other config files and EX-RAIL scripts can use instead of the raw pin number. This is the one piece of a sensor's identity that's real, compiled EXRAIL. See [Aliases](aliases.md). |

Click **×** on a row to remove that sensor.

## Aliases and Strict aliases

Each row has its own **Alias** field, backed by the same alias mechanism used across the app: letters, numbers,
and underscores only, must start with a letter or underscore, and can't be an EX-RAIL command name. Renaming a
sensor's Pin carries its existing alias forward to the new pin automatically.

!!! note "Strict aliases"
    An app preference: when enabled, a row with no alias shows an amber dot next to its Alias label, and no
    other field on that row (Pin or Description) can be saved until an alias is set — the edit reverts and
    a toast explains why.

## Raw view

The Raw tab shows `mySensors.h` as plain comments — `// Sensor <pin> - <description>` — mapping each VPin to
its friendly name for this app's own Visual editor. There's nothing to compile here: EXRAIL has no sensor
declaration macro, and a VPin needs no declaration at all to be used in `ONSENSOR`/`AT`/`IF`. If EX-RAIL
scripts or other config files need to refer to a sensor by name, that's what its **Alias** is for, not this
file.

!!! note "Importing a hand-written project"
    A real, hand-written EXRAIL project may declare sensors with `JMRI_SENSOR(vpin[, count])` — the real
    macro that makes a sensor visible to JMRI/WiThrottle. Loading one still reads its sensors correctly and
    accounts for their VPins, but saving downgrades them to plain bookkeeping comments like every other
    entry — the real `JMRI_SENSOR` declaration is not preserved. If you need a sensor to stay JMRI-visible,
    keep its `JMRI_SENSOR(...)` line in a different file (e.g. a custom EXRAIL file created from the
    Configuration list), not `mySensors.h`.
