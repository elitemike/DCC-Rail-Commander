# EX-Installer

EX-Installer is an Electron + Aurelia 2 cross-platform installer for the various Arduino based DCC-EX products.

This repository is an active rewrite of the original Python/Tkinter EX-Installer. The old app's source lives
in `.old_ex_installer/` for reference only; all active development happens under `src/`.

Binaries will be made available to allow EX-Installer to be run on:

- Windows 10/11
- Linux graphical environments
- macOS

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
```

### WSL requirements

- libgtk-3 shared library:
  `sudo apt-get update && sudo apt-get install -y libgtk-3-0`
- Electron on WSL2 needs extra libs beyond GTK too — nss, libnotify, alsa, xss, etc. If the GTK fix doesn't
  clear it, run the full set:
  `sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libsecret-1-0`

## What's in this repository?

This repository includes all source code of EX-Installer, along with related documentation and screen captures of the initial design ideas.

The binaries are kept in the /dist directory of the repository, and will also be hosted on the [DCC-EX website](https://dcc-ex.com).

### EX-Installer-Configs repository

In addition to this EX-Installer repository, there is a separate repository [EX-Installer-Configs](https://github.com/DCC-EX/EX-Installer-Configs) which contains various configuration information that EX-Installer relies on.

This enables product and device configuration information to be updated without necessarily needing to build a new release of EX-Installer binaries.

## Operating principles and modules

EX-Installer operates within the confines of the user's home directory and temp directory only, with no files or folders outside of these directories being touched.

In Windows, this will typically be `C:\Users\<username>\ex-installer`, and in Linux or macOS `/home/<username>/ex-installer`.

The general operating process of the installer is:

- Detect attached Arduino devices
- Clone the product's GitHub repository
- Prompt for version selection and configuration options
- Compile and upload the configured software to the selected device using a bundled, offline PlatformIO toolchain (see `TOOLCHAIN.md`)

## Supported products

EX-Installer configures and installs the following Arduino based DCC-EX products:

- EX-CommandStation
- EX-IOExpander
- EX-Turntable

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
