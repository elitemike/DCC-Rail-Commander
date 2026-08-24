# EX-Commander

EX-Commander is an Electron + Aurelia 2 cross-platform installer for the various Arduino based DCC-EX products.

This repository is an active rewrite of the original Python/Tkinter EX-Installer. The old app's source lives
in `.old_ex_installer/` for reference only; all active development happens under `src/`.

Binaries will be made available to allow EX-Commander to be run on:

- Windows 10/11
- Linux graphical environments
- macOS

## Features

- **Fully offline build backend** — a bundled Python interpreter and PlatformIO Core compile firmware with no
  runtime downloads; an HTTP fuse makes any unexpected package fetch fail loudly instead of silently
  succeeding online (see `TOOLCHAIN.md`).
- **Multi-board isolation** — each physical board gets its own scratch directory and PlatformIO build
  environment, keyed by board type and serial number, so multiple connected boards never share build state.
- **Mock mode for development** — `pnpm dev:mock` fakes USB/serial device discovery and firmware upload so you
  can exercise the full wizard and workspace without real hardware attached; compiling is always real.
- **Bundled AVR/ESP32 toolchains**, with STM32 (and other) boards supported via an in-app toolchain-pack
  import.
- **Cross-platform packaging** — `pnpm package`/`pnpm release` produce a Windows NSIS installer, a Linux
  AppImage/deb, or a macOS dmg from the same codebase.

## Getting started

### Prerequisites

- **Node.js 24.x or later** (see `engines.node` in `package.json`). Older Node 22.x releases are not
  supported here — in particular Node 22.12.0's bundled Corepack has a bug
  (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`) that breaks `pnpm install` outright, and pnpm itself refuses
  to run on Node < 22.13 anyway. If you manage Node versions with `nvm`/`nvm-windows`, run
  `nvm install 24 && nvm use 24`.
- **pnpm**, via Corepack (bundled with Node). This repo pins an exact pnpm version through the
  `packageManager` field in `package.json`, so you don't need to install pnpm separately:

  ```shell
  corepack enable
  ```

  If `corepack enable`/`pnpm install` fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`, your global
  Corepack install is too old for your Node version — update it with `npm install -g corepack@latest` and
  retry.

### Install and run

> **Note:** this repo is still hosted at `DCC-EX/EX-Installer` on GitHub pending a repository rename; the
> clone URL below will need updating once that rename happens.

```shell
git clone https://github.com/DCC-EX/EX-Installer.git
cd EX-Installer
pnpm install       # also downloads the bundled Python/PlatformIO toolchain (postinstall, network required once)
pnpm dev           # start the app with hot reload
pnpm dev:mock      # start with fake USB/serial devices, no hardware needed
```

Other useful commands (see `CLAUDE.md` for the full list):

```shell
pnpm build         # electron-vite build -> out/
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest unit tests
pnpm test:e2e      # playwright end-to-end tests (runs pnpm build first)
pnpm package       # build + electron-builder -> release/
pnpm release       # one-command build: checks Node, installs, builds, packages -> release/
```

`pnpm release` is the easiest way to produce a native executable for whatever machine you run it on — a
Windows `.exe` (NSIS installer), macOS `.dmg`, or Linux `.AppImage`/`.deb`, depending on the OS. It needs
network access once if the bundled Python/PlatformIO toolchain hasn't been fetched yet for that OS/arch
(see `TOOLCHAIN.md`); after that it's offline and fast to re-run.

### WSL requirements

- libgtk-3 shared library:
  `sudo apt-get update && sudo apt-get install -y libgtk-3-0`
- Electron on WSL2 needs extra libs beyond GTK too — nss, libnotify, alsa, xss, etc. If the GTK fix doesn't
  clear it, run the full set:
  `sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0`
- `pnpm release` (and any Electron-rebuild of native modules, e.g. after `pnpm install`) needs `libudev.h` to
  compile the `usb` package's native binding. Without it node-gyp fails with
  `fatal error: libudev.h: No such file or directory`. Fix:
  `sudo apt-get install -y libudev-dev`
  If a build already failed partway, clear the stale build output before retrying:
  `rm -rf node_modules/usb/build`

## What's in this repository?

This repository includes all source code of EX-Commander, along with related documentation and screen captures of the initial design ideas.

The binaries are produced in the `release/` directory when building locally (see "Building binaries" below), and will also be hosted on the [DCC-EX website](https://dcc-ex.com).

### EX-Installer-Configs repository

In addition to this repository, there is a separate repository [EX-Installer-Configs](https://github.com/DCC-EX/EX-Installer-Configs) which contains various configuration information that EX-Commander relies on.

This enables product and device configuration information to be updated without necessarily needing to build a new release of EX-Commander binaries.

## Operating principles and modules

EX-Commander operates within the confines of the user's home directory and temp directory only, with no files or folders outside of these directories being touched.

In Windows, this will typically be `C:\Users\<username>\ex-commander`, and in Linux or macOS `/home/<username>/ex-commander`.

The general operating process of the installer is:

- Detect attached Arduino devices
- Clone the product's GitHub repository
- Prompt for version selection and configuration options
- Compile and upload the configured software to the selected device using a bundled, offline PlatformIO toolchain (see `TOOLCHAIN.md`)

## Supported products

EX-Commander configures and installs the following Arduino based DCC-EX products:

- EX-CommandStation
- EX-IOExpander *(not yet tested)*
- EX-Turntable *(not yet tested)*

## Versioning

The application version is tracked in `package.json`, using the standard `<Major>.<Minor>.<Patch>` semantic
versioning scheme.

Once a release is built and published, a GitHub tag must be created against that commit also.

## Building binaries

```shell
pnpm package   # build + electron-builder -> release/
```

See `pnpm package` in `package.json`'s `build` config for per-OS target details (NSIS on Windows, AppImage/deb
on Linux, dmg on macOS).
