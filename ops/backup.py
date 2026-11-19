"""Create and verify a private, self-contained Pearl Monitor data backup."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile


def check_db(path):
    with sqlite3.connect(f'{path.as_uri()}?mode=ro', uri=True) as db:
        if db.execute('PRAGMA quick_check').fetchone() != ('ok',):
            raise RuntimeError('SQLite integrity check failed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--ledger', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--remote')
    parser.add_argument('--identity', type=Path)
    parser.add_argument('--passphrase', type=Path)
    args = parser.parse_args()
    if args.remote and (not args.identity or not args.passphrase):
        parser.error('--remote requires --identity and --passphrase')
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    archive = args.output / f'pearl-monitor-{stamp}.tar.gz'
    config = Path.home() / '.config'
    with tempfile.TemporaryDirectory(dir=args.output) as tmp:
        stage = Path(tmp)
        ledger = stage / 'ledger' / 'controller.sqlite3'
        ledger.parent.mkdir()
        with sqlite3.connect(f'{args.ledger.resolve().as_uri()}?mode=ro', uri=True) as src, sqlite3.connect(ledger) as dst:
            src.backup(dst)
        check_db(ledger)
        workbook = args.ledger.parent.parent / 'Rig VAST.xlsx'
        if workbook.is_file():
            shutil.copyfile(workbook, ledger.parent / workbook.name)
        for item in ('receipts', 'imports'):
            source = args.ledger.parent / item
            if source.is_dir():
                shutil.copytree(source, ledger.parent / item)
        for item in ('sales.json', 'mining-history.json'):
            source = args.app / 'data' / item
            if source.is_file():
                dest = stage / 'app-data' / item
                dest.parent.mkdir(exist_ok=True)
                content = source.read_bytes()
                json.loads(content)
                dest.write_bytes(content)
        for item in ('pearl-monitor.env', 'pearl-monitor-rigs.json', 'systemd/user/pearl-monitor.service',
                     'systemd/user/pearl-finance.service', 'systemd/user/pearl-backup.service', 'systemd/user/pearl-backup.timer'):
            source = config / item
            if source.is_file():
                dest = stage / 'config' / item
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, dest)
        manifest = {p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in stage.rglob('*') if p.is_file()}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        pending = stage / 'backup.tar.gz'
        with tarfile.open(pending, 'w:gz') as bundle:
            for item in [*manifest, 'manifest.json']:
                bundle.add(stage / item, arcname=item)
        with tarfile.open(pending, 'r:gz') as bundle:
            for item, digest in manifest.items():
                if hashlib.sha256(bundle.extractfile(item).read()).hexdigest() != digest:
                    raise RuntimeError('Backup checksum mismatch')
            restored = stage / 'restored.sqlite3'
            with restored.open('wb') as output:
                shutil.copyfileobj(bundle.extractfile('ledger/controller.sqlite3'), output)
            check_db(restored)
        os.replace(pending, archive)
        if args.remote:
            encrypted = stage / f'{archive.name}.gpg'
            subprocess.run(['gpg', '--batch', '--pinentry-mode', 'loopback',
                '--passphrase-file', str(args.passphrase), '--symmetric', '--cipher-algo', 'AES256',
                '--output', str(encrypted), str(archive)], check=True, timeout=45)
            digest = hashlib.sha256(encrypted.read_bytes()).hexdigest()
            name = encrypted.name
            command = ('umask 077; set -eu; dir="$HOME/.local/share/pearl-backups"; '
                'mkdir -p "$dir"; chmod 700 "$dir"; '
                f'tmp=$(mktemp "$dir/.{name}.XXXXXX"); '
                '''trap 'rm -f -- "$tmp"' EXIT; cat > "$tmp"; '''
                f'printf "%s  %s\\n" {digest} "$tmp" | sha256sum --check --status; '
                f'mv -- "$tmp" "$dir/{name}"')
            with encrypted.open('rb') as stream:
                subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                    '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=8', '-i', str(args.identity),
                    '--', args.remote, command], stdin=stream, check=True, timeout=75)
    print(archive)


if __name__ == '__main__':
    main()
