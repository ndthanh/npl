"""Create the manifest for the WebView2 build Teams is running on this machine.

  1. Find EmbeddedBrowserWebView.dll (read-only process query; nothing is injected into Teams).
  2. Download Microsoft's matching public PDB and read the entry points from it (exact).
  3. If that fails for ANY reason (no PDB published for this build = HTTP 404, proxy, offline, unusable PDB),
     locate the entry points by static analysis of the dll (discover_build.py). Works offline.
  4. Save <sha256>.json atomically in the machine builds folder.

Every step is printed; the last line is `RESULT {json}` for the extension to parse. The same text is saved to
<state>/diagnostics/refresh_build.log. Exit codes: 0 manifest saved (or already present), 2 dll not found, 3 no method worked, 4 unexpected error.

  python refresh_build.py [--module DLL] [--pid PID] [--no-pdb] [--force] [--out-dir DIR] [--cache-dir DIR]
"""
import argparse
import ctypes as C
import ctypes.wintypes as W
import datetime
import json
import os
import pathlib
import struct
import sys
import time
import traceback

HERE = pathlib.Path(__file__).resolve().parent

import manifests  # noqa: E402
import symbols  # noqa: E402

STATE = pathlib.Path(os.environ.get('NOPILOT_STATE_DIR') or (pathlib.Path(os.environ.get('LOCALAPPDATA') or pathlib.Path.home()) / 'nopilot'))
LOG_FILE = STATE / 'diagnostics' / 'refresh_build.log'
VERSION = os.environ.get('NOPILOT_VERSION', '0.0.0')
_lines = []


def say(message):
    line = f'[{datetime.datetime.now():%H:%M:%S}] {message}'
    _lines.append(line)
    print(line, flush=True)


def finish(code, result):
    result = {'exitCode': code, **result}
    print('RESULT ' + json.dumps(result, ensure_ascii=True), flush=True)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOG_FILE.write_text('\n'.join(_lines) + '\nRESULT ' + json.dumps(result, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
    except OSError:
        pass
    return code


def locate_module(args):
    """The dll Teams has loaded: (path, how) or raise LookupError with a precise reason."""
    if args.module:
        path = pathlib.Path(args.module)
        if not path.is_file():
            raise LookupError(f'--module {path} does not exist')
        return path, 'given with --module'
    import teams_module
    pids = [args.pid] if args.pid else teams_module.teams_processes()[1]
    if not pids:
        raise LookupError('Microsoft Teams (ms-teams.exe) is not running. Start Teams, open it fully (not only the tray icon), and retry.')
    if len(pids) != 1:
        raise LookupError(f'Expected one Teams host, found {pids}. Close extra instances and retry.')
    errors = []
    for pid in pids:
        found, error = teams_module.webview_module_path(pid)
        if found:
            return pathlib.Path(found), f'loaded in Teams process {pid}'
        if error:
            errors.append(f'pid {pid}: {error}')
    raise LookupError('Teams is running but EmbeddedBrowserWebView.dll is not loaded yet' + (f' ({"; ".join(errors[:3])})' if errors else '')
                      + '. Open Teams fully and wait until its window has loaded, then retry.')


def manifest_from_pdb(pe, module, pdb):
    """Read the four entry points from the PDB. Raises RuntimeError saying what is missing or ambiguous."""
    image = pe
    dbg = C.WinDLL('dbghelp')
    kernel = C.WinDLL('kernel32')
    kernel.GetCurrentProcess.restype = W.HANDLE
    handle = kernel.GetCurrentProcess()
    dbg.SymInitializeW.argtypes = [W.HANDLE, W.LPCWSTR, W.BOOL]
    dbg.SymInitializeW.restype = W.BOOL
    dbg.SymSetOptions(0x10 | 0x4 | 0x200)
    if not dbg.SymInitializeW(handle, str(pdb.parent), False):
        raise C.WinError()
    dbg.SymLoadModuleExW.argtypes = [W.HANDLE, W.HANDLE, W.LPCWSTR, W.LPCWSTR, C.c_uint64, W.DWORD, C.c_void_p, W.DWORD]
    dbg.SymLoadModuleExW.restype = C.c_uint64
    base = dbg.SymLoadModuleExW(handle, None, str(pdb), None, 0x10000000, image.OPTIONAL_HEADER.SizeOfImage, None, 0)
    if not base:
        raise C.WinError()

    class Symbol(C.Structure):
        _fields_ = [('SizeOfStruct', W.ULONG), ('TypeIndex', W.ULONG), ('Reserved', C.c_uint64 * 2), ('Index', W.ULONG), ('Size', W.ULONG),
                    ('ModBase', C.c_uint64), ('Flags', W.ULONG), ('Value', C.c_uint64), ('Address', C.c_uint64), ('Register', W.ULONG),
                    ('Scope', W.ULONG), ('Tag', W.ULONG), ('NameLen', W.ULONG), ('MaxNameLen', W.ULONG), ('Name', C.c_char * 1)]

    Callback = C.WINFUNCTYPE(W.BOOL, C.POINTER(Symbol), W.ULONG, C.c_void_p)
    found = {}
    ns = 'embedded_browser_webview_current'

    @Callback
    def collect(p, size, ctx):
        symbol = p.contents
        name = C.string_at(C.addressof(symbol) + Symbol.Name.offset, symbol.NameLen).decode(errors='replace')
        if name.startswith(f'??_7EmbeddedBrowserWebViewFrame@{ns}') and 'ChainInterfaces' in name:
            found.setdefault('frameVtable', []).append(symbol.Address - base)
        if name.startswith(f'?ExecuteScript@EmbeddedBrowserWebViewFrame@{ns}'):
            found.setdefault('frameExecute', []).append(symbol.Address - base)
        if name.startswith(f'?ExecuteScript@EmbeddedBrowserWebView@{ns}'):
            found.setdefault('coreExecute', []).append(symbol.Address - base)
        if name.startswith(f'?get_Source@EmbeddedBrowserWebView@{ns}'):
            found.setdefault('coreSource', []).append(symbol.Address - base)
        return True

    dbg.SymEnumSymbols.argtypes = [W.HANDLE, C.c_uint64, C.c_char_p, Callback, C.c_void_p]
    dbg.SymEnumSymbols.restype = W.BOOL
    if not dbg.SymEnumSymbols(handle, base, b'*', collect, None):
        raise C.WinError()
    wanted = ['frameVtable', 'frameExecute', 'coreExecute', 'coreSource']
    if any(len(found.get(k, [])) != 1 for k in wanted):
        raise RuntimeError('the PDB lacks the expected symbols or has several: ' + json.dumps({k: len(found.get(k, [])) for k in wanted}))
    config = {k: v[0] for k, v in found.items()}
    pattern = struct.pack('<Q', image.OPTIONAL_HEADER.ImageBase + config.pop('coreSource'))
    tables = []
    for section in image.sections:
        data = section.get_data()
        start = 0
        while True:
            index = data.find(pattern, start)
            if index < 0:
                break
            vtable = section.VirtualAddress + index - 32
            if struct.unpack('<Q', image.get_data(vtable + 29 * 8, 8))[0] == image.OPTIONAL_HEADER.ImageBase + config['coreExecute']:
                tables.append(vtable)
            start = index + 1
    if len(tables) != 1:
        raise RuntimeError(f'the Teams shell vtable is missing or ambiguous: {tables}')
    config['coreVtable'] = tables[0]
    return config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int)
    parser.add_argument('--module', help='path of an x64 EmbeddedBrowserWebView.dll to use instead of the one loaded by Teams')
    parser.add_argument('--no-pdb', action='store_true', help='skip the symbol download and use static analysis only')
    parser.add_argument('--force', action='store_true', help='regenerate even if a manifest for this dll already exists')
    parser.add_argument('--out-dir', type=pathlib.Path, help='where to write <sha256>.json (default: the machine builds folder)')
    parser.add_argument('--cache-dir', type=pathlib.Path, default=manifests.USER_BUILDS.parent / 'symbols')
    args = parser.parse_args()

    say(f'Nopilot {VERSION} manifest generator, Python {sys.version.split()[0]}, state {STATE}')
    result = {'version': VERSION}
    try:
        say('[1/4] Locating EmbeddedBrowserWebView.dll')
        try:
            module, how = locate_module(args)
        except LookupError as error:
            say(f'FAILED: {error}')
            return finish(2, {**result, 'stage': 'locate', 'error': str(error)})
        digest = manifests.sha256_file(module)
        runtime = manifests.runtime_version(module)
        result.update(module=str(module), sha256=digest, runtimeVersion=runtime)
        say(f'      {module} ({how})')
        say(f'      WebView2 {runtime or "(version unknown)"}, sha256 {digest}')

        existing, _ = manifests.find(digest)
        if existing and not args.force:
            say('This build already has a manifest; nothing to do (use --force to regenerate).')
            return finish(0, {**result, 'method': existing.get('discoveryMethod', 'pdb'), 'already': True})

        try:
            import pefile
        except ModuleNotFoundError:
            return finish(3, {**result, 'stage': 'dependencies', 'error': 'Missing pefile. Run Nopilot: Repair Bridge Dependencies.'})
        pe = pefile.PE(str(module))
        if pe.FILE_HEADER.Machine != 0x8664:
            say('FAILED: this dll is not x64; only x64 Teams is supported.')
            return finish(3, {**result, 'stage': 'locate', 'error': 'not x64'})

        manifest = None
        pdb_failure = None
        if args.no_pdb:
            say('[2/4] Symbol download skipped (--no-pdb)')
            pdb_failure = {'kind': 'skipped', 'detail': '--no-pdb'}
        else:
            say('[2/4] Reading entry points from Microsoft public symbols')
            try:
                name, key = symbols.codeview(pe)
                result.update(pdb=[name, key])
                say(f'      PDB {name}, key {key}')
                pdb = symbols.download(name, key, args.cache_dir, log=lambda m: say('      ' + m))
                config = manifest_from_pdb(pe, module, pdb)
                manifest = {**config, 'moduleSha256': digest, 'architecture': 'x64', 'runtimeVersion': runtime,
                            'symbolServer': symbols.SERVER, 'pdb': [name, key], 'discoveryMethod': 'pdb', 'generatedBy': 'nopilot ' + VERSION}
                say('      entry points read from the PDB')
            except symbols.DownloadError as error:
                pdb_failure = {'kind': error.kind, 'detail': error.detail, 'url': error.url}
                say(f'      PDB not available: {error.detail}')
                if error.kind == 'not-published':
                    control = _control_probe()
                    if control:
                        say('      ' + control['message'])
                        pdb_failure['control'] = control['ok']
            except Exception as error:  # noqa: BLE001
                pdb_failure = {'kind': 'pdb-unusable', 'detail': f'{type(error).__name__}: {error}'}
                say(f'      PDB could not be used: {error}')

        if manifest is None:
            say('[3/4] Locating entry points by static analysis (no symbols needed, nothing is run)')
            from discover_build import discover, DiscoveryError
            try:
                config = discover(module, log=lambda m: say('      ' + m))
            except DiscoveryError as error:
                say(f'FAILED: {error}')
                return finish(3, {**result, 'stage': 'discover', 'error': str(error), 'pdbFailure': pdb_failure, 'trace': error.trace[-12:]})
            manifest = {**config, 'runtimeVersion': runtime, 'generatedBy': 'nopilot ' + VERSION}
            if pdb_failure:
                manifest['pdbFailure'] = pdb_failure['kind']
        else:
            say('[3/4] Static analysis not needed')

        say('[4/4] Saving the manifest')
        if manifest['moduleSha256'] != digest or manifests.sha256_file(module) != digest:
            return finish(3, {**result, 'stage': 'save', 'error': 'WebView2 DLL changed during analysis. Run the command again.'})
        manifests.validate(manifest, 'generated manifest')
        target = manifests.save(manifest, args.out_dir)
        method = manifest.get('discoveryMethod', 'pdb')
        say(f'      saved {target}')
        say('Done. ' + ('Offsets come from the symbol file (exact).' if method == 'pdb' else
                         'Offsets were found by static analysis (structural). They are checked again against the live Teams objects on every connection.'))
        return finish(0, {**result, 'method': method, 'saved': str(target), 'pdbFailure': pdb_failure})
    except Exception as error:  # noqa: BLE001
        say('UNEXPECTED ERROR:\n' + traceback.format_exc())
        return finish(4, {**result, 'stage': 'unexpected', 'error': f'{type(error).__name__}: {error}'})


def _control_probe():
    """After a 404: ask the same server for a build we know exists, so "not published" is told apart from "this network answers 404 to everything"."""
    try:
        reference = json.loads((HERE / 'build.json').read_text(encoding='utf-8')).get('pdb')
        if not reference:
            return None
        started = time.monotonic()
        probe = symbols.probe(*reference, timeout=30)
        took = time.monotonic() - started
        if probe['ok']:
            return {'ok': True, 'message': f'Control check passed (a known PDB downloads in {took:.0f}s): Microsoft has not published symbols for this build.'}
        return {'ok': False, 'message': f'Control check failed too ({probe["detail"]}): your network path to the symbol server is not working, so this 404 may not be real.'}
    except Exception:  # noqa: BLE001
        return None


if __name__ == '__main__':
    sys.exit(main())
