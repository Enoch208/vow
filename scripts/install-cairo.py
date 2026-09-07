import hashlib
import pathlib
import platform
import subprocess
import tarfile

root = pathlib.Path(__file__).resolve().parents[1]
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This bootstrap pins macOS arm64 artifacts. Install matching official tool versions on other platforms.')

releases = [
    ('scarb', 'software-mansion/scarb', '2.17.0', 'scarb', 'eda88f32ec1c95a1159cd2cce4fb4a1c49dc66067b3f05fb3439254ab25e8294'),
    ('foundry', 'foundry-rs/starknet-foundry', '0.63.0', 'starknet-foundry', '17f9c556f740e5bb3caade1416ead6e059d2675b1f1ea50634cb79b9729b3a6f'),
    ('usc', 'software-mansion/universal-sierra-compiler', '2.10.0', 'universal-sierra-compiler', '3b7806314732b7cff266b95fcf0c8f0927e4776819e36f94a2c2a2eaff8ad2d0'),
]
tools = root / '.tools'
tools.mkdir(exist_ok=True)
for directory, repository, version, prefix, expected in releases:
    filename = f'{prefix}-v{version}-aarch64-apple-darwin.tar.gz'
    archive = tools / f'{directory}.tar.gz'
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '180', f'https://github.com/{repository}/releases/download/v{version}/{filename}', '-o', str(archive)], check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Checksum mismatch: {filename}')
    with tarfile.open(archive) as bundle:
        bundle.extractall(tools / directory, filter='data')
    print(f'{prefix} {version}: checksum verified and installed locally')
