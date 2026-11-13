#!/usr/bin/env python3
"""Install only an already-authorized local-file monitor; contains no secrets."""
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys

LABEL = 'local.beijing-h1b.monitor'

def main():
    if sys.platform != 'darwin':
        raise SystemExit('macOS only')
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/install-launch-agent.py /absolute/config.local.json')
    root = pathlib.Path(__file__).resolve().parent.parent
    config = pathlib.Path(sys.argv[1]).resolve(strict=True)
    node = shutil.which('node')
    if not node:
        raise SystemExit('Install Node.js 22+ first')
    subprocess.run([node, str(root / 'src/cli.js'), 'validate-schedule', str(config)], check=True)
    folder = pathlib.Path.home() / 'Library/LaunchAgents'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (LABEL + '.plist')
    if path.exists():
        raise SystemExit('Agent already exists; unload and remove it before reinstalling')
    settings = dict(Label=LABEL, ProgramArguments=[node, str(root / 'src/cli.js'), 'scheduled-check', str(config)], WorkingDirectory=str(root), StartInterval=1800, RunAtLoad=True, ProcessType='Background', Umask=0o077)
    with path.open('xb') as out:
        plistlib.dump(settings, out)
    path.chmod(0o600)
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
    print('Installed: ' + str(path))

if __name__ == '__main__':
    main()
