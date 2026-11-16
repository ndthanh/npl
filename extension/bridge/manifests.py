"""Owner of the per-build manifests (native offsets inside Teams' EmbeddedBrowserWebView.dll).

Everything that needs to know "is this WebView2 build supported, and where do its offsets come from" asks
this module, so the bridge, the environment check, the manifest generator and the diagnostics all give the
same answer and the same explanation.

A manifest is a JSON file named <sha256 of the dll>.json. Lookup order (first valid file wins):
  1. bridge/build.json            (bundled, the build the extension was released with)
  2. bridge/builds/<sha256>.json  (bundled)
  3. <state>/builds/<sha256>.json (generated on this machine; survives extension upgrades)
"""
import hashlib
import json
import os
import pathlib
import re
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
USER_BUILDS = pathlib.Path(os.environ.get('NOPILOT_BUILDS_DIR') or (pathlib.Path(os.environ.get('LOCALAPPDATA') or pathlib.Path.home()) / 'nopilot' / 'builds'))
MODULE_NAME = 'EmbeddedBrowserWebView.dll'
SHA_RE = re.compile(r'^[0-9a-f]{64}$')
VERSION_RE = re.compile(r'^\d+\.\d+\.\d+\.\d+$')
# The frame offsets are always required. The Teams-shell ("core") offsets are only needed to open the Copilot panel for the user.
REQUIRED = ('moduleSha256', 'frameVtable', 'frameExecute')
OFFSETS = ('frameVtable', 'frameExecute', 'coreVtable', 'coreExecute')


class ManifestError(ValueError):
    """A manifest file exists but cannot be used. The message names the file and the reason."""


def search_locations():
    """[(label, path-or-folder)] in lookup order."""
    return [('bundled build.json', HERE / 'build.json'), ('bundled builds folder', HERE / 'builds'), ('machine builds folder', USER_BUILDS)]


def runtime_version(module_path):
    """'157.0.4341.46' from ...\\Application\\157.0.4341.46\\EBWebView\\x64\\EmbeddedBrowserWebView.dll, or None. Display only."""
    for part in reversed(pathlib.PureWindowsPath(str(module_path)).parts):
        if VERSION_RE.match(part):
            return part
    return None


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate(value, source='manifest'):
    """Return value when it has the keys and types the agent needs, else raise ManifestError."""
    if not isinstance(value, dict):
        raise ManifestError(f'{source}: expected a JSON object')
    for key in REQUIRED:
        if key not in value:
            raise ManifestError(f'{source}: missing "{key}"')
    if not SHA_RE.match(str(value['moduleSha256'])):
        raise ManifestError(f'{source}: "moduleSha256" is not a 64-digit hex SHA-256')
    for key in OFFSETS:
        if key in value and (not isinstance(value[key], int) or isinstance(value[key], bool) or not 0 < value[key] < 0x40000000):
            raise ManifestError(f'{source}: "{key}" must be a positive integer RVA, got {value[key]!r}')
    if ('coreVtable' in value) != ('coreExecute' in value):
        raise ManifestError(f'{source}: "coreVtable" and "coreExecute" must be given together')
    return value


def read(path):
    try:
        text = pathlib.Path(path).read_text(encoding='utf-8-sig')
    except OSError as error:
        raise ManifestError(f'{path}: cannot read ({error})') from error
    try:
        return validate(json.loads(text), str(path))
    except json.JSONDecodeError as error:
        raise ManifestError(f'{path}: not valid JSON ({error})') from error


def candidates(digest):
    """Every file that could hold the manifest for this dll: [(label, path)]."""
    out = [('bundled build.json', HERE / 'build.json')]
    for label, folder in search_locations()[1:]:
        out.append((label, folder / (digest + '.json')))
    return out


def find(digest):
    """Look the dll up. Returns (manifest|None, trace).

    trace is a list of {label, path, status, detail}: status is hit | other-build | missing | invalid. A broken file is
    reported and skipped, never allowed to hide a valid manifest further down the list."""
    trace = []
    found = None
    for label, path in candidates(digest):
        entry = {'label': label, 'path': str(path)}
        if not path.is_file():
            entry['status'] = 'missing'
        else:
            try:
                manifest = read(path)
            except ManifestError as error:
                entry.update(status='invalid', detail=str(error))
            else:
                if manifest['moduleSha256'] == digest:
                    entry.update(status='hit', runtimeVersion=manifest.get('runtimeVersion'), method=manifest.get('discoveryMethod', 'pdb'))
                    found = found or manifest
                else:
                    entry.update(status='other-build', runtimeVersion=manifest.get('runtimeVersion'))
        trace.append(entry)
    return found, trace


def known_builds():
    """{sha256: {runtimeVersion, source}} over every readable manifest on this machine."""
    out = {}
    files = [HERE / 'build.json']
    for folder in (HERE / 'builds', USER_BUILDS):
        if folder.is_dir():
            files.extend(sorted(folder.glob('*.json')))
    for path in files:
        try:
            manifest = read(path)
        except ManifestError:
            continue
        out[manifest['moduleSha256']] = {'runtimeVersion': manifest.get('runtimeVersion'), 'source': str(path), 'method': manifest.get('discoveryMethod', 'pdb')}
    return out


def save(manifest, folder=None):
    """Write <folder>/<sha256>.json atomically. Returns the path."""
    validate(manifest, 'new manifest')
    folder = pathlib.Path(folder or USER_BUILDS)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / (manifest['moduleSha256'] + '.json')
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=folder, suffix='.tmp', delete=False) as file:
        temporary = pathlib.Path(file.name)
    try:
        temporary.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


class BuildUnsupported(RuntimeError):
    """The running WebView2 build has no usable manifest. Carries everything needed to explain and fix it."""

    def __init__(self, module_path, digest, trace):
        self.module_path = str(module_path)
        self.digest = digest
        self.trace = trace
        self.runtime = runtime_version(module_path)
        super().__init__(self.describe())

    def describe(self):
        lines = [f'WebView2 build changed: Teams is running WebView2 {self.runtime or "(version unknown)"} whose '
                 f'{MODULE_NAME} (sha256 {self.digest[:16]}...) has no manifest, so native calls are refused (nothing was sent to Teams).']
        broken = [t for t in self.trace if t['status'] == 'invalid']
        for item in broken:
            lines.append(f'A manifest file was found but is unusable: {item["detail"]}')
        lines.append('Fix: run "Nopilot: Tạo manifest cho bản Teams này" (command palette). It downloads Microsoft\'s public symbols and, when '
                     'Microsoft has not published them for this build (HTTP 404), locates the entry points by itself without symbols.')
        lines.append(f'Manifest cache: {USER_BUILDS}. DLL: {self.module_path}')
        return ' '.join(lines)
