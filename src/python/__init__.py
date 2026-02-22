"""
EX-Installer Python helper scripts.

Scripts placed here are bundled under  <resources>/python/  at build time
(see electron-builder config in package.json) and invoked from the Electron
main process via PythonRunner / python-shell.

Convention
----------
- Scripts read CLI args from sys.argv (or stdin when used interactively).
- Print results one line at a time so python-shell streams them in real time.
- Exit with code 0 on success, non-zero on failure.

Example
-------
Run via PythonService in the renderer:

  await pythonService.run({
    script: 'detect_boards.py',
    args: ['--port', '/dev/ttyUSB0'],
  })
"""
